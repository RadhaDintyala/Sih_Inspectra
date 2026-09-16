/**
 * Tier 0: Client-Side Classical Computer Vision Engine
 *
 * Runs locally on device via HTML5 Canvas API and TypedArrays.
 * Zero network calls. Zero AI model overhead. Zero server latency.
 *
 * Implements:
 * 1. Grayscale luminance conversion (ITU-R BT.601)
 * 2. Laplacian kernel variance (Blur detection)
 * 3. Pixel brightness histogram & spatial clustering (Glare detection)
 * 4. Sobel edge density & distribution (Framing / distance heuristic)
 * 5. Temporal frame-to-frame pixel difference (Steadiness / motion blur)
 */

export interface FrameMetrics {
  /** Laplacian variance: higher = sharper; typical sharp package > 80 */
  blurVariance: number;
  /** Fraction of saturated pixels (>240/255) across the frame (0.0 to 1.0) */
  glareRatio: number;
  /** Max glare ratio in any single 3x3 quadrant grid cell */
  maxCellGlareRatio: number;
  /** Fraction of pixels classified as strong edges (0.0 to 1.0) */
  edgeDensity: number;
  /** Mean absolute pixel difference between consecutive frames */
  motionDelta: number;
}

export type GuidanceCategory =
  | "ready"
  | "motion"
  | "glare"
  | "too_far"
  | "too_close"
  | "blurry";

export interface FrameAnalysisResult {
  isReady: boolean;
  category: GuidanceCategory;
  tip: string;
  metrics: FrameMetrics;
  checks: {
    sharp: boolean;
    glareFree: boolean;
    framed: boolean;
    steady: boolean;
  };
}

/**
 * THRESHOLD CALIBRATION & EMPIRICAL REASONING:
 *
 * 1. BLUR_VARIANCE_THRESHOLD = 80:
 *    On downscaled 320px frames, a completely blank or severely out-of-focus scene
 *    yields Laplacian variance < 25. Text and packaging printed artwork with sharp
 *    transitions yield variance between 85 and 250+. Setting the threshold at 80
 *    reliably separates legible declaration text from blurry camera movements.
 *
 * 2. GLARE_RATIO_THRESHOLD = 0.05 (5%) & MAX_CELL_GLARE_THRESHOLD = 0.12 (12%):
 *    Glossy plastic wrappers or laminated foil reflect overhead lights into blown-out
 *    specular highlights (>240 luminance). If >5% of the total frame or >12% of any
 *    spatial cell is saturated, mandatory printed declarations inside that hotspot become
 *    unrecoverable OCR dropouts.
 *
 * 3. MIN_EDGE_DENSITY = 0.035 (3.5%) & MAX_EDGE_DENSITY = 0.50 (50%):
 *    A package held at appropriate inspection distance (occupying 50-80% of preview)
 *    produces Sobel edge density between 5% and 40% from text lines, nutritional tables,
 *    and packaging contours. Less than 3.5% indicates the package is too far away or absent.
 *    Above 50% indicates the camera is jammed into extreme high-frequency visual clutter.
 *
 * 4. MOTION_DELTA_THRESHOLD = 12.0:
 *    Temporal mean absolute difference (MAD) of grayscale pixels across consecutive frames
 *    (~180ms apart). A held-steady hand produces delta < 6. Rapid translation or shaking
 *    spikes delta > 15-30, posing immediate motion-blur risk to declaration readability.
 */
export const CV_THRESHOLDS = {
  BLUR_VARIANCE_MIN: 80,
  GLARE_RATIO_MAX: 0.05,
  MAX_CELL_GLARE_MAX: 0.12,
  EDGE_DENSITY_MIN: 0.035,
  EDGE_DENSITY_MAX: 0.50,
  MOTION_DELTA_MAX: 12.0,
} as const;

/**
 * Convert RGBA ImageData to grayscale Uint8Array using standard luminance weights:
 * Y = 0.299*R + 0.587*G + 0.114*B
 */
export function toGrayscale(data: Uint8ClampedArray, width: number, height: number, out?: Uint8Array): Uint8Array {
  const totalPixels = width * height;
  const gray = out && out.length === totalPixels ? out : new Uint8Array(totalPixels);

  for (let i = 0, p = 0; i < totalPixels; i++, p += 4) {
    // Integer approximation of standard luminance: (R*77 + G*150 + B*29) >> 8
    gray[i] = (data[p] * 77 + data[p + 1] * 150 + data[p + 2] * 29) >> 8;
  }

  return gray;
}

/**
 * Compute Laplacian variance on grayscale image.
 * Low variance = blurry; high variance = sharp.
 */
export function computeLaplacianVariance(gray: Uint8Array, width: number, height: number): number {
  if (width < 3 || height < 3) return 0;

  let sum = 0;
  let sumSq = 0;
  let count = 0;

  // Apply discrete 3x3 Laplacian kernel:
  // [  0,  1,  0 ]
  // [  1, -4,  1 ]
  // [  0,  1,  0 ]
  for (let y = 1; y < height - 1; y++) {
    const rowOffset = y * width;
    const prevRow = (y - 1) * width;
    const nextRow = (y + 1) * width;

    for (let x = 1; x < width - 1; x++) {
      const center = gray[rowOffset + x];
      const val =
        gray[prevRow + x] +
        gray[nextRow + x] +
        gray[rowOffset + x - 1] +
        gray[rowOffset + x + 1] -
        4 * center;

      sum += val;
      sumSq += val * val;
      count++;
    }
  }

  if (count === 0) return 0;
  const mean = sum / count;
  const variance = sumSq / count - mean * mean;
  return Math.max(0, variance);
}

/**
 * Detect specular glare by analyzing brightness distribution and spatial concentration.
 */
export function computeGlareMetrics(
  gray: Uint8Array,
  width: number,
  height: number,
): { glareRatio: number; maxCellGlareRatio: number } {
  const totalPixels = gray.length;
  if (totalPixels === 0) return { glareRatio: 0, maxCellGlareRatio: 0 };

  const GRID_SIZE = 3;
  const cellWidth = Math.floor(width / GRID_SIZE);
  const cellHeight = Math.floor(height / GRID_SIZE);
  const cellSaturated = new Int32Array(GRID_SIZE * GRID_SIZE);
  const cellTotals = new Int32Array(GRID_SIZE * GRID_SIZE);

  let totalSaturated = 0;

  for (let y = 0; y < height; y++) {
    const gridY = Math.min(GRID_SIZE - 1, Math.floor(y / cellHeight));
    const rowOffset = y * width;

    for (let x = 0; x < width; x++) {
      const gridX = Math.min(GRID_SIZE - 1, Math.floor(x / cellWidth));
      const cellIndex = gridY * GRID_SIZE + gridX;

      cellTotals[cellIndex]++;
      if (gray[rowOffset + x] >= 240) {
        totalSaturated++;
        cellSaturated[cellIndex]++;
      }
    }
  }

  let maxCellGlareRatio = 0;
  for (let i = 0; i < cellSaturated.length; i++) {
    if (cellTotals[i] > 0) {
      const cellRatio = cellSaturated[i] / cellTotals[i];
      if (cellRatio > maxCellGlareRatio) maxCellGlareRatio = cellRatio;
    }
  }

  return {
    glareRatio: totalSaturated / totalPixels,
    maxCellGlareRatio,
  };
}

/**
 * Compute edge density using 3x3 Sobel kernels to assess framing and text presence.
 */
export function computeEdgeDensity(gray: Uint8Array, width: number, height: number): number {
  if (width < 3 || height < 3) return 0;

  let edgeCount = 0;
  let count = 0;
  const EDGE_MAGNITUDE_THRESHOLD = 70;

  for (let y = 1; y < height - 1; y++) {
    const r0 = (y - 1) * width;
    const r1 = y * width;
    const r2 = (y + 1) * width;

    for (let x = 1; x < width - 1; x++) {
      // Horizontal Sobel Gx:
      // [-1, 0, +1]
      // [-2, 0, +2]
      // [-1, 0, +1]
      const gx =
        -gray[r0 + x - 1] + gray[r0 + x + 1] +
        -2 * gray[r1 + x - 1] + 2 * gray[r1 + x + 1] +
        -gray[r2 + x - 1] + gray[r2 + x + 1];

      // Vertical Sobel Gy:
      // [-1, -2, -1]
      // [ 0,  0,  0]
      // [+1, +2, +1]
      const gy =
        -gray[r0 + x - 1] - 2 * gray[r0 + x] - gray[r0 + x + 1] +
        gray[r2 + x - 1] + 2 * gray[r2 + x] + gray[r2 + x + 1];

      const mag = Math.abs(gx) + Math.abs(gy);
      if (mag > EDGE_MAGNITUDE_THRESHOLD) {
        edgeCount++;
      }
      count++;
    }
  }

  return count > 0 ? edgeCount / count : 0;
}

/**
 * Compute mean absolute difference between current and previous frame.
 */
export function computeMotionDelta(current: Uint8Array, previous: Uint8Array | null): number {
  if (!previous || previous.length !== current.length) return 0;

  let sumDiff = 0;
  const len = current.length;

  for (let i = 0; i < len; i++) {
    sumDiff += Math.abs(current[i] - previous[i]);
  }

  return sumDiff / len;
}

/**
 * Analyze camera frame quality and framing in real-time.
 * Returns actionable single-line guidance and readiness status.
 */
export function analyzeFrame(
  imageData: ImageData,
  previousGray: Uint8Array | null,
): { result: FrameAnalysisResult; gray: Uint8Array } {
  const { width, height, data } = imageData;
  const gray = toGrayscale(data, width, height);

  const blurVariance = computeLaplacianVariance(gray, width, height);
  const { glareRatio, maxCellGlareRatio } = computeGlareMetrics(gray, width, height);
  const edgeDensity = computeEdgeDensity(gray, width, height);
  const motionDelta = computeMotionDelta(gray, previousGray);

  const steady = previousGray === null || motionDelta <= CV_THRESHOLDS.MOTION_DELTA_MAX;
  const glareFree =
    glareRatio <= CV_THRESHOLDS.GLARE_RATIO_MAX &&
    maxCellGlareRatio <= CV_THRESHOLDS.MAX_CELL_GLARE_MAX;
  const sharp = blurVariance >= CV_THRESHOLDS.BLUR_VARIANCE_MIN;
  const framed =
    edgeDensity >= CV_THRESHOLDS.EDGE_DENSITY_MIN &&
    edgeDensity <= CV_THRESHOLDS.EDGE_DENSITY_MAX;

  const isReady = steady && glareFree && sharp && framed;

  let category: GuidanceCategory = "ready";
  let tip = "Good — ready to capture";

  // Prioritized guidance hierarchy
  if (!steady) {
    category = "motion";
    tip = "Hold steady";
  } else if (!glareFree) {
    category = "glare";
    tip = "Glare detected — tilt packet slightly";
  } else if (edgeDensity < CV_THRESHOLDS.EDGE_DENSITY_MIN) {
    category = "too_far";
    tip = "Move closer — fill more of the frame";
  } else if (edgeDensity > CV_THRESHOLDS.EDGE_DENSITY_MAX) {
    category = "too_close";
    tip = "Move back slightly";
  } else if (!sharp) {
    category = "blurry";
    tip = "Too blurry — move closer or improve lighting";
  }

  return {
    result: {
      isReady,
      category,
      tip,
      metrics: {
        blurVariance: Math.round(blurVariance * 10) / 10,
        glareRatio: Math.round(glareRatio * 1000) / 1000,
        maxCellGlareRatio: Math.round(maxCellGlareRatio * 1000) / 1000,
        edgeDensity: Math.round(edgeDensity * 1000) / 1000,
        motionDelta: Math.round(motionDelta * 10) / 10,
      },
      checks: {
        sharp,
        glareFree,
        framed,
        steady,
      },
    },
    gray,
  };
}
