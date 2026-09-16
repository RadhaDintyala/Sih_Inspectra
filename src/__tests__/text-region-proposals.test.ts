import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { extractTextRegions } from "@/services/text-region-proposals";
import { getScaleFactor } from "@/services/preprocessing";
import { matchAnchor } from "@/services/fuzzy-match";
import { extractFieldCandidates } from "@/services/field-extraction";

describe("Text Region Proposals & Preprocessing Ensemble", () => {
  it("computes height-aware upscaling factors correctly", () => {
    expect(getScaleFactor(8)).toBe(4.0);
    expect(getScaleFactor(15)).toBe(3.0);
    expect(getScaleFactor(25)).toBe(2.0);
    expect(getScaleFactor(45)).toBe(1.5);
  });

  it("extracts text regions from synthetic test canvas", async () => {
    // Create synthetic canvas with dark text lines on light background
    const imageBuffer = await sharp({
      create: {
        width: 800,
        height: 600,
        channels: 3,
        background: { r: 240, g: 240, b: 240 },
      },
    })
      .composite([
        {
          input: Buffer.from(
            `<svg width="800" height="600">
              <text x="50" y="80" font-size="28" font-family="sans-serif" fill="#111">BRITANNIA GOOD DAY</text>
              <text x="50" y="180" font-size="22" font-family="sans-serif" fill="#111">MRP Rs. 35.00 INCL TAX</text>
              <text x="50" y="260" font-size="20" font-family="sans-serif" fill="#111">NET QTY 200 g</text>
              <text x="50" y="340" font-size="18" font-family="sans-serif" fill="#111">MFD 08/2026</text>
              <text x="50" y="420" font-size="16" font-family="sans-serif" fill="#111">MANUFACTURED BY BRITANNIA IND LTD</text>
            </svg>`
          ),
        },
      ])
      .png()
      .toBuffer();

    const regions = await extractTextRegions(imageBuffer, { maxRegions: 8 });
    expect(regions.length).toBeGreaterThan(0);
    expect(regions[0]).toHaveProperty("estCharHeightPx");
    expect(regions[0]).toHaveProperty("polarity");
    expect(regions[0].bbox.width).toBeGreaterThan(0);
  });

  it("matches anchors with OCR confusables (N3T QUANT1TY, MANUFACTUREO BY)", () => {
    const nqMatch = matchAnchor("N3T QUANT1TY 200 g", ["Net Quantity", "Net Qty"], 2);
    expect(nqMatch).not.toBeNull();
    expect(nqMatch?.anchor).toMatch(/Net/i);

    const mfrMatch = matchAnchor("MANUFACTUREO BY BRITANNIA", ["Manufactured by", "Mfd by"], 2);
    expect(mfrMatch).not.toBeNull();
    expect(mfrMatch?.anchor).toBe("Manufactured by");
  });

  it("performs multi-line product join to match gazetteer", () => {
    const lines = [
      { text: "BRITANNIA", confidence: 90, bbox: { x: 10, y: 10, width: 40, height: 5 } },
      { text: "GOOD DAY", confidence: 90, bbox: { x: 10, y: 18, width: 40, height: 5 } },
      { text: "MRP Rs 35.00", confidence: 85, bbox: { x: 10, y: 40, width: 40, height: 4 } },
    ];

    const candidates = extractFieldCandidates(lines, ["product_name"]);
    const gazetteerMatch = candidates.find((c) => c.source.startsWith("gazetteer-match"));
    expect(gazetteerMatch).toBeDefined();
    expect(gazetteerMatch?.value).toContain("Britannia Good Day");
  });
});
