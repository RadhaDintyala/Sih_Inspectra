/**
 * Integration test for POST /api/scan.
 *
 * Exercises the REAL pipeline (TEST_MODE sync):
 *   image upload → package gate → YOLO regions → regional OCR →
 *   rule engine → persisted Inspection.
 *
 * No fixtures, no fabricated values: assertions verify structure,
 * persistence, and honesty (no invented declarations/scores).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import sharp from "sharp";
import type { NextRequest } from "next/server";

async function packagePng(): Promise<Buffer> {
  const svg =
    `<svg width="800" height="600">` +
    `<rect width="800" height="600" fill="#f5f0e1"/>` +
    `<rect x="24" y="24" width="752" height="552" fill="none" stroke="#333" stroke-width="6"/>` +
    `<text x="60" y="150" font-size="88" font-family="sans-serif" font-weight="bold" fill="black">Good Day Biscuits</text>` +
    `<text x="60" y="270" font-size="52" font-family="sans-serif" fill="black">MRP Rs 35.00 Inclusive of all taxes</text>` +
    `<text x="60" y="370" font-size="52" font-family="sans-serif" fill="black">Net Qty 200 g</text>` +
    `<text x="60" y="470" font-size="52" font-family="sans-serif" fill="black">MFD 08/2026</text></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

function multipartRequest(buffer: Buffer, filename: string, side: string): Request {
  const boundary = `----TestBoundary${Date.now()}`;
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="${filename}"\r\nContent-Type: image/png\r\n\r\n`
    ),
    buffer,
    Buffer.from("\r\n"),
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="side"\r\n\r\n${side}\r\n`),
    Buffer.from(`--${boundary}--\r\n`),
  ]);
  return new Request("http://localhost:3000/api/scan", {
    method: "POST",
    headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
    body,
  });
}

describe("POST /api/scan integration", () => {
  const createdIds: string[] = [];

  beforeAll(() => {
    // TEST_MODE runs the real pipeline synchronously for determinism.
    process.env.TEST_MODE = "true";
  });

  afterAll(async () => {
    const { deleteInspection } = await import("@/services/store");
    for (const id of createdIds) {
      try { await deleteInspection(id); } catch { /* noop */ }
    }
  });

  it("accepts an upload, runs the real pipeline, and persists an honest Inspection", async () => {
    const { POST } = await import("@/app/api/scan/route");
    const response = await POST(multipartRequest(await packagePng(), "test-package.png", "front") as unknown as NextRequest);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.inspection).toBeDefined();
    expect(data.summary).toBeDefined();
    expect(data.extractionSource).toBe("YOLO + Regional OCR");

    const inspection = data.inspection;
    expect(inspection.id).toMatch(/^INSP-\d{4}-\d{4}$/);
    expect(inspection.createdAt).toBeDefined();
    expect(inspection.status).not.toBe("invalid_evidence");

    // Every photo is a real evidence record with provenance.
    expect(inspection.images).toHaveLength(1);
    expect(inspection.images[0].id).toMatch(/^EV-/);
    expect(inspection.images[0].checksum).toBeTruthy();
    expect(inspection.images[0].storageKey).toContain(inspection.id);

    // Declarations trace to evidence; score is null-or-number, never fake.
    expect(inspection.declarations.length).toBeGreaterThan(0);
    expect(data.score === null || typeof data.score === "number").toBe(true);
    expect(data.summary.id).toBe(inspection.id);
    expect(data.summary.totalRules).toBe(inspection.checks.length);

    createdIds.push(inspection.id);
    const { getInspection } = await import("@/services/store");
    const stored = await getInspection(inspection.id);
    expect(stored).not.toBeNull();
    expect(stored?.id).toBe(inspection.id);
    expect(stored?.extractionSource).toBe("YOLO + Regional OCR");
  }, 180000);

  it("returns 400 when no image is provided", async () => {
    const { POST } = await import("@/app/api/scan/route");
    const boundary = `----TestBoundary${Date.now()}`;
    const request = new Request("http://localhost:3000/api/scan", {
      method: "POST",
      headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
      body: Buffer.from(`--${boundary}--\r\n`),
    });
    const response = await POST(request as unknown as NextRequest);
    const data = await response.json();
    expect(response.status).toBe(400);
    expect(data.error).toContain("No image file provided");
  });

  it("returns 400 when sending empty file", async () => {
    const { POST } = await import("@/app/api/scan/route");
    const boundary = `----TestBoundary${Date.now()}`;
    const body = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="empty.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`
      ),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const request = new Request("http://localhost:3000/api/scan", {
      method: "POST",
      headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
      body,
    });
    const response = await POST(request as unknown as NextRequest);
    const data = await response.json();
    expect(response.status).toBe(400);
    expect(data.error).toBe("IMAGE_EMPTY");
  });

  it("returns 415 for unsupported content type", async () => {
    const { POST } = await import("@/app/api/scan/route");
    const request = new Request("http://localhost:3000/api/scan", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: "hello",
    });
    const response = await POST(request as unknown as NextRequest);
    const data = await response.json();
    expect(response.status).toBe(415);
    expect(data.error).toContain("Unsupported content type");
  });

  it("normalizer rejects FSSAI license numbers from MRP and Date", async () => {
    const { normalizeMRP, normalizeDate } = await import("@/services/normalizer");
    expect(normalizeMRP("FSSAI Lic No. 10014022001234")).toBeNull();
    expect(normalizeMRP("Lic. No. 10015021000123")).toBeNull();
    expect(normalizeDate("FSSAI Lic. No. 10014022001234")).toBeNull();
    expect(normalizeDate("10014022001234")).toBeNull();
    expect(normalizeMRP("MRP Rs. 40.00")).toBe("₹40.00");
    expect(normalizeDate("Mfg: 06/2025")).toBe("06/2025");
  });

  it("multi-image merge correctly resolves split declarations across front and back panels", async () => {
    const { mergeDeclarations } = await import("@/services/extraction");
    const declarations = [
      { field: "product_name" as const, value: "Britannia Good Day", rawValue: "Britannia Good Day", status: "DETECTED" as const, confidence: 0.90, evidenceImageId: "img-front" },
      { field: "manufacturer" as const, value: null, rawValue: "", status: "NOT_DETECTED" as const, confidence: null, evidenceImageId: "img-front" },
      { field: "mrp" as const, value: null, rawValue: "", status: "NOT_DETECTED" as const, confidence: null, evidenceImageId: "img-front" },
      { field: "product_name" as const, value: null, rawValue: "", status: "NOT_DETECTED" as const, confidence: null, evidenceImageId: "img-back" },
      { field: "manufacturer" as const, value: "Britannia Industries Ltd, Kolkata", rawValue: "Britannia Industries Ltd, Kolkata", status: "DETECTED" as const, confidence: 0.88, evidenceImageId: "img-back" },
      { field: "mrp" as const, value: "₹30.00", rawValue: "Rs 30", status: "DETECTED" as const, confidence: 0.92, evidenceImageId: "img-back" },
    ];
    const merged = mergeDeclarations(declarations);
    const productName = merged.find((d) => d.field === "product_name");
    const manufacturer = merged.find((d) => d.field === "manufacturer");
    const mrp = merged.find((d) => d.field === "mrp");
    expect(productName?.value).toBe("Britannia Good Day");
    expect(productName?.evidenceImageId).toBe("img-front");
    expect(manufacturer?.value).toBe("Britannia Industries Ltd, Kolkata");
    expect(manufacturer?.evidenceImageId).toBe("img-back");
    expect(mrp?.value).toBe("₹30.00");
    expect(mrp?.evidenceImageId).toBe("img-back");
  });

  it("persists evidence image binary and serves it via GET /api/scan/image/[id]", async () => {
    const { saveEvidenceImageFile, getEvidenceImageFile, deleteEvidenceImageFile } = await import("@/services/store");
    const { GET: getImageRoute } = await import("@/app/api/scan/image/[id]/route");
    const testImageId = `test-evidence-${Date.now()}`;
    const testBuffer = await packagePng();

    const savedUri = saveEvidenceImageFile(testImageId, testBuffer);
    expect(savedUri).toBe(`/api/scan/image/${testImageId}`);

    const retrievedBuffer = getEvidenceImageFile(testImageId);
    expect(retrievedBuffer).not.toBeNull();
    expect(retrievedBuffer?.length).toBe(testBuffer.length);

    const req = new Request(`http://localhost:3000/api/scan/image/${testImageId}`);
    const res = await getImageRoute(req as unknown as NextRequest, { params: Promise.resolve({ id: testImageId }) });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/jpeg");

    deleteEvidenceImageFile(testImageId);
    expect(getEvidenceImageFile(testImageId)).toBeNull();

    const notFoundReq = new Request("http://localhost:3000/api/scan/image/non-existent-img");
    const notFoundRes = await getImageRoute(notFoundReq as unknown as NextRequest, { params: Promise.resolve({ id: "non-existent-img" }) });
    expect(notFoundRes.status).toBe(404);
  });
});
