import { describe, it, expect } from "vitest";
import {
  normalizeMRP,
  normalizeNetQuantity,
  normalizeDate,
  normalizeProductName,
  normalizeManufacturer,
  normalizeConsumerCare,
  normalizeCountryOfOrigin,
} from "@/services/normalizer";
import { extractFieldCandidates, type TextLine } from "@/services/field-extraction";
import { levenshtein, similarity, matchAnchor, bestFuzzyMatch, tokenize } from "@/services/fuzzy-match";
import { lookupProduct } from "@/services/gazetteer";

// ── Fuzzy matching tests ─────────────────────────────────────────────

describe("Levenshtein distance", () => {
  it("identical strings = 0", () => {
    expect(levenshtein("abc", "abc")).toBe(0);
  });
  it("one edit", () => {
    expect(levenshtein("abc", "abd")).toBe(1);
    expect(levenshtein("abc", "ab")).toBe(1);
    expect(levenshtein("abc", "abcd")).toBe(1);
  });
  it("two edits", () => {
    expect(levenshtein("abc", "axc")).toBe(1); // replace b→x
    expect(levenshtein("abc", "axyd")).toBe(3); // replace b→x, replace c→y, insert d
  });
});

describe("Similarity score", () => {
  it("identical = 1.0", () => {
    expect(similarity("abc", "abc")).toBe(1);
  });
  it("similar strings > 0.7", () => {
    expect(similarity("maggi", "maggi")).toBe(1);
    expect(similarity("maggi noodles", "magi noodles")).toBeGreaterThan(0.7);
  });
});

describe("Fuzzy anchor matching", () => {
  it("exact anchor match", () => {
    const result = matchAnchor("MRP Rs 35.00", ["MRP", "M.R.P"], 2);
    expect(result).not.toBeNull();
    expect(result!.anchor).toBe("MRP");
    expect(result!.distance).toBe(0);
  });
  it("fuzzy anchor with 1 edit", () => {
    const result = matchAnchor("MRP Rs 35.00", ["MRP", "M.R.P"], 2);
    expect(result).not.toBeNull();
  });
  it("no match for unrelated text", () => {
    const result = matchAnchor("hello world", ["MRP", "Net Qty"], 2);
    expect(result).toBeNull();
  });
  it("Net Qty anchor", () => {
    const result = matchAnchor("Net Qty 200 g", ["Net Wt", "Net Qty", "Net Weight"], 2);
    expect(result).not.toBeNull();
    expect(result!.anchor).toBe("Net Qty");
  });
  it("Consumer Care anchor", () => {
    const result = matchAnchor("Consumer Care: 1800-123-4567", ["Consumer Care", "Customer Care"], 2);
    expect(result).not.toBeNull();
  });
  it("Country of Origin anchor", () => {
    const result = matchAnchor("Country of Origin India", ["Country of Origin", "Made in"], 2);
    expect(result).not.toBeNull();
    expect(result!.anchor).toBe("Country of Origin");
  });
  it("Manufactured by anchor", () => {
    const result = matchAnchor("Manufactured by Nestle India Pvt Ltd", ["Manufactured by", "Marketed by"], 2);
    expect(result).not.toBeNull();
  });
});

describe("bestFuzzyMatch", () => {
  it("exact match returns score 1", () => {
    const result = bestFuzzyMatch("maggi", ["maggi", "lays", "parle"]);
    expect(result).not.toBeNull();
    expect(result!.score).toBe(1);
  });
  it("fuzzy match with slight misspelling", () => {
    const result = bestFuzzyMatch("magi noodles", ["maggi noodles", "yippee noodles"], 0.72);
    expect(result).not.toBeNull();
    expect(result!.match).toBe("maggi noodles");
  });
  it("no match below threshold", () => {
    const result = bestFuzzyMatch("xyz123", ["maggi", "lays"], 0.72);
    expect(result).toBeNull();
  });
});

describe("Tokenize", () => {
  it("splits on whitespace and punctuation", () => {
    expect(tokenize("Hello, World!")).toEqual(["hello", "world"]);
  });
  it("handles empty string", () => {
    expect(tokenize("")).toEqual([]);
  });
});

// ── Gazetteer tests ──────────────────────────────────────────────────

describe("Gazetteer product lookup", () => {
  it("finds 'Maggi Noodles' from 'maggi noodles'", () => {
    const result = lookupProduct("maggi noodles");
    expect(result).not.toBeNull();
    expect(result!.canonical).toBe("Maggi Noodles");
    expect(result!.score).toBeGreaterThanOrEqual(0.72);
  });
  it("finds 'Britannia Good Day' from 'Good Day Biscuits'", () => {
    const result = lookupProduct("Good Day Biscuits");
    expect(result).not.toBeNull();
    expect(result!.canonical).toBe("Britannia Good Day");
  });
  it("finds 'Parle-G' from 'parle g'", () => {
    const result = lookupProduct("parle g");
    expect(result).not.toBeNull();
    expect(result!.canonical).toBe("Parle-G");
  });
  it("finds 'Amul Butter' from 'Amul Butter'", () => {
    const result = lookupProduct("Amul Butter");
    expect(result).not.toBeNull();
    expect(result!.canonical).toBe("Amul Butter");
  });
  it("returns null for garbage text", () => {
    const result = lookupProduct("Bi REE 3d");
    expect(result).toBeNull();
  });
  it("returns null for empty text", () => {
    expect(lookupProduct("")).toBeNull();
  });
});

// ── Fuzzy anchor field extraction ────────────────────────────────────

describe("Field extraction with fuzzy anchors", () => {
  const lines: TextLine[] = [
    { text: "Good Day Biscuits", confidence: 92, bbox: { x: 10, y: 10, width: 80, height: 8 } },
    { text: "Net Qty 200 g", confidence: 90, bbox: { x: 10, y: 40, width: 50, height: 6 } },
    { text: "MRP Rs 35.00", confidence: 95, bbox: { x: 10, y: 55, width: 50, height: 6 } },
    { text: "MFD 08/2026", confidence: 87, bbox: { x: 10, y: 65, width: 50, height: 6 } },
    { text: "Manufactured by Nestle India Pvt Ltd", confidence: 82, bbox: { x: 10, y: 80, width: 80, height: 6 } },
    { text: "Consumer Care 1800-123-4567", confidence: 80, bbox: { x: 10, y: 85, width: 80, height: 6 } },
    { text: "Country of Origin India", confidence: 85, bbox: { x: 10, y: 90, width: 80, height: 6 } },
  ];

  it("extracts MRP via fuzzy anchor", () => {
    const candidates = extractFieldCandidates(lines, ["mrp"]);
    const mrp = candidates.find((c) => c.field === "mrp" && c.value);
    expect(mrp).toBeDefined();
    expect(mrp!.value).toBe("₹35.00");
    expect(mrp!.source).toContain("fuzzy-anchor");
  });

  it("extracts net quantity via fuzzy anchor", () => {
    const candidates = extractFieldCandidates(lines, ["net_quantity"]);
    const nq = candidates.find((c) => c.field === "net_quantity" && c.value);
    expect(nq).toBeDefined();
    expect(nq!.value).toBe("200 g");
  });

  it("extracts product name via gazetteer", () => {
    const candidates = extractFieldCandidates(lines, ["product_name"]);
    const pn = candidates.find((c) => c.field === "product_name" && c.value);
    expect(pn).toBeDefined();
    // Should match "Good Day Biscuits" in gazetteer
    expect(pn!.source).toContain("gazetteer");
  });

  it("extracts manufacturer via fuzzy anchor", () => {
    const candidates = extractFieldCandidates(lines, ["manufacturer"]);
    const mfr = candidates.find((c) => c.field === "manufacturer" && c.value);
    expect(mfr).toBeDefined();
    expect(mfr!.source).toContain("fuzzy-anchor");
  });

  it("extracts consumer care via fuzzy anchor", () => {
    const candidates = extractFieldCandidates(lines, ["consumer_care"]);
    const cc = candidates.find((c) => c.field === "consumer_care" && c.value);
    expect(cc).toBeDefined();
  });

  it("extracts country of origin via fuzzy anchor", () => {
    const candidates = extractFieldCandidates(lines, ["country_of_origin"]);
    const coo = candidates.find((c) => c.field === "country_of_origin" && c.value);
    expect(coo).toBeDefined();
    expect(coo!.value).toBe("India");
  });

  it("garbage lines produce no valid candidates", () => {
    const garbled: TextLine[] = [
      { text: "Bi REE 3d", confidence: 40, bbox: { x: 10, y: 10, width: 30, height: 4 } },
      { text: "!!!@@@", confidence: 30, bbox: { x: 10, y: 20, width: 20, height: 4 } },
    ];
    const candidates = extractFieldCandidates(garbled, ["mrp", "net_quantity", "product_name", "manufacturer", "consumer_care", "country_of_origin"]);
    const valid = candidates.filter((c) => c.value !== "" && !c.rejectionReason);
    expect(valid.length).toBe(0);
  });
});

// ── Plausibility gate tests ─────────────────────────────────────────

describe("Strict plausibility gate", () => {
  it("rejects garbled product names", () => {
    expect(normalizeProductName("Bi REE 3d")).toBeNull();
    expect(normalizeProductName("A aN a yy")).toBeNull();
  });
  it("rejects noise-heavy text", () => {
    expect(normalizeProductName("!!!@@@###")).toBeNull();
  });
  it("accepts valid product names", () => {
    expect(normalizeProductName("Good Day Biscuits")).toBe("Good Day Biscuits");
  });
  it("accepts valid MRP", () => {
    expect(normalizeMRP("MRP Rs 35.00")).toBe("₹35.00");
  });
  it("accepts valid net quantity", () => {
    expect(normalizeNetQuantity("Net Qty 200 g")).toBe("200 g");
  });
});

// ── Normalizer tests ────────────────────────────────────────────────

describe("Normalizer — on real OCR-like text", () => {
  it("MRP from typical OCR output", () => {
    expect(normalizeMRP("MRP Rs 35.00")).toBe("₹35.00");
    expect(normalizeMRP("MRP: Rs. 120/-")).toBe("₹120.00");
    expect(normalizeMRP("₹99.99")).toBe("₹99.99");
  });
  it("Net quantity from typical OCR output", () => {
    expect(normalizeNetQuantity("Net Qty 200 g")).toBe("200 g");
    expect(normalizeNetQuantity("Net Wt. 500 gms")).toBe("500 g");
    expect(normalizeNetQuantity("1 L")).toBe("1 l");
  });
  it("Date from typical OCR output", () => {
    expect(normalizeDate("MFD 08/2026")).not.toBeNull();
    expect(normalizeDate("MFG: 01/01/2024")).not.toBeNull();
  });
  it("Country of origin from typical OCR output", () => {
    expect(normalizeCountryOfOrigin("Country of Origin India")).toBe("India");
  });
  it("Manufacturer from typical OCR output", () => {
    expect(normalizeManufacturer("Nestle India Pvt Ltd")).not.toBeNull();
  });
  it("Consumer care from typical OCR output", () => {
    expect(normalizeConsumerCare("Consumer Care: 1800-123-4567")).not.toBeNull();
  });
});
