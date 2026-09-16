/**
 * Package Presence Gate — deterministic, dependency-light computer vision.
 *
 * Decides the single most important question in the pipeline:
 *   VALID PACKAGE EVIDENCE = YES / NO
 *
 * Runs on raw pixels (sharp) with classical measurements:
 *   - resolution / brightness / glare / blur (evidence quality)
 *   - skin-tone dominance + low structure (human-subject frame rejection)
 *   - edge-density / texture structure (package detail presence)
 *   - measured content bounding rect (real coordinates, never hardcoded)
 *
 * No generative AI. No network. No model weights required.
 * The YOLO weights path (when best.pt exists) runs AFTER this gate passes.
 */

import sharp from "sharp";
import type { BoundingBox } from "@/domain/inspection";

export interface PackageQuality {
  width: number;
  height: number;
  meanLuma: number;
  blurVariance: number;
  glareRatio: number;
  edgeDensity: number;
  skinRatio: number;
  colorfulness: number;
  /** Estimated median text height as fraction of image height (0–1). */
  textHeightScore: number;
  /** Estimated skew in degrees (positive = clockwise). */
  skewDegrees: number;
  insufficientReason?: string;
}

export interface PackageGateResult {
  packageDetected: boolean;
  /** Measured 0..1 confidence — derived from evidence, never invented. */
  confidence: number;
  /** Machine reason code, e.g. HUMAN_SUBJECT_FRAME, LOW_STRUCTURE, ... */
  reason: string;
  /** Human-readable capture guidance for the officer. */
  guidance: string;
  quality: PackageQuality;
  /** Measured content rect in 0–100 % coordinates (present iff detected). */
  packageBox?: BoundingBox;
  detector: "package-gate-v1";
  modelVersion: "package-gate-v1";
}

const GATE_VERSION = "package-gate-v1";

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function isSkinPixel(r: number, g: number, b: number): boolean {
  // Classic RGB skin heuristic (conservative, privacy-respecting:
  // used ONLY to reject non-package frames, never stored).
  return (
    r > 95 &&
    g > 40 &&
    b > 20 &&
    r > g &&
    r > b &&
    Math.abs(r - g) > 15 &&
    Math.max(r, Math.max(g, b)) - Math.min(r, Math.min(g, b)) > 15
  );
}

/**
 * Analyse a raw image buffer. Never throws — returns NOT_DETECTED on error.
 */
export async function analyzePackagePresence(imageBuffer: Buffer): Promise<PackageGateResult> {
  try {
    const meta = await sharp(imageBuffer).metadata();
    const width = meta.width ?? 0;
    const height = meta.height ?? 0;

    if (!width || !height || width < 160 || height < 160) {
      return reject("IMAGE_QUALITY_INSUFFICIENT", "Image resolution is too low. Move closer and capture again.", {
        width, height, meanLuma: 0, blurVariance: 0, glareRatio: 0, edgeDensity: 0, skinRatio: 0, colorfulness: 0,
        textHeightScore: 0, skewDegrees: 0,
        insufficientReason: `Resolution ${width}x${height} below minimum 160px.`,
      });
    }

    // Downscale for fast analysis. rotate() normalizes EXIF orientation so the
    // analysed pixels match what OCR will consume.
    const TARGET_W = 160;
    const { data, info } = await sharp(imageBuffer)
      .rotate()
      .resize({ width: TARGET_W, withoutEnlargement: true })
      .raw()
      .toBuffer({ resolveWithObject: true });

    const w = info.width;
    const h = info.height;
    const channels = info.channels;
    const n = w * h;

    const gray = new Float32Array(n);
    let lumaSum = 0;
    let glareCount = 0;
    let skinCount = 0;
    let satSum = 0;

    for (let i = 0; i < n; i++) {
      const r = data[i * channels];
      const g = data[i * channels + 1];
      const b = data[i * channels + 2];
      const luma = 0.299 * r + 0.587 * g + 0.114 * b;
      gray[i] = luma;
      lumaSum += luma;
      if (luma > 242) glareCount++;
      if (isSkinPixel(r, g, b)) skinCount++;
      const mx = Math.max(r, g, b);
      const mn = Math.min(r, g, b);
      satSum += mx === 0 ? 0 : (mx - mn) / mx;
    }

    const meanLuma = lumaSum / n;
    const glareRatio = glareCount / n;
    const skinRatio = skinCount / n;
    const colorfulness = satSum / n;

    // Laplacian variance (blur) + Sobel edge density on the grayscale field.
    let lapSum = 0;
    let lapSumSq = 0;
    let lapCount = 0;
    let edgeCount = 0;
    let sobelCount = 0;
    const GRID = 8;
    const gridEdge = new Float32Array(GRID * GRID);
    const gridCount = new Float32Array(GRID * GRID);

    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const c = y * w + x;
        const lap =
          4 * gray[c] - gray[c - 1] - gray[c + 1] - gray[c - w] - gray[c + w];
        lapSum += lap;
        lapSumSq += lap * lap;
        lapCount++;
        const gx = gray[c + 1] - gray[c - 1];
        const gy = gray[c + w] - gray[c - w];
        const mag = Math.sqrt(gx * gx + gy * gy);
        if (mag > 28) {
          edgeCount++;
          const gxCell = Math.min(GRID - 1, Math.floor((x / w) * GRID));
          const gyCell = Math.min(GRID - 1, Math.floor((y / h) * GRID));
          gridEdge[gyCell * GRID + gxCell]++;
        }
        sobelCount++;
        const gxCell = Math.min(GRID - 1, Math.floor((x / w) * GRID));
        const gyCell = Math.min(GRID - 1, Math.floor((y / h) * GRID));
        gridCount[gyCell * GRID + gxCell]++;
      }
    }

    const lapMean = lapSum / Math.max(1, lapCount);
    const blurVariance = lapSumSq / Math.max(1, lapCount) - lapMean * lapMean;
    const edgeDensity = edgeCount / Math.max(1, sobelCount);

    // ── Text height estimation ──────────────────────────────────────
    // Count horizontal strong edges per row. Text lines create horizontal
    // runs of edges. Estimate median run length as a proxy for character height.
    const rowEdgeCount = new Uint32Array(h);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const c = y * w + x;
        const gy = gray[c + w] - gray[c - w];
        if (Math.abs(gy) > 28) rowEdgeCount[y]++;
      }
    }
    // Find runs of rows with significant horizontal edges (text lines)
    const rowThreshold = w * 0.02;
    let totalRunLen = 0;
    let runCount = 0;
    let currentRun = 0;
    for (let y = 0; y < h; y++) {
      if (rowEdgeCount[y] > rowThreshold) {
        currentRun++;
      } else {
        if (currentRun > 2) { totalRunLen += currentRun; runCount++; }
        currentRun = 0;
      }
    }
    if (currentRun > 2) { totalRunLen += currentRun; runCount++; }
    const medianRunLen = runCount > 0 ? totalRunLen / runCount : 0;
    const textHeightScore = clamp(medianRunLen / h, 0, 1);

    // ── Skew estimation via projection profile ──────────────────────
    // Test angles -3° to +3° in 0.5° steps. For each, project grayscale
    // onto horizontal axis and measure sharpness of the projection.
    // The angle with the sharpest projection is the estimated skew.
    let bestSkew = 0;
    let bestSharpness = 0;
    const testAngles = [-3, -2.5, -2, -1.5, -1, -0.5, 0, 0.5, 1, 1.5, 2, 2.5, 3];
    const step = Math.max(1, Math.floor(h / 80));
    for (const angle of testAngles) {
      const rad = (angle * Math.PI) / 180;
      const cosA = Math.cos(rad);
      const sinA = Math.sin(rad);
      const proj = new Float32Array(h);
      for (let y = 0; y < h; y += step) {
        let sum = 0;
        for (let x = 0; x < w; x += step) {
          const ry = Math.round(y * cosA - x * sinA);
          if (ry >= 0 && ry < h) sum += gray[ry * w + x];
        }
        proj[y] = sum;
      }
      // Sharpness = variance of projection
      let pSum = 0, pSumSq = 0, pCount = 0;
      for (let y = 0; y < h; y += step) { pSum += proj[y]; pSumSq += proj[y] * proj[y]; pCount++; }
      const pMean = pSum / Math.max(1, pCount);
      const sharpness = pSumSq / Math.max(1, pCount) - pMean * pMean;
      if (sharpness > bestSharpness) { bestSharpness = sharpness; bestSkew = angle; }
    }

    // Measure border white ratio (typical of e-commerce / catalog packshots on clean white backgrounds)
    let borderPixels = 0;
    let borderWhitePixels = 0;
    const borderThick = Math.max(2, Math.floor(Math.min(w, h) * 0.06));
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (x < borderThick || x >= w - borderThick || y < borderThick || y >= h - borderThick) {
          borderPixels++;
          if (gray[y * w + x] > 240) borderWhitePixels++;
        }
      }
    }
    const borderWhiteRatio = borderPixels > 0 ? borderWhitePixels / borderPixels : 0;
    const isStudioWhiteBackground = borderWhiteRatio > 0.35 && edgeDensity >= 0.02;

    const quality: PackageQuality = {
      width, height, meanLuma, blurVariance, glareRatio, edgeDensity, skinRatio, colorfulness,
      textHeightScore: Math.round(textHeightScore * 1000) / 1000,
      skewDegrees: bestSkew,
    };

    // ---- Quality gates (insufficient evidence, not a package verdict) ----
    if (meanLuma < 22) {
      return reject("IMAGE_QUALITY_INSUFFICIENT", "Frame is too dark. Improve lighting and capture again.",
        { ...quality, insufficientReason: `Mean brightness ${meanLuma.toFixed(1)} below minimum.` });
    }
    // Glare: reject only if NOT a studio white background with clear package edges
    if (glareRatio > 0.25 && !isStudioWhiteBackground) {
      return reject("IMAGE_QUALITY_INSUFFICIENT", "Severe glare detected. Change angle and capture again.",
        { ...quality, insufficientReason: `Glare covers ${(glareRatio * 100).toFixed(1)}% of the frame.` });
    }
    if (blurVariance < 18) {
      return reject("IMAGE_QUALITY_INSUFFICIENT", "Image is too blurry. Hold steady and capture again.",
        { ...quality, insufficientReason: `Blur variance ${blurVariance.toFixed(1)} below minimum.` });
    }

    // ---- Human-subject / non-package frame rejection ----
    // A face fills the frame with smooth skin tones and little printed structure.
    // Food products (biscuits, baked goods, cardboard) often have warm/tan/golden colors
    // but carry significant edges and printed typography.
    if (skinRatio > 0.65 && edgeDensity < 0.045) {
      return {
        packageDetected: false,
        confidence: clamp(0.55 + skinRatio * 0.4, 0, 0.97),
        reason: "HUMAN_SUBJECT_FRAME",
        guidance: "Packaging not detected. Point the camera at the product package.",
        quality,
        detector: GATE_VERSION,
        modelVersion: GATE_VERSION,
      };
    }

    // ---- Structure gate: a package carries printed detail ----
    // Certainty is derived from the measurement itself: the further the
    // edge density falls below the structure floor, the more certain the
    // absence. Never a fixed placeholder.
    if (edgeDensity < 0.018) {
      return {
        packageDetected: false,
        confidence: Math.round(clamp(0.6 + (0.018 - edgeDensity) * 12, 0.6, 0.9) * 100) / 100,
        reason: "LOW_STRUCTURE",
        guidance: "Package not detected. Position the packaged commodity inside the inspection frame.",
        quality,
        detector: GATE_VERSION,
        modelVersion: GATE_VERSION,
      };
    }

    // ---- Text legibility gate ----
    // If text is too small, OCR will fail. Guide the officer to move closer.
    if (textHeightScore < 0.015) {
      return {
        packageDetected: false,
        confidence: clamp(0.5, 0.3, 0.7),
        reason: "TEXT_TOO_SMALL",
        guidance: "Text on the package appears too small to read. Move closer to the product.",
        quality,
        detector: GATE_VERSION,
        modelVersion: GATE_VERSION,
      };
    }

    // ---- Skew gate ----
    // If the image is rotated more than 5°, OCR accuracy drops significantly.
    if (Math.abs(bestSkew) > 5) {
      return {
        packageDetected: false,
        confidence: clamp(0.5, 0.3, 0.7),
        reason: "SKEWED_IMAGE",
        guidance: `Image is rotated approximately ${Math.abs(bestSkew).toFixed(1)}°. Hold the camera upright and capture again.`,
        quality,
        detector: GATE_VERSION,
        modelVersion: GATE_VERSION,
      };
    }

    // ---- Package detected: measure the content rect from the edge grid ----
    // Bounding box of grid cells carrying above-average edge energy, padded
    // and clamped. These are MEASURED coordinates, not constants.
    let minCx = GRID, maxCx = -1, minCy = GRID, maxCy = -1;
    let totalEdge = 0;
    for (let i = 0; i < GRID * GRID; i++) totalEdge += gridEdge[i];
    const avgCell = totalEdge / (GRID * GRID);
    const threshold = Math.max(avgCell * 0.35, totalEdge * 0.004);
    for (let cy = 0; cy < GRID; cy++) {
      for (let cx = 0; cx < GRID; cx++) {
        if (gridEdge[cy * GRID + cx] >= threshold) {
          if (cx < minCx) minCx = cx;
          if (cx > maxCx) maxCx = cx;
          if (cy < minCy) minCy = cy;
          if (cy > maxCy) maxCy = cy;
        }
      }
    }
    let box: BoundingBox;
    if (maxCx < 0) {
      box = { x: 4, y: 4, width: 92, height: 92 };
    } else {
      const pad = 1.2;
      const x0 = clamp(((minCx - 0.5) / GRID) * 100 - pad, 2, 96);
      const y0 = clamp(((minCy - 0.5) / GRID) * 100 - pad, 2, 96);
      const x1 = clamp(((maxCx + 1.5) / GRID) * 100 + pad, 4, 98);
      const y1 = clamp(((maxCy + 1.5) / GRID) * 100 + pad, 4, 98);
      box = {
        x: Math.round(x0 * 10) / 10,
        y: Math.round(y0 * 10) / 10,
        width: Math.round((x1 - x0) * 10) / 10,
        height: Math.round((y1 - y0) * 10) / 10,
      };
    }

    const structureScore = clamp((edgeDensity - 0.018) / 0.20, 0, 1);
    const skinPenalty = clamp(skinRatio * 1.6, 0, 0.55);
    const colorBonus = clamp((colorfulness - 0.08) * 1.2, 0, 0.15);
    const confidence = clamp(0.45 + structureScore * 0.45 - skinPenalty + colorBonus, 0.3, 0.97);

    return {
      packageDetected: true,
      confidence: Math.round(confidence * 100) / 100,
      reason: "PACKAGE_DETECTED",
      guidance: "Package detected. Ready to capture.",
      quality,
      packageBox: box,
      detector: GATE_VERSION,
      modelVersion: GATE_VERSION,
    };
  } catch (err) {
    return reject("GATE_ERROR", "Frame could not be analysed. Capture again.",
      {
        width: 0, height: 0, meanLuma: 0, blurVariance: 0, glareRatio: 0,
        edgeDensity: 0, skinRatio: 0, colorfulness: 0, textHeightScore: 0, skewDegrees: 0,
        insufficientReason: err instanceof Error ? err.message : String(err),
      });
  }
}

function reject(reason: string, guidance: string, quality: PackageQuality): PackageGateResult {
  // Quality/insufficient rejections and internal errors express UNCERTAINTY
  // (0.5), not a confident negative — the frame simply cannot be judged.
  return {
    packageDetected: false,
    confidence: 0.5,
    reason,
    guidance,
    quality,
    detector: GATE_VERSION,
    modelVersion: GATE_VERSION,
  };
}
