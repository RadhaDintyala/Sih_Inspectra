import { NextRequest, NextResponse } from "next/server";
import { analyzePackagePresence } from "@/services/package-gate";
import { classifyLine } from "@/services/yolo-service";
import { ocrService } from "@/services/ocr-service";
import { extractFieldCandidates } from "@/services/field-extraction";
import {
  normalizeMRP, normalizeNetQuantity, normalizeDate,
  normalizeManufacturer, normalizeProductName, normalizeCountryOfOrigin,
  normalizeConsumerCare, normalizeBatchNumber,
} from "@/services/normalizer";
import type { DeclarationField } from "@/domain/inspection";

const TARGET_FIELDS: DeclarationField[] = [
  "product_name", "manufacturer", "net_quantity", "mrp",
  "date", "consumer_care", "country_of_origin", "unit_sale_price",
];
const LIVE_FIELD_SET = new Set<string>(TARGET_FIELDS);

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      imageBase64?: string;
      videoWidth?: number;
      videoHeight?: number;
    };
    const imageBase64 = body.imageBase64;
    if (!imageBase64 || typeof imageBase64 !== "string") {
      return NextResponse.json({ error: "Missing imageBase64." }, { status: 400 });
    }
    const base64Data = imageBase64.includes(",") ? imageBase64.split(",")[1] : imageBase64;
    let buffer: Buffer;
    try {
      buffer = Buffer.from(base64Data, "base64");
    } catch {
      return NextResponse.json({ error: "Invalid base64." }, { status: 400 });
    }
    if (buffer.length < 1024) {
      return NextResponse.json({ error: "Image too small." }, { status: 422 });
    }

    const t0 = Date.now();

    // Package gate
    const gate = await analyzePackagePresence(buffer);
    if (!gate.packageDetected) {
      return NextResponse.json({
        success: false,
        packageDetected: false,
        packageConfidence: gate.confidence,
        rawOcrText: "",
        inferenceMs: Date.now() - t0,
        declarations: [],
        engine: null,
      });
    }

    // Single OCR call (Python PP-OCRv4; automatically falls back to offline
    // Tesseract when the engine fails or reads the frame as empty). The
    // engine's own declarations are used directly so the live HUD and the
    // official pipeline report the SAME values.
    const ocrResult = await ocrService.recognizeWholeImage(buffer);

    const allLines: Array<{ text: string; confidence: number; bbox: any; polygon?: any }> =
      ocrResult.lines.map((l) => ({
        text: l.text,
        confidence: l.confidence,
        bbox: l.bbox,
        polygon: l.polygon,
      }));

    // Region classification on the same lines the pipeline consumes — no
    // second OCR pass per frame (halves server cost of live detection).
    const regions = allLines.map((line) => {
      const cls = classifyLine(line.text);
      return {
        className: cls ? cls.field : "text_region",
        bbox: line.bbox,
        polygon: line.polygon,
        ocrText: line.text,
        ocrConfidence: line.confidence,
      };
    });

    // ── Declarations: prefer the Python engine's own extraction ─────────
    const declarations: any[] = [];
    if (ocrResult.declarations && ocrResult.declarations.length > 0) {
      for (const d of ocrResult.declarations) {
        if (!LIVE_FIELD_SET.has(d.field)) continue;
        if (d.status !== "DETECTED" || !d.value) continue;
        declarations.push({
          field: d.field,
          value: d.value,
          rawValue: d.rawValue || d.value,
          status: "DETECTED",
          confidence: d.confidence ?? 0.95,
          bbox: d.bbox,
          polygon: d.polygon,
          evidence: d.evidence ? { rawText: d.evidence.rawText, boundingBox: d.evidence.boundingBox, polygon: d.evidence.polygon } : undefined,
        });
      }
    }

    // ── Last-resort TS extraction when the engine produced no declarations
    const seenFields = new Set<string>(declarations.map((d) => d.field));
    if (declarations.length === 0 && allLines.length > 0) {
      const candidates = extractFieldCandidates(allLines, TARGET_FIELDS);
      const normalizeField = (field: DeclarationField, text: string): string | null => {
        switch (field) {
          case "mrp": return normalizeMRP(text);
          case "net_quantity": return normalizeNetQuantity(text);
          case "date": return normalizeDate(text);
          case "product_name": return normalizeProductName(text);
          case "manufacturer": return normalizeManufacturer(text);
          case "consumer_care": return normalizeConsumerCare(text);
          case "country_of_origin": return normalizeCountryOfOrigin(text);
          case "unit_sale_price": return normalizeMRP(text);
          case "batch_number": return normalizeBatchNumber(text);
          default: return text.trim() || null;
        }
      };
      for (const field of TARGET_FIELDS) {
        const fieldCands = candidates.filter((c: any) => c.field === field && c.value);
        if (fieldCands.length === 0) continue;
        const best = fieldCands.sort((a: any, b: any) => b.score - a.score)[0];
        if (seenFields.has(field)) continue;
        seenFields.add(field);
        const normalizedValue = normalizeField(field, best.value) || best.value;
        declarations.push({
          field,
          value: normalizedValue,
          rawValue: best.rawText,
          status: "DETECTED",
          confidence: best.confidence,
          bbox: best.bbox,
          evidence: { rawText: best.rawText, boundingBox: best.bbox },
        });
      }
    }

    // Product-name fallback from leading lines when still missing
    const productName = declarations.find((d: any) => d.field === "product_name")?.value || null;
    if (!productName && allLines.length > 0 && !seenFields.has("product_name")) {
      const topLines = allLines.slice(0, 5).map((l: any) => l.text).join(" ");
      const normName = normalizeProductName(topLines);
      if (normName) {
        declarations.push({
          field: "product_name",
          value: normName,
          rawValue: topLines,
          status: "DETECTED",
          confidence: 0.5,
          bbox: allLines[0]?.bbox,
        });
      }
    }

    // Build the response
    const packageBbox = gate.packageBox;
    const result = {
      success: true,
      packageDetected: true,
      packageConfidence: gate.confidence,
      packageBbox: packageBbox ? {
        x: packageBbox.x, y: packageBbox.y, width: packageBbox.width, height: packageBbox.height,
      } : undefined,
      rawOcrText: ocrResult.fullText,
      inferenceMs: Date.now() - t0,
      declarations,
      regions,
      engine: {
        engine: ocrResult.engine,
        modelVersion: ocrResult.modelVersion,
        engineStatus: ocrResult.engineStatus,
      },
    };

    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[live-detect] Error:", msg);
    return NextResponse.json({ error: "DETECTION_FAILED", message: msg }, { status: 500 });
  }
}