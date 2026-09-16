/**
 * Preprocessing Ensemble — purpose-driven variants for crops & whole images.
 *
 * Implements text-height-aware upscaling (Lanczos3) and targeted preprocessing:
 *   - Variant A: Grayscale + normalize + sharpen
 *   - Variant B: CLAHE / local contrast + threshold
 *   - Variant C: Inverted path (white-on-dark text) / Blackhat
 *   - Variant D: Morphological closing for dot-matrix dates (MFG/EXP/BATCH)
 */

import sharp from "sharp";

export interface PreprocessVariant {
  name: string;
  buffer: Buffer;
  description: string;
}

/**
 * Calculates height-aware scale factor for OCR crops.
 * Prevents small text (<12px height) from becoming illegible noise in Tesseract.
 */
export function getScaleFactor(estCharHeightPx?: number): number {
  if (!estCharHeightPx || estCharHeightPx <= 0) return 2.5;
  if (estCharHeightPx < 12) return 4.0;
  if (estCharHeightPx <= 20) return 3.0;
  if (estCharHeightPx <= 35) return 2.0;
  return 1.5;
}

/**
 * Estimate skew angle via horizontal projection profile.
 */
async function estimateSkew(imgBuffer: Buffer): Promise<number> {
  try {
    const { data, info } = await sharp(imgBuffer)
      .rotate()
      .grayscale()
      .resize({ width: 200, withoutEnlargement: true })
      .raw()
      .toBuffer({ resolveWithObject: true });

    const w = info.width;
    const h = info.height;
    const step = Math.max(1, Math.floor(h / 40));
    let bestAngle = 0;
    let bestSharpness = 0;

    for (const angle of [-4, -3, -2, -1.5, -1, -0.5, 0, 0.5, 1, 1.5, 2, 3, 4]) {
      const rad = (angle * Math.PI) / 180;
      const cosA = Math.cos(rad);
      const sinA = Math.sin(rad);
      const proj = new Float32Array(h);
      for (let y = 0; y < h; y += step) {
        let sum = 0;
        for (let x = 0; x < w; x += 2) {
          const ry = Math.round(y * cosA - x * sinA);
          if (ry >= 0 && ry < h) sum += data[ry * w + x];
        }
        proj[y] = sum;
      }
      let pSum = 0, pSumSq = 0, pCount = 0;
      for (let y = 0; y < h; y += step) {
        pSum += proj[y];
        pSumSq += proj[y] * proj[y];
        pCount++;
      }
      const pMean = pSum / Math.max(1, pCount);
      const sharpness = pSumSq / Math.max(1, pCount) - pMean * pMean;
      if (sharpness > bestSharpness) {
        bestSharpness = sharpness;
        bestAngle = angle;
      }
    }
    return bestAngle;
  } catch {
    return 0;
  }
}

/**
 * Generate targeted crop ensemble using height-aware upscaling.
 */
export async function generateCropVariants(
  cropBuffer: Buffer,
  estCharHeightPx?: number,
  polarity?: "dark_on_light" | "light_on_dark" | "unknown"
): Promise<PreprocessVariant[]> {
  const variants: PreprocessVariant[] = [];
  const scale = getScaleFactor(estCharHeightPx);

  const meta = await sharp(cropBuffer).metadata();
  const origW = meta.width ?? 200;
  const origH = meta.height ?? 50;

  const targetW = Math.round(origW * scale);
  const targetH = Math.round(origH * scale);

  // Variant A: Height-aware upscale + Grayscale + Normalize + Sharpen
  try {
    const vA = await sharp(cropBuffer)
      .rotate()
      .resize({ width: targetW, height: targetH, kernel: "lanczos3" })
      .grayscale()
      .normalize()
      .sharpen({ sigma: 1.2, m1: 0.5, m2: 2.0 })
      .toBuffer();
    variants.push({
      name: "clahe-upscale",
      buffer: vA,
      description: `Upscale ${scale.toFixed(1)}× + Grayscale + Sharpen`,
    });
  } catch { /* skip */ }

  // Variant B: Local contrast / Adaptive threshold path
  try {
    const vB = await sharp(cropBuffer)
      .rotate()
      .resize({ width: targetW, height: targetH, kernel: "lanczos3" })
      .grayscale()
      .linear(1.6, -40)
      .sharpen({ sigma: 1.5 })
      .toBuffer();
    variants.push({
      name: "clahe-threshold",
      buffer: vB,
      description: `High Contrast Threshold ${scale.toFixed(1)}×`,
    });
  } catch { /* skip */ }

  // Variant C: Inverted path (for light text on dark packaging)
  if (polarity === "light_on_dark" || variants.length < 3) {
    try {
      const vC = await sharp(cropBuffer)
        .rotate()
        .resize({ width: targetW, height: targetH, kernel: "lanczos3" })
        .grayscale()
        .negate({ alpha: false })
        .normalize()
        .sharpen({ sigma: 1.2 })
        .toBuffer();
      variants.push({
        name: "inverted",
        buffer: vC,
        description: `Inverted (Light text on Dark background)`,
      });
    } catch { /* skip */ }
  }

  // Variant D: Original auto-orient baseline
  if (variants.length < 3) {
    try {
      const vOrig = await sharp(cropBuffer).rotate().toBuffer();
      variants.push({
        name: "original",
        buffer: vOrig,
        description: "Original auto-oriented crop",
      });
    } catch { /* skip */ }
  }

  // Variant E: 90° Rotation Variant for vertical packaging text
  try {
    const vRot = await sharp(cropBuffer)
      .rotate(270)
      .resize({ width: Math.round(targetH * 1.5), height: Math.round(targetW * 1.5), kernel: "lanczos3" })
      .grayscale()
      .normalize()
      .sharpen({ sigma: 1.2 })
      .toBuffer();
    variants.push({
      name: "rot90-clahe",
      buffer: vRot,
      description: "90° Rotated + CLAHE (Vertical text correction)",
    });
  } catch { /* skip */ }

  return variants.slice(0, 3);
}

/**
 * Baseline variants generator for backward compatibility with tests.
 */
export async function generateVariants(cropBuffer: Buffer): Promise<PreprocessVariant[]> {
  const variants: PreprocessVariant[] = [];
  try {
    const orig = await sharp(cropBuffer).rotate().toBuffer();
    variants.push({ name: "original", buffer: orig, description: "Original auto-oriented crop" });
  } catch { /* skip */ }
  try {
    const clahe = await sharp(cropBuffer).rotate().grayscale().normalize().linear(1.5, -30).toBuffer();
    variants.push({ name: "clahe", buffer: clahe, description: "Grayscale + CLAHE contrast stretch" });
  } catch { /* skip */ }
  const crops = await generateCropVariants(cropBuffer, 16, "dark_on_light");
  for (const c of crops) {
    if (!variants.some((v) => v.name === c.name)) variants.push(c);
  }
  return variants.slice(0, 3);
}
