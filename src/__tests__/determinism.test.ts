import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { createHash } from "crypto";
import { ocrService } from "@/services/ocr-service";
import { processInspectionPipeline } from "@/services/pipeline-worker";
import { prisma } from "@/services/store";

function hashStr(str: string | Buffer): string {
  return createHash("sha256").update(str).digest("hex");
}

describe("Requirement A: Pipeline Determinism", () => {
  it("produces 100% identical OCR and declaration results when running on exact same image twice", async () => {
    // Generate a clean synthetic test package image
    const svgText = `
      <svg width="800" height="600" xmlns="http://www.w3.org/2000/svg">
        <rect width="100%" height="100%" fill="#ffffff" />
        <rect x="20" y="20" width="760" height="560" fill="none" stroke="#000000" stroke-width="4"/>
        <text x="50" y="100" font-family="Arial" font-size="32" font-weight="bold" fill="#000000">Parle-G Biscuits</text>
        <text x="50" y="200" font-family="Arial" font-size="28" fill="#000000">MRP Rs 50.00 (INCL. OF ALL TAXES)</text>
        <text x="50" y="300" font-family="Arial" font-size="28" fill="#000000">Net Wt 100 g</text>
        <text x="50" y="400" font-family="Arial" font-size="24" fill="#000000">Mfg Date 09/2026</text>
        <text x="50" y="500" font-family="Arial" font-size="22" fill="#000000">Manufactured by Parle Products Pvt Ltd, Mumbai 400057</text>
      </svg>
    `;

    const imageBuffer = await sharp(Buffer.from(svgText)).jpeg({ quality: 95 }).toBuffer();
    const imageHash = hashStr(imageBuffer);

    // Run 1
    const res1 = await ocrService.processImageBatch([
      { id: "EV-DETERM-001", buffer: imageBuffer, side: "front" },
    ]);

    // Run 2
    const res2 = await ocrService.processImageBatch([
      { id: "EV-DETERM-001", buffer: imageBuffer, side: "front" },
    ]);

    // 1. Verify OCR extracted lines count & text hash match
    const lines1 = res1.images[0]?.detections.map((d) => d.text) ?? [];
    const lines2 = res2.images[0]?.detections.map((d) => d.text) ?? [];

    expect(lines1.length).toEqual(lines2.length);
    expect(hashStr(JSON.stringify(lines1))).toEqual(hashStr(JSON.stringify(lines2)));

    // 2. Verify extracted declarations match exactly
    const decls1 = res1.declarations.map((d) => ({ field: d.field, value: d.value, status: d.status }));
    const decls2 = res2.declarations.map((d) => ({ field: d.field, value: d.value, status: d.status }));

    expect(hashStr(JSON.stringify(decls1))).toEqual(hashStr(JSON.stringify(decls2)));

    // 3. Verify pipeline worker end-to-end verdict match
    const org = await prisma.organization.findFirst();
    const orgId = org?.id ?? "org-delhi-test";

    const job1 = {
      inspectionId: `INSP-DETERM-RUN1-${Date.now()}`,
      organizationId: orgId,
      images: [{ buffer: imageBuffer, filename: "test.jpg", side: "front" as const }],
    };

    const job2 = {
      inspectionId: `INSP-DETERM-RUN2-${Date.now()}`,
      organizationId: orgId,
      images: [{ buffer: imageBuffer, filename: "test.jpg", side: "front" as const }],
    };

    const insp1 = await processInspectionPipeline(job1);
    const insp2 = await processInspectionPipeline(job2);

    expect(insp1.verdict).toEqual(insp2.verdict);
    expect(insp1.score).toEqual(insp2.score);
    expect(insp1.declarations.length).toEqual(insp2.declarations.length);

    for (let i = 0; i < insp1.declarations.length; i++) {
      expect(insp1.declarations[i].field).toEqual(insp2.declarations[i].field);
      expect(insp1.declarations[i].value).toEqual(insp2.declarations[i].value);
      expect(insp1.declarations[i].status).toEqual(insp2.declarations[i].status);
    }
  });
});
