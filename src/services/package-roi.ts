/**
 * Package ROI Localization — HONEST deterministic CV.
 *
 * NOT a trained detector. Generates multiple candidate ROIs using
 * edge/contour analysis, scores them, and returns the best if it
 * clears a documented threshold. Otherwise returns UNCERTAIN.
 *
 * Pipeline position: IMAGE → ROI CANDIDATES → CROP → OCR
 */

import sharp from "sharp";
import type { BoundingBox } from "@/domain/inspection";

export interface RoiCandidate {
  bbox: BoundingBox;
  score: number;
  /** Area as fraction of total image (0–1). */
  areaFraction: number;
  /** Mean edge density inside this ROI. */
  edgeDensity: number;
  /** Fraction of ROI pixels that are text-like (dark on light). */
  textDensity: number;
  /** How central the ROI is (0 = edge, 1 = center). */
  centrality: number;
  /** Aspect ratio (w/h). */
  aspectRatio: number;
  reason: string;
}

export interface RoiDetectionResult {
  candidates: RoiCandidate[];
  selected: RoiCandidate | null;
  status: "CONFIDENT" | "UNCERTAIN" | "NO_PACKAGE";
  imageWidth: number;
  imageHeight: number;
  analysisMs: number;
}

/**
 * Analyse an image buffer and return package ROI candidates.
 *
 * Uses edge detection + contour grouping on a downscaled working copy.
 * Never modifies the original buffer.
 */
export async function detectPackageRoi(imageBuffer: Buffer): Promise<RoiDetectionResult> {
  const t0 = Date.now();

  const meta = await sharp(imageBuffer).metadata();
  const imgW = meta.width ?? 0;
  const imgH = meta.height ?? 0;

  if (!imgW || !imgH || imgW < 100 || imgH < 100) {
    return { candidates: [], selected: null, status: "NO_PACKAGE", imageWidth: imgW, imageHeight: imgH, analysisMs: Date.now() - t0 };
  }

  // Work at 600px width for speed — enough for contour analysis.
  const WORK_W = 600;
  const scale = WORK_W / imgW;
  const workH = Math.max(60, Math.round(imgH * scale));

  const { data, info } = await sharp(imageBuffer)
    .rotate() // EXIF normalization
    .resize({ width: WORK_W, height: workH, fit: "fill" })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const W = info.width;
  const H = info.height;
  const channels = info.channels;
  const n = W * H;

  // ── 1. Build grayscale field ─────────────────────────────────────
  const gray = new Float32Array(n);
  for (let i = 0; i < n; i++) gray[i] = data[i * channels];

  // ── 2. Sobel edge magnitude ──────────────────────────────────────
  const edgeMag = new Float32Array(n);
  let peakEdge = 0;
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const c = y * W + x;
      const gx = gray[c + 1] - gray[c - 1];
      const gy = gray[c + W] - gray[c - W];
      const mag = Math.sqrt(gx * gx + gy * gy);
      edgeMag[c] = mag;
      if (mag > peakEdge) peakEdge = mag;
    }
  }

  // ── 3. Adaptive threshold to get binary edge map ─────────────────
  const edgeThreshold = Math.max(peakEdge * 0.15, 20);
  const binaryEdge = new Uint8Array(n);
  for (let i = 0; i < n; i++) binaryEdge[i] = edgeMag[i] > edgeThreshold ? 1 : 0;

  // ── 4. Connected-component labeling (union-find) ─────────────────
  const labels = new Int32Array(n);
  let nextLabel = 1;
  const parent = new Int32Array(n + 1);
  const rank = new Uint8Array(n + 1);
  for (let i = 0; i <= n; i++) parent[i] = i;

  function find(x: number): number {
    while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; }
    return x;
  }
  function union(a: number, b: number) {
    const ra = find(a), rb = find(b);
    if (ra === rb) return;
    if (rank[ra] < rank[rb]) { parent[ra] = rb; }
    else if (rank[ra] > rank[rb]) { parent[rb] = ra; }
    else { parent[rb] = ra; rank[ra]++; }
  }

  // Two-pass labeling
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const c = y * W + x;
      if (!binaryEdge[c]) continue;
      // Check left and up neighbors
      const left = x > 0 ? c - 1 : -1;
      const up = y > 0 ? c - W : -1;
      const leftLabel = left >= 0 && binaryEdge[left] ? labels[left] : 0;
      const upLabel = up >= 0 && binaryEdge[up] ? labels[up] : 0;

      if (leftLabel === 0 && upLabel === 0) {
        labels[c] = nextLabel++;
        parent[nextLabel - 1] = nextLabel - 1;
      } else if (leftLabel > 0 && upLabel === 0) {
        labels[c] = leftLabel;
      } else if (leftLabel === 0 && upLabel > 0) {
        labels[c] = upLabel;
      } else {
        labels[c] = Math.min(leftLabel, upLabel);
        if (leftLabel !== upLabel) union(leftLabel, upLabel);
      }
    }
  }

  // ── 5. Compute bounding boxes per component ──────────────────────
  const compBoxes = new Map<number, { minX: number; maxX: number; minY: number; maxY: number; count: number }>();
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const c = y * W + x;
      if (!labels[c]) continue;
      const root = find(labels[c]);
      let box = compBoxes.get(root);
      if (!box) { box = { minX: x, maxX: x, minY: y, maxY: y, count: 0 }; compBoxes.set(root, box); }
      if (x < box.minX) box.minX = x;
      if (x > box.maxX) box.maxX = x;
      if (y < box.minY) box.minY = y;
      if (y > box.maxY) box.maxY = y;
      box.count++;
    }
  }

  // ── 6. Generate ROI candidates from large components ─────────────
  const MIN_COMPONENT_SIZE = 80;
  const MIN_BOX_DIM = 30;
  const candidates: RoiCandidate[] = [];

  for (const [, box] of compBoxes) {
    if (box.count < MIN_COMPONENT_SIZE) continue;
    const bw = box.maxX - box.minX + 1;
    const bh = box.maxY - box.minY + 1;
    if (bw < MIN_BOX_DIM || bh < MIN_BOX_DIM) continue;

    // Pad 12% around the component
    const padX = Math.round(bw * 0.12);
    const padY = Math.round(bh * 0.12);
    const x0 = Math.max(0, box.minX - padX);
    const y0 = Math.max(0, box.minY - padY);
    const x1 = Math.min(W - 1, box.maxX + padX);
    const y1 = Math.min(H - 1, box.maxY + padY);

    const roiW = x1 - x0 + 1;
    const roiH = y1 - y0 + 1;
    const areaFraction = (roiW * roiH) / n;
    const aspectRatio = roiW / roiH;

    // Reject unreasonable aspect ratios
    if (aspectRatio < 0.15 || aspectRatio > 6.5) continue;
    // Reject too-small or too-large ROIs
    if (areaFraction < 0.03 || areaFraction > 0.85) continue;

    // Compute edge density inside this ROI
    let roiEdgeCount = 0;
    let roiPixelCount = 0;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        roiPixelCount++;
        if (binaryEdge[y * W + x]) roiEdgeCount++;
      }
    }
    const edgeDensity = roiPixelCount > 0 ? roiEdgeCount / roiPixelCount : 0;

    // Compute text-like density (dark pixels on light background)
    let textCount = 0;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (gray[y * W + x] < 140) textCount++;
      }
    }
    const textDensity = roiPixelCount > 0 ? textCount / roiPixelCount : 0;

    // Centrality: 1 = dead center, 0 = corner
    const cx = (x0 + x1) / 2 / W;
    const cy = (y0 + y1) / 2 / H;
    const centrality = 1 - Math.sqrt((cx - 0.5) ** 2 + (cy - 0.5) ** 2) * 2;

    // Score: weighted combination
    const areaScore = areaFraction > 0.08 && areaFraction < 0.65 ? 1.0 : 0.3;
    const edgeScore = edgeDensity > 0.04 ? Math.min(edgeDensity * 10, 1.0) : 0.2;
    const textScore = textDensity > 0.02 && textDensity < 0.6 ? 0.8 : 0.3;
    const centerScore = Math.max(0, centrality);
    const aspectScore = aspectRatio > 0.4 && aspectRatio < 2.5 ? 1.0 : 0.5;

    const score = (edgeScore * 0.30 + textScore * 0.25 + centerScore * 0.20 + areaScore * 0.15 + aspectScore * 0.10);

    // Convert to 0-100% coordinates
    const bbox: BoundingBox = {
      x: Math.round((x0 / W) * 1000) / 10,
      y: Math.round((y0 / H) * 1000) / 10,
      width: Math.round((roiW / W) * 1000) / 10,
      height: Math.round((roiH / H) * 1000) / 10,
    };

    candidates.push({
      bbox,
      score: Math.round(score * 100) / 100,
      areaFraction: Math.round(areaFraction * 100) / 100,
      edgeDensity: Math.round(edgeDensity * 1000) / 1000,
      textDensity: Math.round(textDensity * 1000) / 1000,
      centrality: Math.round(centrality * 100) / 100,
      aspectRatio: Math.round(aspectRatio * 100) / 100,
      reason: `edge=${edgeDensity.toFixed(3)} text=${textDensity.toFixed(3)} center=${centrality.toFixed(2)} area=${areaFraction.toFixed(2)}`,
    });
  }

  // Sort by score descending
  candidates.sort((a, b) => b.score - a.score);

  // ── 7. Select best candidate or return UNCERTAIN ─────────────────
  const THRESHOLD = 0.35;
  const best = candidates[0] ?? null;
  const status = best && best.score >= THRESHOLD ? "CONFIDENT" : candidates.length > 0 ? "UNCERTAIN" : "NO_PACKAGE";

  return {
    candidates: candidates.slice(0, 5),
    selected: best && best.score >= THRESHOLD ? best : null,
    status,
    imageWidth: imgW,
    imageHeight: imgH,
    analysisMs: Date.now() - t0,
  };
}
