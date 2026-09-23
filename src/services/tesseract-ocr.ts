/**
 * Tesseract.js fallback OCR engine — deterministic and fully offline.
 *
 * Uses the repo-shipped `eng.traineddata` (no CDN, no network). It is the
 * resilience layer for the primary Python RapidOCR engine: when the Python
 * engine is unavailable or yields zero lines, a visible package label must
 * NEVER silently produce "nothing detected" — the fallback reads it instead.
 *
 * Emits the same line shape (text / confidence / bbox in % of image) that the
 * rest of the pipeline consumes, so field extraction is unchanged.
 */

import { createWorker, OEM } from "tesseract.js";
import fs from "fs";
import path from "path";
import sharp from "sharp";
import type { BoundingBox } from "@/domain/inspection";

export const TESSERACT_ENGINE = "Tesseract.js" as const;
export const TESSERACT_MODEL_VERSION = "tesseract-eng-v1" as const;

export interface TesseractLine {
  text: string;
  /** 0..100 (tesseract.js convention). */
  confidence: number;
  /** Percentage of image, matching the RapidOCR line format. */
  bbox: BoundingBox;
}

export interface TesseractRecognition {
  lines: TesseractLine[];
  fullText: string;
  elapsedMs: number;
  engine: typeof TESSERACT_ENGINE;
  modelVersion: typeof TESSERACT_MODEL_VERSION;
}

let trainedDataDir: string | null | undefined; // undefined = not yet resolved
let workerPromise: Promise<Awaited<ReturnType<typeof createWorker>> | null> | null = null;

function resolveTrainedDataDir(): string | null {
  if (trainedDataDir !== undefined) return trainedDataDir;
  const candidates = [
    path.join(process.cwd(), "eng.traineddata"),
    path.join(process.cwd(), "..", "eng.traineddata"),
    path.join(__dirname, "..", "..", "eng.traineddata"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(/*turbopackIgnore: true*/ p)) {
      trainedDataDir = path.dirname(p);
      return trainedDataDir;
    }
  }
  trainedDataDir = null;
  return null;
}

/** True when the offline traineddata is present and the fallback can run. */
export function tesseractAvailable(): boolean {
  return resolveTrainedDataDir() !== null;
}

async function getWorker(): Promise<Awaited<ReturnType<typeof createWorker>> | null> {
  const dir = resolveTrainedDataDir();
  if (!dir) return null;
  if (!workerPromise) {
    workerPromise = createWorker("eng", OEM.LSTM_ONLY, {
      langPath: dir,
      cacheMethod: "none",
      gzip: false,
    }).catch((err) => {
      console.error(
        "[TesseractOcr] worker init failed:",
        err instanceof Error ? err.message : String(err)
      );
      workerPromise = null;
      return null;
    });
  }
  return workerPromise;
}

/**
 * Recognise an image buffer with Tesseract. Throws only when the fallback is
 * genuinely unavailable — callers treat that as "fallback could not run".
 */
export async function recognizeWithTesseract(imageBuffer: Buffer): Promise<TesseractRecognition> {
  const t0 = Date.now();
  const worker = await getWorker();
  if (!worker) {
    throw new Error(
      "Tesseract fallback unavailable: eng.traineddata not found or worker init failed."
    );
  }

  const { data } = await worker.recognize(
    imageBuffer,
    {},
    { text: true, blocks: true }
  );

  const meta = await sharp(imageBuffer).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;

  const lines: TesseractLine[] = [];
  for (const block of data.blocks ?? []) {
    for (const paragraph of block.paragraphs ?? []) {
      for (const line of paragraph.lines ?? []) {
        const text = (line.text ?? "").trim();
        if (!text || !line.bbox || width <= 0 || height <= 0) continue;
        const { x0 = 0, y0 = 0, x1 = x0, y1 = y0 } = line.bbox;
        lines.push({
          text,
          confidence: Math.round(line.confidence ?? 0),
          bbox: {
            x: Math.round((x0 / width) * 100 * 10) / 10,
            y: Math.round((y0 / height) * 100 * 10) / 10,
            width: Math.round(((x1 - x0) / width) * 100 * 10) / 10,
            height: Math.round(((y1 - y0) / height) * 100 * 10) / 10,
          },
        });
      }
    }
  }

  return {
    lines,
    fullText: lines.map((l) => l.text).join("\n"),
    elapsedMs: Date.now() - t0,
    engine: TESSERACT_ENGINE,
    modelVersion: TESSERACT_MODEL_VERSION,
  };
}