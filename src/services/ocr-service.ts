/**
 * Production PaddleOCR (PP-OCRv4 ONNX) & YOLO Vision Service.
 *
 * Replaces legacy Tesseract WASM with real PaddleOCR PP-OCRv4 + DBNet detection.
 * Supports:
 *   - Multi-image processing with persistent sourceImageId
 *   - Bounding boxes & 4-point polygon extraction
 *   - Deterministic Legal Metrology field extraction
 *   - Unmirrored camera frame evaluation
 *
 * ENGINE RESILIENCE (never silently empty):
 *   - The Python engine's status is ALWAYS reported via `engine.ok`.
 *   - When the Python engine fails outright, or reads an image as EMPTY while
 *     the package gate passed (i.e. visible text was missed), the offline
 *     Tesseract.js fallback (repo-shipped eng.traineddata) reads that image so
 *     visible characters never disappear from the result.
 *   - OCR_FALLBACK=auto|tesseract|none controls the fallback (default auto).
 */

import path from "path";
import fs from "fs";
import os from "os";
import { execFile } from "child_process";
import { promisify } from "util";
import { createHash } from "crypto";
import type { BoundingBox, DeclarationField } from "@/domain/inspection";
import { extractFieldCandidates, type TextLine } from "@/services/field-extraction";
import {
  recognizeWithTesseract,
  tesseractAvailable,
  TESSERACT_ENGINE,
  TESSERACT_MODEL_VERSION,
} from "@/services/tesseract-ocr";

const execFileAsync = promisify(execFile);

function bufHash(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex").slice(0, 12);
}

export interface OcrCandidate {
  variant: string;
  psm: number;
  text: string;
  confidence: number;
  elapsedMs: number;
  bbox?: BoundingBox;
  whitelist?: string | null;
  score?: number;
}

export interface TextLineResult {
  text: string;
  confidence: number;
  bbox: BoundingBox;
  polygon?: number[][];
  imageId?: string;
}

export interface RegionOcrResult {
  rawText: string;
  normalizedText: string;
  confidence: number;
  engine: string;
  modelVersion: string;
  candidates: OcrCandidate[];
  selectedCandidate: string;
  selectionReason: string;
  hasConflict: boolean;
  cropBuffer?: Buffer;
  bbox?: BoundingBox;
}

export interface WholeImageOcrResult {
  fullText: string;
  lines: TextLineResult[];
  candidates: OcrCandidate[];
  selectedCandidate: string;
  elapsedMs: number;
  engine: string;
  modelVersion: string;
  /** Engine health + fallback state for this recognition. */
  engineStatus: OcrEngineStatus;
  /** Python-engine field declarations (empty when the engine did not run). */
  declarations?: MultiImagePipelineResult["declarations"];
}

export interface OcrEngineStatus {
  /** True when the primary engine produced usable output. */
  ok: boolean;
  engine: string;
  modelVersion: string;
  interpreter?: string;
  error?: string;
  /** True when the Tesseract fallback contributed lines. */
  fallbackUsed?: boolean;
  fallbackEngine?: string;
  fallbackLines?: number;
}

export interface MultiImagePipelineResult {
  images: Array<{
    id: string;
    width: number;
    height: number;
    packageDetected: boolean;
    packageConfidence: number;
    packageBbox?: BoundingBox;
    detections: Array<{
      className: string;
      text: string;
      confidence: number;
      bbox: BoundingBox;
      polygon?: number[][];
    }>;
  }>;
  declarations: Array<{
    field: "product_name" | "manufacturer" | "net_quantity" | "mrp" | "date" | "consumer_care" | "country_of_origin" | "unit_sale_price" | "dimensions" | "best_before" | "batch_number";
    value: string | null;
    rawValue?: string;
    status: "DETECTED" | "NOT_DETECTED";
    confidence: number | null;
    sourceImageId?: string;
    bbox?: BoundingBox;
    polygon?: number[][];
    legalRules?: string[];
    evidence?: { rawText: string; boundingBox?: BoundingBox; polygon?: number[][] };
    consumerCareDetails?: any;
  }>;
  rawOcrText: string;
  totalLinesExtracted: number;
  /** Engine health + fallback state — ALWAYS present, never silently swallowed. */
  engine: OcrEngineStatus;
}

type FallbackMode = "auto" | "tesseract" | "none";

function getFallbackMode(): FallbackMode {
  const mode = (process.env.OCR_FALLBACK ?? "auto").toLowerCase();
  if (mode === "tesseract") return "tesseract";
  if (mode === "none") return "none";
  return "auto";
}

const PIPELINE_TARGET_FIELDS: DeclarationField[] = [
  "product_name",
  "mrp",
  "net_quantity",
  "date",
  "manufacturer",
  "consumer_care",
  "country_of_origin",
  "unit_sale_price",
  "dimensions",
  "best_before",
  "batch_number",
];

function toTextLines(
  detections: MultiImagePipelineResult["images"][number]["detections"]
): TextLine[] {
  return detections.map((d) => ({
    text: d.text,
    confidence: Math.round(d.confidence * 100),
    bbox: d.bbox,
  }));
}

/**
 * Deterministic TS field extraction over a merged line set. Used only when the
 * Python engine's own extractors did not run (forced/full fallback) or when
 * per-image fallback lines recovered fields the Python pass missed.
 */
function declarationsFromLines(
  lines: TextLine[],
  targetFields: DeclarationField[]
): MultiImagePipelineResult["declarations"] {
  const candidates = extractFieldCandidates(lines, targetFields);
  const bestByField = new Map<string, (typeof candidates)[number]>();
  for (const c of candidates) {
    if (!c.value) continue;
    const existing = bestByField.get(c.field);
    if (!existing || c.score > existing.score) bestByField.set(c.field, c);
  }
  return [...bestByField.entries()].map(([field, c]) => ({
    field: field as MultiImagePipelineResult["declarations"][number]["field"],
    value: c.value,
    rawValue: c.rawText,
    status: "DETECTED" as const,
    confidence: Math.round(Math.min(1, Math.max(0.1, (c.confidence ?? 50) / 100)) * 100) / 100,
    bbox: c.bbox,
    evidence: { rawText: c.rawText, boundingBox: c.bbox },
  }));
}

function mergeDeclarationsInto(
  existing: MultiImagePipelineResult["declarations"],
  extra: MultiImagePipelineResult["declarations"]
): void {
  for (const d of extra) {
    const idx = existing.findIndex((e) => e.field === d.field);
    if (idx === -1) existing.push(d);
    else if (existing[idx].status !== "DETECTED" || !existing[idx].value) existing[idx] = d;
  }
}

export class PaddleOcrService {
  readonly engine = "PaddleOCR-PPOCRv4";
  readonly modelVersion = "ppocr-v4-onnx";

  private getPythonPath(): string {
    if (process.env.PYTHON_PATH && fs.existsSync(process.env.PYTHON_PATH)) {
      return process.env.PYTHON_PATH;
    }
    const venvPy = path.resolve(process.cwd(), ".venv/bin/python");
    if (fs.existsSync(venvPy)) return venvPy;
    const altPy = "/opt/homebrew/bin/python3.11";
    if (fs.existsSync(altPy)) return altPy;
    return "python3";
  }

  private getScriptPath(): string {
    return path.join(process.cwd(), "ml", "inference", "pipeline_engine.py");
  }

  /**
   * Probe the OCR engine stack (interpreter → imports → real selftest).
   * Used by /api/health so a broken OCR environment is visible, not silent.
   */
  async probeEngine(timeoutMs = 8000): Promise<{
    ok: boolean;
    engine: string;
    modelVersion: string;
    interpreter?: string;
    rapidocrAvailable: boolean;
    tesseractAvailable: boolean;
    fallbackMode: string;
    error?: string;
    selftest?: Record<string, unknown> | null;
  }> {
    const pyPath = this.getPythonPath();
    let interpreter: string | undefined;
    let importOk = false;
    let importError: string | undefined;

    if (pyPath === "python3" || fs.existsSync(pyPath)) {
      try {
        const { stdout } = await execFileAsync(
          pyPath,
          ["-c", "import rapidocr_onnxruntime, cv2, numpy; import sys; print(sys.executable)"],
          { timeout: timeoutMs, maxBuffer: 1024 * 1024 }
        );
        importOk = true;
        interpreter = stdout.trim().split("\n").pop() || pyPath;
      } catch (err) {
        importError = err instanceof Error ? err.message.split("\n")[0] : String(err);
      }
    } else {
      importError = `Python interpreter not found: ${pyPath}`;
    }

    let selftest: Record<string, unknown> | null = null;
    if (importOk) {
      try {
        const { stdout } = await execFileAsync(pyPath, [this.getScriptPath(), "--selftest"], {
          timeout: 20000,
          maxBuffer: 4 * 1024 * 1024,
        });
        selftest = JSON.parse(stdout);
      } catch (err) {
        selftest = { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    }

    const selftestOk = selftest?.ok === true;
    return {
      ok: importOk && selftestOk,
      engine: this.engine,
      modelVersion: this.modelVersion,
      interpreter,
      rapidocrAvailable: importOk,
      tesseractAvailable: tesseractAvailable(),
      fallbackMode: getFallbackMode(),
      selftest,
      error: importError ?? (selftest && selftest.ok === false ? String(selftest.error ?? "selftest failed") : undefined),
    };
  }

  /**
   * Run full multi-image pipeline on one or more image buffers.
   *
   * Guarantees:
   *   - `engine.ok` is always populated (success or detailed failure).
   *   - A gated image the Python engine read as EMPTY is re-read with the
   *     Tesseract fallback so visible text is never lost.
   *   - On total Python failure, the whole batch falls back to Tesseract and
   *     field extraction runs deterministically on the recovered lines.
   */
  async processImageBatch(
    images: Array<{ id: string; buffer: Buffer; side?: string }>
  ): Promise<MultiImagePipelineResult> {
    const t0 = Date.now();
    const mode = getFallbackMode();

    // Forced-fallback mode: skip Python entirely (testing / operator choice).
    if (mode === "tesseract") {
      const fb = await this.runTesseractForImages(images);
      return {
        ...fb,
        declarations: declarationsFromLines(fb.images.flatMap((im) => toTextLines(im.detections)), PIPELINE_TARGET_FIELDS),
        engine: {
          ok: true,
          engine: TESSERACT_ENGINE,
          modelVersion: TESSERACT_MODEL_VERSION,
          fallbackUsed: true,
          fallbackEngine: TESSERACT_ENGINE,
          fallbackLines: fb.fallbackLines,
        },
      };
    }

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sih-ocr-"));
    const tmpPaths: string[] = [];

    try {
      for (const img of images) {
        const filePath = path.join(tmpDir, `${img.id}.jpg`);
        fs.writeFileSync(filePath, img.buffer);
        tmpPaths.push(filePath);
      }

      const pyPath = this.getPythonPath();
      const scriptPath = this.getScriptPath();

      const { stdout } = await execFileAsync(pyPath, [scriptPath, ...tmpPaths, "--json"], {
        maxBuffer: 20 * 1024 * 1024,
        timeout: 90000,
      });

      const parsed: MultiImagePipelineResult = JSON.parse(stdout);
      parsed.engine = {
        ok: true,
        engine: this.engine,
        modelVersion: this.modelVersion,
        interpreter: pyPath,
      };

      // Per-image recovery: any image the Python engine read as EMPTY — while
      // the package gate already confirmed text is present — is re-read with
      // the offline fallback so visible characters never disappear silently.
      let fallbackLines = 0;
      if (mode !== "none") {
        for (const img of parsed.images) {
          if ((img.detections ?? []).length > 0) continue;
          const input = images.find((i) => img.id.includes(i.id) || i.id.includes(img.id));
          if (!input) continue;
          try {
            const res = await recognizeWithTesseract(input.buffer);
            const fallbackDetections = res.lines.map((l) => ({
              className: "text_region" as const,
              text: l.text,
              confidence: Math.round(l.confidence) / 100,
              bbox: l.bbox,
            }));
            img.detections.push(...fallbackDetections);
            fallbackLines += fallbackDetections.length;
          } catch (err) {
            console.error("[PaddleOcrService] Tesseract per-image fallback failed:", err instanceof Error ? err.message : String(err));
          }
        }
        if (fallbackLines > 0) {
          parsed.engine.fallbackUsed = true;
          parsed.engine.fallbackEngine = TESSERACT_ENGINE;
          parsed.engine.fallbackLines = fallbackLines;
          parsed.totalLinesExtracted = parsed.images.reduce((s, im) => s + im.detections.length, 0);
          parsed.rawOcrText = parsed.images
            .flatMap((im) => im.detections.map((d) => `[${im.id}] ${d.text}`))
            .join("\n");
          // Recover fields the Python extractors missed from the fallback lines.
          const allLines = parsed.images.flatMap((im) => toTextLines(im.detections));
          mergeDeclarationsInto(parsed.declarations, declarationsFromLines(allLines, PIPELINE_TARGET_FIELDS));
        }
      }

      return parsed;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[PaddleOcrService] Error running pipeline engine:", msg);

      const failureStatus: OcrEngineStatus = {
        ok: false,
        engine: this.engine,
        modelVersion: this.modelVersion,
        error: msg,
        interpreter: this.getPythonPath(),
      };

      if (mode === "none") {
        return {
          images: [],
          declarations: [],
          rawOcrText: "",
          totalLinesExtracted: 0,
          engine: failureStatus,
        };
      }

      // Full-batch Tesseract fallback: the inspection must never come back
      // "analysis completed, nothing found" because the OCR env is broken.
      const fb = await this.runTesseractForImages(images);
      return {
        ...fb,
        declarations: declarationsFromLines(fb.images.flatMap((im) => toTextLines(im.detections)), PIPELINE_TARGET_FIELDS),
        engine: {
          ...failureStatus,
          fallbackUsed: true,
          fallbackEngine: TESSERACT_ENGINE,
          fallbackLines: fb.fallbackLines,
        },
      };
    } finally {
      try {
        for (const p of tmpPaths) {
          if (fs.existsSync(p)) fs.unlinkSync(p);
        }
        if (fs.existsSync(tmpDir)) fs.rmdirSync(tmpDir);
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  private async runTesseractForImages(
    images: Array<{ id: string; buffer: Buffer; side?: string }>
  ): Promise<{
    images: MultiImagePipelineResult["images"];
    rawOcrText: string;
    totalLinesExtracted: number;
    fallbackLines: number;
  }> {
    const out: MultiImagePipelineResult["images"] = [];
    const rawParts: string[] = [];
    let total = 0;
    let fallbackLines = 0;

    for (const img of images) {
      try {
        const res = await recognizeWithTesseract(img.buffer);
        const detections = res.lines.map((l) => ({
          className: "text_region" as const,
          text: l.text,
          confidence: Math.round(l.confidence) / 100,
          bbox: l.bbox,
        }));
        out.push({
          id: img.id,
          width: 0,
          height: 0,
          packageDetected: true,
          packageConfidence: 0.9,
          detections,
        });
        fallbackLines += detections.length;
        total += detections.length;
        for (const l of res.lines) rawParts.push(`[${img.id}] ${l.text}`);
      } catch (err) {
        console.error("[PaddleOcrService] Tesseract fallback failed for", img.id, err instanceof Error ? err.message : String(err));
        out.push({
          id: img.id,
          width: 0,
          height: 0,
          packageDetected: true,
          packageConfidence: 0.9,
          detections: [],
        });
      }
    }

    return {
      images: out,
      rawOcrText: rawParts.join("\n"),
      totalLinesExtracted: total,
      fallbackLines,
    };
  }

  /**
   * Single image recognition compatible with legacy caller signatures.
   * Also surfaces the Python engine's own declarations and engine status so
   * the live-detection path and the official pipeline agree.
   */
  async recognizeWholeImage(imageBuffer: Buffer): Promise<WholeImageOcrResult> {
    const t0 = Date.now();
    const batchRes = await this.processImageBatch([
      { id: `frame-${Date.now()}`, buffer: imageBuffer },
    ]);

    const firstImg = batchRes.images[0];
    const lines: TextLineResult[] = (firstImg?.detections || []).map((d) => ({
      text: d.text,
      confidence: Math.round(d.confidence * 100),
      bbox: d.bbox,
      polygon: d.polygon,
    }));

    const fullText = lines.map((l) => l.text).join("\n");
    const elapsed = Date.now() - t0;

    return {
      fullText,
      lines,
      candidates: [
        {
          variant: "paddleocr-v4",
          psm: 3,
          text: fullText,
          confidence: lines.length > 0 ? Math.round(lines.reduce((s, l) => s + l.confidence, 0) / lines.length) : 0,
          elapsedMs: elapsed,
        },
      ],
      selectedCandidate: fullText,
      elapsedMs: elapsed,
      engine: this.engine,
      modelVersion: this.modelVersion,
      engineStatus: batchRes.engine,
      declarations: batchRes.declarations,
    };
  }

  /**
   * Region crop OCR compatible with existing caller signatures.
   */
  async recognizeRegion(
    imageBuffer: Buffer,
    bbox: BoundingBox,
    field: DeclarationField
  ): Promise<RegionOcrResult> {
    const t0 = Date.now();
    const whole = await this.recognizeWholeImage(imageBuffer);

    // Find lines intersecting with bbox
    const matchingLines = whole.lines.filter((l) => {
      const bx = l.bbox.x;
      const by = l.bbox.y;
      const bw = l.bbox.width;
      const bh = l.bbox.height;
      return (
        bx >= bbox.x - 5 &&
        by >= bbox.y - 5 &&
        bx + bw <= bbox.x + bbox.width + 10 &&
        by + bh <= bbox.y + bbox.height + 10
      );
    });

    const rawText = matchingLines.map((l) => l.text).join(" ") || whole.fullText;
    const confidence = matchingLines.length > 0
      ? Math.round(matchingLines.reduce((s, l) => s + l.confidence, 0) / matchingLines.length)
      : 85;

    return {
      rawText,
      normalizedText: rawText,
      confidence,
      engine: this.engine,
      modelVersion: this.modelVersion,
      candidates: [],
      selectedCandidate: rawText,
      selectionReason: "paddleocr-roi-extraction",
      hasConflict: false,
      bbox,
    };
  }

  /**
   * Recognize crop proposals.
   */
  async recognizeCropProposals(
    imageBuffer: Buffer,
    rois: any[]
  ): Promise<{
    mergedText: string;
    lines: Array<{ text: string; confidence: number; bbox: BoundingBox }>;
    candidates: OcrCandidate[];
    elapsedMs: number;
  }> {
    const res = await this.recognizeWholeImage(imageBuffer);
    return {
      mergedText: res.fullText,
      lines: res.lines,
      candidates: res.candidates,
      elapsedMs: res.elapsedMs,
    };
  }
}

export const ocrService = new PaddleOcrService();