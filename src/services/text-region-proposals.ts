/**
 * Text Region Proposals Engine — Classical Computer Vision for Packaging OCR.
 *
 * Replaces coarse whole-image OCR with tight, line-level and block-level crops.
 * Uses edge gradients, morphological filtering, projection profiles, and
 * connected components to locate text regions inside the package ROI.
 *
 * NO generative AI, NO cloud APIs, NO heavy neural nets. Pure offline TS/Sharp.
 */

import sharp from "sharp";
import type { BoundingBox } from "@/domain/inspection";

export interface TextROI {
  id: string;
  /** Normalized coordinates (0–100%). */
  bbox: BoundingBox;
  /** Pixel coordinates on the working image. */
  pixelBbox: { left: number; top: number; width: number; height: number };
  score: number;
  estCharHeightPx: number;
  polarity: "dark_on_light" | "light_on_dark" | "unknown";
  aspectRatio: number;
  regionType: "single_line" | "text_block" | "code_word";
}

export interface ProposalOptions {
  maxRegions?: number;
  minCharHeightPx?: number;
}

export const MAX_TEXT_REGIONS = 12;

/**
 * Extracts tight text region proposals from an image buffer (or package ROI crop).
 */
export async function extractTextRegions(
  imageBuffer: Buffer,
  options: ProposalOptions = {}
): Promise<TextROI[]> {
  const maxRegions = options.maxRegions ?? MAX_TEXT_REGIONS;
  const minCharHeightPx = options.minCharHeightPx ?? 8;

  const metadata = await sharp(imageBuffer).metadata();
  const origW = metadata.width ?? 1000;
  const origH = metadata.height ?? 1000;

  if (origW < 50 || origH < 50) return [];

  // Standardize working width to ~1000px for reliable char height calculation
  const WORK_W = Math.min(1200, Math.max(600, origW));
  const scale = WORK_W / origW;
  const WORK_H = Math.round(origH * scale);

  const { data, info } = await sharp(imageBuffer)
    .rotate()
    .resize({ width: WORK_W, height: WORK_H, fit: "fill" })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const W = info.width;
  const H = info.height;
  const n = W * H;

  // 1. Compute Sobel Gradient Magnitude & Local Contrast
  const edgeMag = new Float32Array(n);
  let peakEdge = 0;

  for (let y = 1; y < H - 1; y++) {
    const row = y * W;
    for (let x = 1; x < W - 1; x++) {
      const idx = row + x;
      const gx = data[idx + 1] - data[idx - 1];
      const gy = data[idx + W] - data[idx - W];
      const mag = Math.sqrt(gx * gx + gy * gy);
      edgeMag[idx] = mag;
      if (mag > peakEdge) peakEdge = mag;
    }
  }

  // Adaptive binarization of high-gradient text pixels
  const threshold = Math.max(peakEdge * 0.15, 18);
  const binaryText = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    binaryText[i] = edgeMag[i] >= threshold ? 1 : 0;
  }

  // 2. Horizontal Projection Profile (line detection)
  const hProfile = new Int32Array(H);
  for (let y = 0; y < H; y++) {
    let count = 0;
    const row = y * W;
    for (let x = 0; x < W; x++) {
      if (binaryText[row + x]) count++;
    }
    hProfile[y] = count;
  }

  // Locate horizontal text bands (row ranges with significant edge density)
  const avgRowEdge = hProfile.reduce((a, b) => a + b, 0) / Math.max(1, H);
  const bandThreshold = Math.max(avgRowEdge * 0.4, 4);

  const lineBands: Array<{ top: number; bottom: number; height: number }> = [];
  let bandTop = -1;

  for (let y = 0; y < H; y++) {
    if (hProfile[y] >= bandThreshold) {
      if (bandTop < 0) bandTop = y;
    } else {
      if (bandTop >= 0) {
        const height = y - bandTop;
        if (height >= 6 && height <= Math.round(H * 0.35)) {
          lineBands.push({ top: bandTop, bottom: y - 1, height });
        }
        bandTop = -1;
      }
    }
  }
  if (bandTop >= 0) {
    const height = H - bandTop;
    if (height >= 6 && height <= Math.round(H * 0.35)) {
      lineBands.push({ top: bandTop, bottom: H - 1, height });
    }
  }

  // 3. Vertical Projection Profile per Horizontal Band to find tight boxes
  const proposals: TextROI[] = [];

  for (const band of lineBands) {
    const vProfile = new Int32Array(W);
    for (let x = 0; x < W; x++) {
      let count = 0;
      for (let y = band.top; y <= band.bottom; y++) {
        if (binaryText[y * W + x]) count++;
      }
      vProfile[x] = count;
    }

    // Dilate/bridge nearby characters horizontally (within ~15px gap)
    const gapBridge = Math.max(8, Math.round(band.height * 0.8));
    let left = -1;
    let gapCount = 0;

    for (let x = 0; x < W; x++) {
      if (vProfile[x] > 0) {
        if (left < 0) left = x;
        gapCount = 0;
      } else {
        if (left >= 0) {
          gapCount++;
          if (gapCount > gapBridge || x === W - 1) {
            const right = x - gapCount;
            const width = right - left + 1;
            const height = band.height;

            if (width >= 15 && height >= 6) {
              // Extract pixel statistics for polarity & char height estimation
              let sumPx = 0;
              let pxCount = 0;
              const pxValues: number[] = [];

              for (let py = band.top; py <= band.bottom; py++) {
                const pRow = py * W;
                for (let px = left; px <= right; px++) {
                  const val = data[pRow + px];
                  sumPx += val;
                  pxCount++;
                  if (pxCount % 3 === 0) pxValues.push(val);
                }
              }

              pxValues.sort((a, b) => a - b);
              const p20 = pxValues[Math.floor(pxValues.length * 0.2)] ?? 50;
              const p80 = pxValues[Math.floor(pxValues.length * 0.8)] ?? 200;
              const meanVal = sumPx / Math.max(1, pxCount);

              // Polarity: compare background vs text intensity
              const polarity: TextROI["polarity"] =
                meanVal > 128 ? "dark_on_light" : "light_on_dark";

              // Est char height: ~70% of line band height scaled back to original image
              const charHeightWorkPx = Math.max(8, height * 0.72);
              const estCharHeightPx = Math.round(charHeightWorkPx / scale);

              // Map coordinates back to original image & normalized percentages
              const origLeft = Math.max(0, Math.floor(left / scale));
              const origTop = Math.max(0, Math.floor(band.top / scale));
              const origWidth = Math.min(origW - origLeft, Math.ceil(width / scale));
              const origHeight = Math.min(origH - origTop, Math.ceil(height / scale));

              const aspectRatio = origWidth / Math.max(1, origHeight);

              // Region type classification
              const regionType: TextROI["regionType"] =
                aspectRatio > 4.0
                  ? "single_line"
                  : aspectRatio < 1.5 && origHeight > 30
                  ? "text_block"
                  : "single_line";

              // Score proposal based on contrast, aspect ratio, edge density
              const contrastRatio = (p80 - p20) / 255;
              const aspectScore = aspectRatio >= 1.2 && aspectRatio <= 25 ? 1.0 : 0.4;
              const sizeScore = origWidth >= 30 && origHeight >= minCharHeightPx ? 1.0 : 0.3;
              const score = contrastRatio * 0.4 + aspectScore * 0.3 + sizeScore * 0.3;

              proposals.push({
                id: `roi-${proposals.length + 1}`,
                bbox: {
                  x: Math.round((origLeft / origW) * 1000) / 10,
                  y: Math.round((origTop / origH) * 1000) / 10,
                  width: Math.round((origWidth / origW) * 1000) / 10,
                  height: Math.round((origHeight / origH) * 1000) / 10,
                },
                pixelBbox: {
                  left: origLeft,
                  top: origTop,
                  width: origWidth,
                  height: origHeight,
                },
                score: Math.round(score * 100) / 100,
                estCharHeightPx,
                polarity,
                aspectRatio: Math.round(aspectRatio * 100) / 100,
                regionType,
              });
            }
            left = -1;
            gapCount = 0;
          }
        }
      }
    }
  }

  // 4. Non-Maximum Suppression (NMS) to merge/filter overlapping bboxes
  const sorted = proposals.sort((a, b) => b.score - a.score);
  const selected: TextROI[] = [];

  for (const p of sorted) {
    let overlaps = false;
    for (const s of selected) {
      if (computeIoU(p.pixelBbox, s.pixelBbox) > 0.45) {
        overlaps = true;
        break;
      }
    }
    if (!overlaps) {
      selected.push(p);
    }
    if (selected.length >= maxRegions) break;
  }

  // If classical proposals found < 2 regions, create a central fallback proposal
  if (selected.length === 0) {
    selected.push({
      id: "roi-fallback-center",
      bbox: { x: 10, y: 15, width: 80, height: 70 },
      pixelBbox: {
        left: Math.round(origW * 0.1),
        top: Math.round(origH * 0.15),
        width: Math.round(origW * 0.8),
        height: Math.round(origH * 0.7),
      },
      score: 0.5,
      estCharHeightPx: Math.max(12, Math.round(origH * 0.04)),
      polarity: "dark_on_light",
      aspectRatio: (origW * 0.8) / (origH * 0.7),
      regionType: "text_block",
    });
  }

  return selected;
}

function computeIoU(
  a: { left: number; top: number; width: number; height: number },
  b: { left: number; top: number; width: number; height: number }
): number {
  const x1 = Math.max(a.left, b.left);
  const y1 = Math.max(a.top, b.top);
  const x2 = Math.min(a.left + a.width, b.left + b.width);
  const y2 = Math.min(a.top + a.height, b.top + b.height);

  const interWidth = Math.max(0, x2 - x1);
  const interHeight = Math.max(0, y2 - y1);
  const interArea = interWidth * interHeight;

  const areaA = a.width * a.height;
  const areaB = b.width * b.height;
  const unionArea = areaA + areaB - interArea;

  return unionArea > 0 ? interArea / unionArea : 0;
}
