/**
 * Integration tests — real images through the upgraded pipeline.
 * Tests CLAHE preprocessing, fuzzy anchors, gazetteer, and strict plausibility.
 */

import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { analyzePackagePresence } from "@/services/package-gate";
import { ocrService } from "@/services/ocr-service";
import { extractFieldCandidates, type TextLine } from "@/services/field-extraction";
import { lookupProduct } from "@/services/gazetteer";
import { generateVariants } from "@/services/preprocessing";
import {
  normalizeMRP,
  normalizeNetQuantity,
  normalizeDate,
  normalizeProductName,
  normalizeCountryOfOrigin,
} from "@/services/normalizer";

// ── Test image generators ─────────────────────────────────────────────

async function generateCleanLabel(): Promise<Buffer> {
  const svg =
    `<svg width="800" height="600">` +
    `<rect width="800" height="600" fill="#f5f0e1"/>` +
    `<rect x="24" y="24" width="752" height="552" fill="none" stroke="#333" stroke-width="6"/>` +
    `<text x="60" y="120" font-size="72" font-family="sans-serif" font-weight="bold" fill="black">Good Day Biscuits</text>` +
    `<text x="60" y="220" font-size="44" font-family="sans-serif" fill="black">Nestle India Pvt Ltd</text>` +
    `<text x="60" y="310" font-size="44" font-family="sans-serif" fill="black">Net Qty 200 g</text>` +
    `<text x="60" y="390" font-size="44" font-family="sans-serif" fill="black">MRP Rs 35.00</text>` +
    `<text x="60" y="460" font-size="44" font-family="sans-serif" fill="black">MFD 08/2026</text>` +
    `<text x="60" y="530" font-size="36" font-family="sans-serif" fill="black">Country of Origin India</text>` +
    `</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function generateHighResLabel(): Promise<Buffer> {
  const svg =
    `<svg width="1600" height="1200">` +
    `<rect width="1600" height="1200" fill="#f5f0e1"/>` +
    `<rect x="40" y="40" width="1520" height="1120" fill="none" stroke="#333" stroke-width="8"/>` +
    `<text x="100" y="200" font-size="120" font-family="sans-serif" font-weight="bold" fill="black">Good Day Biscuits</text>` +
    `<text x="100" y="380" font-size="72" font-family="sans-serif" fill="black">MRP Rs 35.00 Inclusive of all taxes</text>` +
    `<text x="100" y="520" font-size="72" font-family="sans-serif" fill="black">Net Qty 200 g</text>` +
    `<text x="100" y="660" font-size="72" font-family="sans-serif" fill="black">MFD 08/2026</text>` +
    `<text x="100" y="800" font-size="64" font-family="sans-serif" fill="black">Manufactured by Nestle India Pvt Ltd</text>` +
    `<text x="100" y="940" font-size="56" font-family="sans-serif" fill="black">Consumer Care 1800-123-4567</text>` +
    `<text x="100" y="1080" font-size="56" font-family="sans-serif" fill="black">Country of Origin India</text>` +
    `</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function generateSkewedLabel(): Promise<Buffer> {
  const svg =
    `<svg width="800" height="600">` +
    `<rect width="800" height="600" fill="#f5f0e1"/>` +
    `<text x="60" y="120" font-size="72" font-family="sans-serif" font-weight="bold" fill="black">Good Day Biscuits</text>` +
    `<text x="60" y="220" font-size="44" font-family="sans-serif" fill="black">MRP Rs 35.00</text>` +
    `</svg>`;
  return sharp(Buffer.from(svg)).rotate(8).png().toBuffer();
}

// ── CLAHE preprocessing tests ────────────────────────────────────────

describe("CLAHE preprocessing ensemble", () => {
  it("generates 2-3 variants from clean image", async () => {
    const img = await generateCleanLabel();
    const variants = await generateVariants(img);
    expect(variants.length).toBeGreaterThanOrEqual(2);
    expect(variants.length).toBeLessThanOrEqual(3);
    const names = variants.map((v) => v.name);
    expect(names).toContain("original");
    expect(names).toContain("clahe");
  });
  it("may include deskew variant for skewed image", async () => {
    const img = await generateSkewedLabel();
    const variants = await generateVariants(img);
    const names = variants.map((v) => v.name);
    // Deskew may be included or excluded by the 3-variant cap
    expect(variants.length).toBeGreaterThanOrEqual(2);
  });
  it("each variant has a valid buffer", async () => {
    const img = await generateCleanLabel();
    const variants = await generateVariants(img);
    for (const v of variants) {
      expect(v.buffer.length).toBeGreaterThan(0);
      const meta = await sharp(v.buffer).metadata();
      expect(meta.width).toBeGreaterThan(0);
      expect(meta.height).toBeGreaterThan(0);
    }
  });
});

// ── Gazetteer integration tests ──────────────────────────────────────

describe("Gazetteer — product identification", () => {
  it("identifies 'Good Day Biscuits'", () => {
    const result = lookupProduct("Good Day Biscuits");
    expect(result).not.toBeNull();
    expect(result!.canonical).toBe("Britannia Good Day");
  });
  it("identifies 'Maggi' (partial match)", () => {
    const result = lookupProduct("Maggi");
    expect(result).not.toBeNull();
    expect(result!.canonical).toBe("Maggi Noodles");
  });
  it("identifies 'Parle G'", () => {
    const result = lookupProduct("Parle G");
    expect(result).not.toBeNull();
    expect(result!.canonical).toBe("Parle-G");
  });
  it("returns null for garbage", () => {
    expect(lookupProduct("Bi REE 3d")).toBeNull();
    expect(lookupProduct("xK9mP2")).toBeNull();
  });
});

// ── Package gate on real images ──────────────────────────────────────

describe("Package gate — quality signals", () => {
  it("clean label: detects package", async () => {
    const img = await generateCleanLabel();
    const result = await analyzePackagePresence(img);
    expect(result.packageDetected).toBe(true);
    expect(result.confidence).toBeGreaterThan(0.3);
  });
  it("high-res label: detects package", async () => {
    const img = await generateHighResLabel();
    const result = await analyzePackagePresence(img);
    expect(result.packageDetected).toBe(true);
  });
  it("dark label: rejects for quality", async () => {
    const svg = `<svg width="800" height="600"><rect width="800" height="600" fill="#1a1a1a"/></svg>`;
    const img = await sharp(Buffer.from(svg)).png().toBuffer();
    const result = await analyzePackagePresence(img);
    expect(result.packageDetected).toBe(false);
  });
});

// ── OCR on real images ────────────────────────────────────────────────

describe("OCR — text extraction", () => {
  it("extracts text from clean label", async () => {
    const img = await generateCleanLabel();
    const result = await ocrService.recognizeWholeImage(img);
    const text = result.fullText.toLowerCase();
    const hasText = text.includes("good") || text.includes("biscuit") || text.includes("day") || text.includes("mrp");
    expect(hasText).toBe(true);
    expect(result.candidates.length).toBeGreaterThan(0);
  });
  it("extracts text from high-res label", async () => {
    const img = await generateHighResLabel();
    const result = await ocrService.recognizeWholeImage(img);
    expect(result.fullText.length).toBeGreaterThan(10);
  });
});

// ── Field extraction end-to-end ──────────────────────────────────────

describe("Field extraction — fuzzy anchors + gazetteer", () => {
  it("extracts MRP from fuzzy anchor", () => {
    const lines: TextLine[] = [
      { text: "MRP Rs 35.00", confidence: 95, bbox: { x: 5, y: 55, width: 50, height: 6 } },
    ];
    const candidates = extractFieldCandidates(lines, ["mrp"]);
    const mrp = candidates.find((c) => c.field === "mrp" && c.value);
    expect(mrp).toBeDefined();
    expect(mrp!.value).toBe("₹35.00");
  });
  it("extracts net quantity from fuzzy anchor", () => {
    const lines: TextLine[] = [
      { text: "Net Qty 200 g", confidence: 90, bbox: { x: 5, y: 40, width: 50, height: 6 } },
    ];
    const candidates = extractFieldCandidates(lines, ["net_quantity"]);
    const nq = candidates.find((c) => c.field === "net_quantity" && c.value);
    expect(nq).toBeDefined();
    expect(nq!.value).toBe("200 g");
  });
  it("extracts product name via gazetteer", () => {
    const lines: TextLine[] = [
      { text: "Good Day Biscuits", confidence: 92, bbox: { x: 5, y: 5, width: 90, height: 10 } },
    ];
    const candidates = extractFieldCandidates(lines, ["product_name"]);
    const pn = candidates.find((c) => c.field === "product_name" && c.value);
    expect(pn).toBeDefined();
    expect(pn!.source).toContain("gazetteer");
  });
  it("rejects garbage lines", () => {
    const lines: TextLine[] = [
      { text: "Bi REE 3d", confidence: 40, bbox: { x: 10, y: 10, width: 30, height: 4 } },
    ];
    const candidates = extractFieldCandidates(lines, ["product_name"]);
    const valid = candidates.filter((c) => c.value !== "" && !c.rejectionReason);
    expect(valid.length).toBe(0);
  });
});

// ── Strict plausibility gate ─────────────────────────────────────────

describe("Strict plausibility gate", () => {
  it("rejects garbled s", () => {
    expect(normalizeProductName("Bi REE 3d")).toBeNull();
    expect(normalizeProductName("A aN a yy")).toBeNull();
  });
  it("rejects noise-heavy text", () => {
    expect(normalizeProductName("!!!@@@###")).toBeNull();
  });
  it("accepts valid s", () => {
    expect(normalizeProductName("Good Day Biscuits")).toBe("Good Day Biscuits");
  });
  it("accepts valid MRP", () => {
    expect(normalizeMRP("MRP Rs 35.00")).toBe("₹35.00");
  });
  it("accepts valid net quantity", () => {
    expect(normalizeNetQuantity("Net Qty 200 g")).toBe("200 g");
  });
  it("accepts valid country of origin", () => {
    expect(normalizeCountryOfOrigin("Country of Origin India")).toBe("India");
  });
});
