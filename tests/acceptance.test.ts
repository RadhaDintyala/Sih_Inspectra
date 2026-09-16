/**
 * Acceptance Test — Synthetic "Britannia Good Day" package image.
 *
 * Verifies that the field extraction pipeline (extractFieldCandidates +
 * fuzzy anchors + gazetteer) correctly identifies fields from OCR text.
 * This is a unit-level acceptance test that does NOT run Tesseract (to avoid
 * WASM in CI). It tests the extraction logic directly with realistic OCR text.
 */

import { describe, it, expect } from "vitest";
import { extractFieldCandidates, type TextLine } from "@/services/field-extraction";
import { lookupProduct } from "@/services/gazetteer";
import { normalizeProductName, normalizeMRP, normalizeNetQuantity, normalizeDate } from "@/services/normalizer";
import type { BoundingBox } from "@/domain/inspection";

// Simulated OCR text from a real Britannia Good Day package
const GOOD_DAY_OCR_LINES = [
  "Britannia",
  "Good Day",
  "Cashew Cookies",
  "Net Wt. 250g",
  "MRP Rs 55.00",
  "Mfg Date: 15/08/2025",
  "Best Before 6 months",
  "Manufactured by",
  "Britannia Industries Limited",
  "5/1A, Hungerford Street",
  "Kolkata 700017",
  "Consumer Care: 1800-123-4567",
  "Country of Origin: India",
  "FSSAI Lic. No. 10019012000123",
];

function makeTextLines(lines: string[]): TextLine[] {
  return lines.map((text, idx) => ({
    text,
    confidence: 78,
    bbox: {
      x: 2,
      y: Math.round(((idx / lines.length) * 80 + 5) * 10) / 10,
      width: 96,
      height: Math.round((80 / lines.length) * 10) / 10,
    } as BoundingBox,
  }));
}

const TARGET_FIELDS = [
  "product_name",
  "mrp",
  "net_quantity",
  "date",
  "manufacturer",
  "consumer_care",
  "country_of_origin",
  "unit_sale_price",
] as const;

describe("Acceptance: Britannia Good Day extraction", () => {
  const lines = makeTextLines(GOOD_DAY_OCR_LINES);

  it("gazetteer recognizes 'Britannia Good Day' from raw text", () => {
    const result = lookupProduct("Britannia Good Day");
    expect(result).not.toBeNull();
    expect(result!.canonical).toBe("Britannia Good Day");
    expect(result!.score).toBeGreaterThanOrEqual(0.72);
  });

  it("gazetteer recognizes 'Good Day' from raw text", () => {
    const result = lookupProduct("Good Day");
    expect(result).not.toBeNull();
    expect(result!.canonical).toBe("Britannia Good Day");
  });

  it("extracts product_name via gazetteer or geometry", () => {
    const candidates = extractFieldCandidates(lines, ["product_name"]);
    const valid = candidates.filter((c) => c.value);
    expect(valid.length).toBeGreaterThan(0);
    const best = valid[0];
    // Should match a known Britannia product via gazetteer or geometry
    expect(best.value).toMatch(/Britannia/i);
  });

  it("extracts MRP via fuzzy anchor", () => {
    const candidates = extractFieldCandidates(lines, ["mrp"]);
    const valid = candidates.filter((c) => c.value);
    expect(valid.length).toBeGreaterThan(0);
    const normalized = normalizeMRP(valid[0].value);
    expect(normalized).not.toBeNull();
    expect(normalized).toMatch(/55/);
  });

  it("extracts net_quantity via fuzzy anchor", () => {
    const candidates = extractFieldCandidates(lines, ["net_quantity"]);
    const valid = candidates.filter((c) => c.value);
    expect(valid.length).toBeGreaterThan(0);
    const normalized = normalizeNetQuantity(valid[0].value);
    expect(normalized).not.toBeNull();
    expect(normalized).toMatch(/250/);
  });

  it("extracts date via fuzzy anchor", () => {
    const candidates = extractFieldCandidates(lines, ["date"]);
    const valid = candidates.filter((c) => c.value);
    expect(valid.length).toBeGreaterThan(0);
    const normalized = normalizeDate(valid[0].value);
    expect(normalized).not.toBeNull();
  });

  it("extracts manufacturer via fuzzy anchor", () => {
    const candidates = extractFieldCandidates(lines, ["manufacturer"]);
    const valid = candidates.filter((c) => c.value);
    expect(valid.length).toBeGreaterThan(0);
    // Should contain the manufacturer anchor or company name
    expect(valid[0].value.length).toBeGreaterThan(5);
  });

  it("extracts consumer_care via fuzzy anchor", () => {
    const candidates = extractFieldCandidates(lines, ["consumer_care"]);
    const valid = candidates.filter((c) => c.value);
    expect(valid.length).toBeGreaterThan(0);
    expect(valid[0].value).toMatch(/1800/i);
  });

  it("extracts country_of_origin via fuzzy anchor", () => {
    const candidates = extractFieldCandidates(lines, ["country_of_origin"]);
    const valid = candidates.filter((c) => c.value);
    expect(valid.length).toBeGreaterThan(0);
    expect(valid[0].value).toMatch(/India/i);
  });

  it("extracts ≥3 fields total from Good Day OCR text", () => {
    const candidates = extractFieldCandidates(lines, [...TARGET_FIELDS]);
    const valid = candidates.filter((c) => c.value);
    console.log(`Extracted ${valid.length} fields:`, valid.map((c) => `${c.field}="${c.value}" source=${c.source}`));
    expect(valid.length).toBeGreaterThanOrEqual(3);
  });

  it("normalizer produces clean product name", () => {
    const result = normalizeProductName("Britannia Good Day");
    expect(result).toBe("Britannia Good Day");
  });

  it("normalizer produces clean MRP", () => {
    const result = normalizeMRP("MRP Rs 55.00");
    expect(result).not.toBeNull();
    expect(result).toMatch(/55/);
  });

  it("normalizer produces clean net quantity", () => {
    const result = normalizeNetQuantity("Net Wt. 250g");
    expect(result).not.toBeNull();
    expect(result).toMatch(/250/);
  });

  it("no gibberish in consumer_care extraction", () => {
    const candidates = extractFieldCandidates(lines, ["consumer_care"]);
    const valid = candidates.filter((c) => c.value);
    for (const c of valid) {
      // No field should have >35% non-alphanumeric noise
      const alphaNum = c.value.replace(/[^a-zA-Z0-9]/g, "").length;
      const noiseRatio = 1 - alphaNum / c.value.length;
      expect(noiseRatio).toBeLessThan(0.35);
    }
  });
});

describe("Acceptance: General Packaged Commodities (Parle-G & Bourbon)", () => {
  it("identifies Parle-G from OCR text lines", () => {
    const parleLines = makeTextLines([
      "Gfor Genius",
      "PARLE",
      "Parle-G",
      "Original Gluco Biscuits",
    ]);
    const candidates = extractFieldCandidates(parleLines, ["product_name"]);
    const valid = candidates.filter((c) => c.value);
    expect(valid.length).toBeGreaterThan(0);
    expect(valid[0].value).toMatch(/Parle-G/i);
  });

  it("identifies Bourbon from OCR text lines", () => {
    const bourbonLines = makeTextLines([
      "Dark",
      "Fantasy",
      "Bourbon",
      "WITH CLASSIC CHOCOLATE",
    ]);
    const candidates = extractFieldCandidates(bourbonLines, ["product_name"]);
    const valid = candidates.filter((c) => c.value);
    expect(valid.length).toBeGreaterThan(0);
    expect(valid.some((c) => /Bourbon|Dark Fantasy/i.test(c.value))).toBe(true);
  });

  it("package gate accepts studio packshot with clean white background", async () => {
    const { analyzePackagePresence } = await import("@/services/package-gate");
    const sharp = (await import("sharp")).default;
    // Create a product on a white studio background
    const svg =
      `<svg width="400" height="400">` +
      `<rect width="400" height="400" fill="#ffffff"/>` + // Pure white background
      `<rect x="80" y="80" width="240" height="240" fill="#b84b26" stroke="#222" stroke-width="4"/>` +
      `<text x="100" y="150" font-size="28" font-family="sans-serif" fill="#ffffff" font-weight="bold">BISCUIT PACK</text>` +
      `<text x="100" y="200" font-size="20" font-family="sans-serif" fill="#ffffff">Net Wt. 100g</text>` +
      `<text x="100" y="240" font-size="20" font-family="sans-serif" fill="#ffffff">MRP Rs 20.00</text>` +
      `</svg>`;
    const buf = await sharp(Buffer.from(svg)).jpeg().toBuffer();
    const gate = await analyzePackagePresence(buf);
    expect(gate.packageDetected).toBe(true);
    expect(gate.reason).toBe("PACKAGE_DETECTED");
  });
});

