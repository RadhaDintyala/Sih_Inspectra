import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { processInspectionPipeline } from "@/services/pipeline-worker";
import { prisma } from "@/services/store";

async function createSvgImage(lines: string[]): Promise<Buffer> {
  const textElements = lines
    .map((line, idx) => `<text x="40" y="${60 + idx * 70}" font-family="Arial" font-size="26" fill="#000000">${line}</text>`)
    .join("\n");

  const svg = `
    <svg width="800" height="600" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="#ffffff" />
      <rect x="10" y="10" width="780" height="580" fill="none" stroke="#333333" stroke-width="3"/>
      ${textElements}
    </svg>
  `;
  return await sharp(Buffer.from(svg)).jpeg({ quality: 95 }).toBuffer();
}

describe("Requirement B: Multi-View Inspection & Evidence Aggregation", () => {
  it("combines multiple views (front, back, side) of ONE product into a package-level inspection with evidence linking", async () => {
    const frontBuf = await createSvgImage([
      "Parle-G Biscuits",
      "MRP Rs 50.00 (INCL. OF ALL TAXES)",
      "Net Wt 100 g",
    ]);

    const backBuf = await createSvgImage([
      "Manufactured by Parle Products Pvt Ltd, Mumbai 400057",
      "Consumer Care Cell 1800 22 7080 care@parle.biz",
      "Country of Origin India",
    ]);

    const sideBuf = await createSvgImage([
      "Mfg Date 09/2026",
      "Batch No B12345",
    ]);

    const org = await prisma.organization.findFirst();
    const orgId = org?.id ?? "org-delhi-test";

    const job = {
      inspectionId: `INSP-MULTI-${Date.now()}`,
      organizationId: orgId,
      images: [
        { buffer: frontBuf, filename: "front.jpg", side: "front" as const },
        { buffer: backBuf, filename: "back.jpg", side: "back" as const },
        { buffer: sideBuf, filename: "side.jpg", side: "side" as const },
      ],
    };

    const inspection = await processInspectionPipeline(job);

    // 1. One inspection ID with 3 evidence images
    expect(inspection.id).toEqual(job.inspectionId);
    expect(inspection.images.length).toEqual(3);

    // 2. Declarations aggregated across all 3 images
    const mrp = inspection.declarations.find((d) => d.field === "mrp");
    const netQty = inspection.declarations.find((d) => d.field === "net_quantity");
    const mfr = inspection.declarations.find((d) => d.field === "manufacturer");
    const date = inspection.declarations.find((d) => d.field === "date");

    expect(mrp?.status).toEqual("DETECTED");
    expect(mrp?.value).toContain("50.00");
    expect(mrp?.evidenceImageId).toEqual(inspection.images[0].id);

    expect(netQty?.status).toEqual("DETECTED");
    expect(netQty?.value).toContain("100 g");
    expect(netQty?.evidenceImageId).toEqual(inspection.images[0].id);

    expect(mfr?.status).toEqual("DETECTED");
    expect(mfr?.value).toContain("Parle Products");
    expect(mfr?.evidenceImageId).toEqual(inspection.images[1].id);

    expect(date?.status).toEqual("DETECTED");
    expect(date?.value).toContain("2026");
    expect(date?.evidenceImageId).toEqual(inspection.images[2].id);
  });

  it("handles conflicting field values across images by setting CONFLICT state and routing to REQUIRES_REVIEW", async () => {
    const frontBuf = await createSvgImage([
      "Parle-G Biscuits",
      "MRP Rs 50.00 (INCL. OF ALL TAXES)",
      "Net Wt 100 g",
    ]);

    const conflictingSideBuf = await createSvgImage([
      "MRP Rs 55.00 (INCL. OF ALL TAXES)",
      "Mfg Date 09/2026",
    ]);

    const org = await prisma.organization.findFirst();
    const orgId = org?.id ?? "org-delhi-test";

    const job = {
      inspectionId: `INSP-CONFLICT-${Date.now()}`,
      organizationId: orgId,
      images: [
        { buffer: frontBuf, filename: "front.jpg", side: "front" as const },
        { buffer: conflictingSideBuf, filename: "side_conflict.jpg", side: "side" as const },
      ],
    };

    const inspection = await processInspectionPipeline(job);

    const mrp = inspection.declarations.find((d) => d.field === "mrp");
    expect(mrp).toBeDefined();
    expect(mrp?.status).toEqual("CONFLICT");
    expect(mrp?.conflict).toBe(true);
    expect(mrp?.value).toContain("50.00");
    expect(mrp?.value).toContain("55.00");
    expect(mrp?.candidates?.length).toBeGreaterThanOrEqual(2);

    // Final compliance verdict MUST route toward REQUIRES_REVIEW (status review)
    expect(inspection.verdict).toEqual("REQUIRES_REVIEW");
    expect(inspection.status).toEqual("review");
  });
});
