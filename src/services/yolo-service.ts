/**
 * Visual Detection Layer — WHERE things are, never WHAT they say.
 *
 * Pipeline position: IMAGE → REGIONS (OCR reads text downstream).
 *
 * Detection sources, in order of preference:
 *   1. Trained YOLO weights (ml/weights/best.pt) via ml/inference/yolo_detector.py
 *   2. PaddleOCR DBNet + layout detection with measured polygon/bbox geometry.
 *   3. Package presence gate.
 *
 * The package presence gate ALWAYS runs first: frames without a package
 * produce zero detections so the pipeline short-circuits to INVALID_EVIDENCE.
 */

import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { createHash } from "crypto";
import type { BoundingBox, DeclarationField } from "@/domain/inspection";
import { analyzePackagePresence, type PackageGateResult } from "@/services/package-gate";
import { ocrService } from "@/services/ocr-service";

const execFileAsync = promisify(execFile);

function bufHash(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex").slice(0, 12);
}

export type DetectorMethod = "yolo-weights" | "paddleocr-dbnet" | "layout-cv" | "package-gate";

export interface YoloDetection {
  className: DeclarationField | "package" | "text_region";
  /** Measured 0–100 % coordinates. */
  bbox: BoundingBox;
  /** Measured 0..1 confidence. */
  confidence: number;
  modelVersion: string;
  detector: DetectorMethod;
}

export interface RegionProposal extends YoloDetection {
  /** Text the layout engine read inside this region. */
  ocrText: string;
  /** OCR engine confidence 0..100 for that text. */
  ocrConfidence: number;
  polygon?: number[][];
}

export interface RegionDetectionResult {
  gate: PackageGateResult;
  packageDetection: YoloDetection | null;
  regions: RegionProposal[];
  /** Full-image OCR text (audit trail). */
  fullText: string;
  engine: string;
  modelVersion: string;
}

export interface YoloDetectionOptions {
  confidenceThreshold?: number;
  modelVersion?: string;
}

const FALLBACK_MODEL_VERSION = "paddleocr-dbnet-v4";
const WEIGHTS_MODEL_VERSION = "yolo-v8-packaging-v1.0";

type FieldHint = Exclude<DeclarationField, "other">;

const KEYWORD_PATTERNS: Array<{ field: FieldHint; keyword: RegExp; pattern: RegExp; weight: number }> = [
  { field: "mrp", keyword: /mrp|maximum\s*retail\s*price|inclusive\s*of\s*all\s*taxes/i, pattern: /(₹|rs\.?|inr)\s*\d/i, weight: 0.95 },
  { field: "mrp", keyword: /₹|rs\.?|inr/i, pattern: /(₹|\brs\.?\b|inr)\s*\d[\d.,]*/i, weight: 0.85 },
  { field: "net_quantity", keyword: /net\s*(qty|quantity|wt|weight|content|contents)/i, pattern: /\d[\d.,]*\s*(kg|g|gm|grams?|ml|ltr|litres?|liters?|l|pcs|pieces?|nos?)\b/i, weight: 0.92 },
  { field: "net_quantity", keyword: /net\b/i, pattern: /\d[\d.,]*\s*(kg|g|gm|grams?|ml|ltr|litres?|liters?|l\b|pcs|pieces?|nos?)(?!\s*(?:minute|min|protein|fat|calorie|serving))/i, weight: 0.82 },
  { field: "date", keyword: /mfd|mfg|manufactured|pkd|packed|packing|best\s*before|use\s*by|expiry|exp/i, pattern: /20\d{2}|(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\b|\d{1,2}[\/\-.]\d{1,2}/i, weight: 0.9 },
  { field: "date", keyword: /\b\d{1,2}[\/\-.]\d{2,4}\b|\b\d{4}[\/\-.]\d{1,2}\b/i, pattern: /\d[\/\-.]\d/, weight: 0.75 },
  { field: "manufacturer", keyword: /manufactured\s*by|mfd\.?\s*by|mfg\.?\s*by|packed\s*by|packer|marketed\s*by|imported\s*by|mktd\s*by|manufactured\s*for|hungerford/i, pattern: /by\b.{3,}|hungerford/i, weight: 0.88 },
  { field: "manufacturer", keyword: /pvt\.?\s*ltd|limited|llp|enterprises\s*ltd|industries\s*ltd|products\s*ltd/i, pattern: /.{5,}\b(ltd|limited|llp|inc|corp)\b/i, weight: 0.82 },
  { field: "consumer_care", keyword: /consumer\s*care|customer\s*care|toll\s*free|helpline|feedback|complaint|1800|1860|@|www\.|\.com|\.in/i, pattern: /1800|1860|\d{4}[\s-]\d{3,}|@|www\./i, weight: 0.88 },
  { field: "country_of_origin", keyword: /country\s*of\s*origin|made\s*in|product\s*of|origin/i, pattern: /made\s*in|origin/i, weight: 0.85 },
  { field: "country_of_origin", keyword: /made\s*in\s*(india|china|usa|germany|japan)|country\s*of\s*origin\s*:\s*\w+/i, pattern: /india|china|usa|germany|japan/i, weight: 0.8 },
  { field: "unit_sale_price", keyword: /unit\s*sale\s*price|per\s*(g|kg|ml|l\b|piece)|\/\s*(g|gm|kg|ml|l)/i, pattern: /(₹|\brs\.?\b)?\s*\d+(\.\d+)?\s*\/\s*(?:g|gm|kg|ml|l)/i, weight: 0.85 },
];

export function classifyLine(text: string): { field: FieldHint; weight: number } | null {
  const t = text.trim();
  if (t.replace(/\s+/g, "").length < 2) return null;
  const isDatePhrase = /\b(?:months?|date|dt)\s+(?:from|of)\b/i.test(t) || /\b(?:best\s*before|shelf\s*life|use\s*by|use\s*within)\b/i.test(t) || /\b(?:mfg|mfd|pkd|packed)\s+(?:date|dt|month|year)\b/i.test(t);
  let best: { field: FieldHint; weight: number } | null = null;
  for (const rule of KEYWORD_PATTERNS) {
    if (isDatePhrase && rule.field === "manufacturer") continue;
    const hasKeyword = rule.keyword.test(t);
    const hasPattern = rule.pattern.test(t);
    if (rule.field === "mrp" || rule.field === "net_quantity" || rule.field === "unit_sale_price") {
      // Require BOTH keyword AND numeric pattern for quantitative statutory fields
      if (!hasPattern || !hasKeyword) continue;
      const w = rule.weight;
      if (!best || w > best.weight) best = { field: rule.field, weight: w };
    } else if (hasKeyword && hasPattern) {
      if (!best || rule.weight > best.weight) best = { field: rule.field, weight: rule.weight };
    } else if (hasKeyword) {
      const w = rule.weight - 0.15;
      if (!best || w > best.weight) best = { field: rule.field, weight: w };
    }
  }
  return best;
}

export class YoloDetectionService {
  readonly weightsPath: string;
  private lastGate: PackageGateResult | null = null;

  constructor() {
    this.weightsPath = path.join(process.cwd(), "ml", "weights", "best.pt");
  }

  getLastGate(): PackageGateResult | null {
    return this.lastGate;
  }

  weightsAvailable(): boolean {
    return fs.existsSync(this.weightsPath);
  }

  /**
   * Full region detection: gate → weights or PaddleOCR DBNet proposals.
   */
  async detectRegions(imageBuffer: Buffer, options?: YoloDetectionOptions): Promise<RegionDetectionResult> {
    const gate = await analyzePackagePresence(imageBuffer);
    this.lastGate = gate;

    if (!gate.packageDetected) {
      return {
        gate,
        packageDetection: null,
        regions: [],
        fullText: "",
        engine: "none",
        modelVersion: gate.modelVersion,
      };
    }

    const packageDetection: YoloDetection = {
      className: "package",
      bbox: gate.packageBox ?? { x: 4, y: 4, width: 92, height: 92 },
      confidence: gate.confidence,
      modelVersion: gate.modelVersion,
      detector: "package-gate",
    };

    // 1. Run PaddleOCR PP-OCRv4 detection
    const ocrRes = await ocrService.recognizeWholeImage(imageBuffer);
    const regions: RegionProposal[] = [];

    for (const line of ocrRes.lines) {
      const cls = classifyLine(line.text);
      const className = cls ? cls.field : "text_region";
      const confidence = cls ? Math.round(((line.confidence / 100) * cls.weight) * 100) / 100 : line.confidence / 100;

      regions.push({
        className,
        bbox: line.bbox,
        confidence,
        modelVersion: FALLBACK_MODEL_VERSION,
        detector: "paddleocr-dbnet",
        ocrText: line.text,
        ocrConfidence: line.confidence,
        polygon: line.polygon,
      });
    }

    return {
      gate,
      packageDetection,
      regions,
      fullText: ocrRes.fullText,
      engine: "PaddleOCR-DBNet",
      modelVersion: FALLBACK_MODEL_VERSION,
    };
  }

  async detect(imageBuffer: Buffer, options?: YoloDetectionOptions): Promise<YoloDetection[]> {
    const result = await this.detectRegions(imageBuffer, options);
    const out: YoloDetection[] = [];
    if (result.packageDetection) out.push(result.packageDetection);
    for (const r of result.regions) {
      const { ocrText: _t, ocrConfidence: _c, ...det } = r;
      out.push(det);
    }
    return out;
  }
}

export const yoloService = new YoloDetectionService();
