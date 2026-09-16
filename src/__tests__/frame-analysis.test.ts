import { describe, it, expect } from "vitest";
import {
  toGrayscale,
  computeLaplacianVariance,
  computeGlareMetrics,
  computeEdgeDensity,
  computeMotionDelta,
  analyzeFrame,
  CV_THRESHOLDS,
} from "@/services/frame-analysis";

/** Helper to create synthetic ImageData */
function makeImageData(width: number, height: number, fillFn: (x: number, y: number) => [number, number, number]): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const [r, g, b] = fillFn(x, y);
      data[idx] = r;
      data[idx + 1] = g;
      data[idx + 2] = b;
      data[idx + 3] = 255;
    }
  }
  return { width, height, data, colorSpace: "srgb" } as ImageData;
}

describe("Tier 0 Frame Analysis — Classical CV Heuristics", () => {
  const W = 64;
  const H = 64;

  describe("toGrayscale", () => {
    it("converts RGB to grayscale using standard luminance weights", () => {
      // Pure red: (255, 0, 0) -> (255 * 77) >> 8 = 76
      const img = makeImageData(2, 2, () => [255, 0, 0]);
      const gray = toGrayscale(img.data, 2, 2);
      expect(gray[0]).toBe(76);

      // Pure white: (255, 255, 255) -> (255*77 + 255*150 + 255*29) >> 8 = 255
      const whiteImg = makeImageData(2, 2, () => [255, 255, 255]);
      const whiteGray = toGrayscale(whiteImg.data, 2, 2);
      expect(whiteGray[0]).toBe(255);
    });
  });

  describe("computeLaplacianVariance (Blur Detection)", () => {
    it("returns near-zero variance for a uniform / flat image", () => {
      const gray = new Uint8Array(W * H).fill(128);
      const variance = computeLaplacianVariance(gray, W, H);
      expect(variance).toBe(0);
    });

    it("returns high variance for a sharp checkerboard pattern", () => {
      const gray = new Uint8Array(W * H);
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          gray[y * W + x] = (x + y) % 2 === 0 ? 240 : 20;
        }
      }
      const variance = computeLaplacianVariance(gray, W, H);
      expect(variance).toBeGreaterThan(CV_THRESHOLDS.BLUR_VARIANCE_MIN);
    });

    it("returns lower variance for a smooth / blurry gradient than high-frequency text", () => {
      const smooth = new Uint8Array(W * H);
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          smooth[y * W + x] = Math.floor((x / W) * 100);
        }
      }
      const smoothVariance = computeLaplacianVariance(smooth, W, H);
      expect(smoothVariance).toBeLessThan(CV_THRESHOLDS.BLUR_VARIANCE_MIN);
    });
  });

  describe("computeGlareMetrics", () => {
    it("reports zero glare for normally exposed frame", () => {
      const gray = new Uint8Array(W * H).fill(140);
      const metrics = computeGlareMetrics(gray, W, H);
      expect(metrics.glareRatio).toBe(0);
      expect(metrics.maxCellGlareRatio).toBe(0);
    });

    it("detects glare hotspot when specular reflection is present", () => {
      const gray = new Uint8Array(W * H).fill(100);
      // Place a concentrated 15x15 saturated hotspot in top-left cell
      for (let y = 5; y < 20; y++) {
        for (let x = 5; x < 20; x++) {
          gray[y * W + x] = 250;
        }
      }
      const metrics = computeGlareMetrics(gray, W, H);
      expect(metrics.glareRatio).toBeGreaterThan(0.04);
      expect(metrics.maxCellGlareRatio).toBeGreaterThan(CV_THRESHOLDS.MAX_CELL_GLARE_MAX);
    });
  });

  describe("computeEdgeDensity (Framing & Distance)", () => {
    it("reports near-zero edge density on an empty / blank wall", () => {
      const gray = new Uint8Array(W * H).fill(120);
      const density = computeEdgeDensity(gray, W, H);
      expect(density).toBe(0);
      expect(density).toBeLessThan(CV_THRESHOLDS.EDGE_DENSITY_MIN);
    });

    it("reports healthy edge density on a scene with clear edges and borders", () => {
      const gray = new Uint8Array(W * H).fill(50);
      // Create high-contrast horizontal and vertical bands (like text/packaging)
      for (let y = 10; y < 54; y += 8) {
        for (let x = 10; x < 54; x++) {
          gray[y * W + x] = 220;
        }
      }
      const density = computeEdgeDensity(gray, W, H);
      expect(density).toBeGreaterThanOrEqual(CV_THRESHOLDS.EDGE_DENSITY_MIN);
      expect(density).toBeLessThanOrEqual(CV_THRESHOLDS.EDGE_DENSITY_MAX);
    });
  });

  describe("computeMotionDelta (Steadiness)", () => {
    it("returns 0 for identical consecutive frames", () => {
      const f1 = new Uint8Array(W * H).fill(100);
      const f2 = new Uint8Array(W * H).fill(100);
      expect(computeMotionDelta(f2, f1)).toBe(0);
    });

    it("detects camera motion when consecutive frames shift significantly", () => {
      const f1 = new Uint8Array(W * H).fill(100);
      const f2 = new Uint8Array(W * H).fill(150);
      const delta = computeMotionDelta(f2, f1);
      expect(delta).toBe(50);
      expect(delta).toBeGreaterThan(CV_THRESHOLDS.MOTION_DELTA_MAX);
    });
  });

  describe("analyzeFrame (End-to-End Tier 0 Guidance)", () => {
    it("identifies a sharp, steady, well-framed, glare-free frame as ready", () => {
      // Create a well-lit image with sharp high-contrast text lines
      const img = makeImageData(W, H, (x, y) => {
        // High contrast lines mimicking printed packaging
        if (y >= 10 && y <= 54 && y % 6 < 2 && x >= 10 && x <= 54) {
          return [220, 220, 220];
        }
        return [40, 40, 40];
      });

      const { result, gray } = analyzeFrame(img, null);
      // Second consecutive frame with same gray (steady)
      const second = analyzeFrame(img, gray);
      expect(second.result.metrics.edgeDensity).toBeGreaterThanOrEqual(CV_THRESHOLDS.EDGE_DENSITY_MIN);
      expect(second.result.metrics.edgeDensity).toBeLessThanOrEqual(CV_THRESHOLDS.EDGE_DENSITY_MAX);
      expect(second.result.checks.steady).toBe(true);
      expect(second.result.checks.glareFree).toBe(true);
      expect(second.result.checks.sharp).toBe(true);
      expect(second.result.checks.framed).toBe(true);
      expect(second.result.isReady).toBe(true);
      expect(second.result.category).toBe("ready");
      expect(second.result.tip).toBe("Good — ready to capture");
    });

    it("flags motion blur risk when camera is moving", () => {
      const img1 = makeImageData(W, H, () => [50, 50, 50]);
      const prevGray = toGrayscale(img1.data, W, H);

      const img2 = makeImageData(W, H, () => [120, 120, 120]);
      const { result } = analyzeFrame(img2, prevGray);

      expect(result.checks.steady).toBe(false);
      expect(result.category).toBe("motion");
      expect(result.tip).toBe("Hold steady");
      expect(result.isReady).toBe(false);
    });

    it("flags glare when specular hotspot is present", () => {
      const img = makeImageData(W, H, (x, y) => {
        if (x < 20 && y < 20) return [255, 255, 255]; // intense glare
        return [80, 80, 80];
      });
      const { result } = analyzeFrame(img, null);

      expect(result.checks.glareFree).toBe(false);
      expect(result.category).toBe("glare");
      expect(result.tip).toContain("Glare detected");
      expect(result.isReady).toBe(false);
    });

    it("flags too_far when frame is blank / under-filled", () => {
      const img = makeImageData(W, H, () => [100, 100, 100]); // completely uniform
      const { result } = analyzeFrame(img, null);

      expect(result.checks.framed).toBe(false);
      expect(result.category).toBe("too_far");
      expect(result.tip).toContain("Move closer");
      expect(result.isReady).toBe(false);
    });
  });
});
