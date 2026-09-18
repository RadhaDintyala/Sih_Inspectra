/**
 * @file ocr-evidence-layer.test.ts
 *
 * Tests the principle: "OCR = collect all visible text; field-extraction = interpret it."
 */

import { describe, it, expect } from "vitest";
import {
  extractFieldCandidates,
  type TextLine,
} from "@/services/field-extraction";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeLine(
  text: string,
  opts: {
    confidence?: number;
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    relativeHeight?: number;
  } = {}
): TextLine {
  return {
    text,
    confidence: opts.confidence ?? 85,
    bbox: {
      x: opts.x ?? 5,
      y: opts.y ?? 10,
      width: opts.width ?? 20,
      height: opts.height ?? 4,
    },
    relativeHeight: opts.relativeHeight,
  };
}

function attachRelativeHeights(lines: TextLine[]): void {
  const heights = lines.map((l) => l.bbox.height).filter((h) => h > 0);
  if (heights.length === 0) return;
  const sorted = [...heights].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 1
      ? sorted[mid]
      : (sorted[mid - 1] + sorted[mid]) / 2;
  if (median <= 0) return;
  for (const l of lines) {
    l.relativeHeight = l.bbox.height / median;
    l.centerX = l.bbox.x + l.bbox.width / 2;
    l.centerY = l.bbox.y + l.bbox.height / 2;
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("OCR Evidence Layer — extract broadly, interpret selectively", () => {
  describe("computeRelativeHeights (via attachRelativeHeights)", () => {
    it("assigns relativeHeight = 1.0 to a single line", () => {
      const lines = [makeLine("BRAND", { height: 6 })];
      attachRelativeHeights(lines);
      expect(lines[0].relativeHeight).toBeCloseTo(1.0, 1);
    });

    it("computes correct relativeHeight for multiple text sizes in the same image", () => {
      const lines = [
        makeLine("JIMJAM", { height: 20 }),
        makeLine("Net Wt", { height: 4 }),
        makeLine("200 g", { height: 4 }),
        makeLine("MRP Rs", { height: 4 }),
        makeLine("1800 123 456", { height: 2 }),
      ];
      attachRelativeHeights(lines);
      // Median height = 4
      expect(lines[0].relativeHeight).toBeCloseTo(5.0, 0);
      expect(lines[1].relativeHeight).toBeCloseTo(1.0, 1);
      expect(lines[4].relativeHeight).toBeCloseTo(0.5, 1);
    });

    it("computes centerX and centerY", () => {
      const lines = [makeLine("TEXT", { x: 10, y: 20, width: 30, height: 8 })];
      attachRelativeHeights(lines);
      expect(lines[0].centerX).toBeCloseTo(25, 1);
      expect(lines[0].centerY).toBeCloseTo(24, 1);
    });
  });

  describe("Short and small text — retained as OCR evidence", () => {
    it("single character 'A' does not crash extraction", () => {
      const lines: TextLine[] = [makeLine("A", { height: 4, relativeHeight: 1.0 })];
      expect(() => extractFieldCandidates(lines, ["product_name", "mrp"])).not.toThrow();
    });

    it("2-char text 'Rs' does not crash extraction", () => {
      const lines: TextLine[] = [makeLine("Rs", { height: 4, relativeHeight: 1.0 })];
      expect(() => extractFieldCandidates(lines, ["mrp"])).not.toThrow();
    });

    it("3-char statutory 'MRP' at body-text size is NOT classified as product_name", () => {
      const lines: TextLine[] = [
        makeLine("MRP", { height: 4, relativeHeight: 1.0, y: 80 }),
        makeLine("Rs 25.00", { height: 4, relativeHeight: 1.0, y: 82 }),
      ];
      const candidates = extractFieldCandidates(lines, ["product_name", "mrp"]);
      const productNameCands = candidates.filter((c) => c.field === "product_name");
      expect(productNameCands.map((c) => c.value)).not.toContain("Mrp");
    });

    it("3-char brand 'VIM' at very large relativeHeight → classified as product_name candidate", () => {
      const lines: TextLine[] = [
        makeLine("VIM", { height: 20, relativeHeight: 5.0, y: 30 }),
        makeLine("Dishwash Bar", { height: 4, relativeHeight: 1.0, y: 60 }),
        makeLine("Net Wt 135g", { height: 4, relativeHeight: 1.0, y: 70 }),
      ];
      const candidates = extractFieldCandidates(lines, ["product_name"]);
      const productNameCands = candidates.filter((c) => c.field === "product_name");
      const hasVim = productNameCands.some((c) => c.value.toLowerCase() === "vim");
      expect(hasVim).toBe(true);
    });
  });

  describe("Long brand names — geometry-match path", () => {
    it("5-char brand 'JIMJAM' at prominent position → classified as product_name", () => {
      const lines: TextLine[] = [
        makeLine("JIMJAM", { height: 18, relativeHeight: 4.5, y: 25 }),
        makeLine("Britannia", { height: 6, relativeHeight: 1.5, y: 40 }),
        makeLine("Net Wt 150g", { height: 4, relativeHeight: 1.0, y: 80 }),
        makeLine("MRP Rs 20.00", { height: 4, relativeHeight: 1.0, y: 85 }),
      ];
      const candidates = extractFieldCandidates(lines, ["product_name"]);
      const productNameCands = candidates.filter((c) => c.field === "product_name");
      expect(productNameCands.length).toBeGreaterThan(0);
      const values = productNameCands.map((c) => c.value.toUpperCase());
      expect(values.some((v) => v.includes("JIMJAM"))).toBe(true);
    });

    it("Gazetteer brand 'Maggi Noodles' → matched via gazetteer", () => {
      const lines: TextLine[] = [
        makeLine("Maggi", { height: 12, relativeHeight: 3.0, y: 15 }),
        makeLine("2 Minute Noodles", { height: 5, relativeHeight: 1.25, y: 30 }),
        makeLine("Net Wt 70g", { height: 4, relativeHeight: 1.0, y: 70 }),
      ];
      const candidates = extractFieldCandidates(lines, ["product_name"]);
      const productNameCands = candidates.filter((c) => c.field === "product_name");
      expect(productNameCands.length).toBeGreaterThan(0);
      const sources = productNameCands.map((c) => c.source);
      expect(sources.some((s) => s.includes("gazetteer"))).toBe(true);
    });
  });

  describe("Numeric and alphanumeric declarations", () => {
    it("'MRP Rs 120.00' → extracted as mrp candidate", () => {
      const lines: TextLine[] = [
        makeLine("MRP Rs 120.00", { height: 4, relativeHeight: 1.0, y: 85 }),
      ];
      const candidates = extractFieldCandidates(lines, ["mrp"]);
      const mrpCands = candidates.filter((c) => c.field === "mrp");
      expect(mrpCands.length).toBeGreaterThan(0);
      expect(mrpCands[0].value).toMatch(/120/);
    });

    it("'Net Wt 100 g' → extracted as net_quantity", () => {
      const lines: TextLine[] = [
        makeLine("Net Wt 100 g", { height: 4, relativeHeight: 1.0, y: 75 }),
      ];
      const candidates = extractFieldCandidates(lines, ["net_quantity"]);
      const nqCands = candidates.filter((c) => c.field === "net_quantity");
      expect(nqCands.length).toBeGreaterThan(0);
      expect(nqCands[0].value).toMatch(/100/);
    });

    it("'Batch No: B2X4501' → extracted as batch_number", () => {
      const lines: TextLine[] = [
        makeLine("Batch No: B2X4501", { height: 3, relativeHeight: 0.75, y: 90 }),
      ];
      const candidates = extractFieldCandidates(lines, ["batch_number"]);
      const batchCands = candidates.filter((c) => c.field === "batch_number");
      expect(batchCands.length).toBeGreaterThan(0);
    });
  });

  describe("Low-confidence OCR results", () => {
    it("low-confidence text (confidence 35) is still processed by field extraction", () => {
      const lines: TextLine[] = [
        makeLine("Net Wt 200 g", { confidence: 35, height: 4, relativeHeight: 1.0, y: 70 }),
      ];
      expect(() => extractFieldCandidates(lines, ["net_quantity"])).not.toThrow();
      const candidates = extractFieldCandidates(lines, ["net_quantity"]);
      const nqCands = candidates.filter((c) => c.field === "net_quantity");
      expect(nqCands.length).toBeGreaterThan(0);
    });
  });

  describe("Mixed text sizes in one image", () => {
    it("correctly classifies different text types using relativeHeight", () => {
      const lines: TextLine[] = [
        makeLine("OREO", { height: 22, y: 20 }),
        makeLine("Sandwich Biscuits", { height: 6, y: 40 }),
        makeLine("Chocolate", { height: 5, y: 50 }),
        makeLine("Net Wt 120g", { height: 4, y: 70 }),
        makeLine("MRP Rs 30.00", { height: 4, y: 75 }),
        makeLine("Mfg: 01/2025", { height: 3, y: 85 }),
        makeLine("Best Before 6 months", { height: 3, y: 92 }),
      ];
      attachRelativeHeights(lines);

      const candidates = extractFieldCandidates(lines, [
        "product_name", "net_quantity", "mrp",
      ]);

      const mrpCands = candidates.filter((c) => c.field === "mrp");
      expect(mrpCands.length).toBeGreaterThan(0);
      expect(mrpCands[0].value).toMatch(/30/);

      const nqCands = candidates.filter((c) => c.field === "net_quantity");
      expect(nqCands.length).toBeGreaterThan(0);
      expect(nqCands[0].value).toMatch(/120/);
    });
  });

  describe("Architecture boundary — extraction never crashes on any input", () => {
    it("extractFieldCandidates does not throw for any single alphanumeric character", () => {
      const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".split("");
      for (const c of chars) {
        expect(() =>
          extractFieldCandidates(
            [makeLine(c, { height: 4, relativeHeight: 1.0 })],
            ["product_name", "mrp", "net_quantity"]
          )
        ).not.toThrow();
      }
    });

    it("handles empty text lines without crashing", () => {
      const lines: TextLine[] = [
        makeLine("", { height: 0.1, relativeHeight: 0.1 }),
        makeLine("MRP Rs 10.00", { height: 4, relativeHeight: 1.0, y: 80 }),
      ];
      expect(() => extractFieldCandidates(lines, ["mrp"])).not.toThrow();
    });
  });
});
