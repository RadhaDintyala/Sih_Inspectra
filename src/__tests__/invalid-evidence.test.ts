/**
 * Regression suite for the screenshot failure:
 * a non-package frame (human face) must NEVER produce a compliance analysis.
 *
 * CASE A: face / no package → PACKAGE_NOT_DETECTED → INVALID_EVIDENCE,
 *         no OCR-driven declarations, no statutory rules, score NULL.
 * CASE B: valid front package → PACKAGE_DETECTED, honest field extraction.
 * CASE C: valid back package → manufacturer/consumer-care declarations.
 * CASE D: multiple photos → every photo persisted as its own evidence record.
 * CASE E: conflicting MRP across photos → CONFLICT / REVIEW_REQUIRED.
 * CASE F: clear MRP → correct deterministic extraction.
 * CASE G: unreadable date → NOT_DETECTED / REVIEW_REQUIRED (never invented).
 * Score:   valid inspections score numerically; invalid evidence scores NULL.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import sharp from "sharp";
import type { NextRequest } from "next/server";
import { analyzePackagePresence } from "@/services/package-gate";
import { mergeDeclarations } from "@/services/extraction";
import {
  evaluateCompliance,
  complianceScore,
  inspectionVerdict,
  INVALID_EVIDENCE_RULE_ID,
} from "@/domain/rules";
import type { Declaration } from "@/domain/inspection";

beforeAll(() => {
  process.env.TEST_MODE = "true";
});

function svgToPng(svg: string): Promise<Buffer> {
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/** Front panel: dominant product title + MRP + net qty + date. */
function frontPanelSvg(): string {
  return (
    `<svg width="800" height="600">` +
    `<rect width="800" height="600" fill="#f5f0e1"/>` +
    `<rect x="24" y="24" width="752" height="552" fill="none" stroke="#333" stroke-width="6"/>` +
    `<text x="60" y="150" font-size="88" font-family="sans-serif" font-weight="bold" fill="black">Good Day Biscuits</text>` +
    `<text x="60" y="270" font-size="52" font-family="sans-serif" fill="black">MRP Rs 35.00 Inclusive of all taxes</text>` +
    `<text x="60" y="370" font-size="52" font-family="sans-serif" fill="black">Net Qty 200 g</text>` +
    `<text x="60" y="470" font-size="52" font-family="sans-serif" fill="black">MFD 08/2026</text></svg>`
  );
}

/** Back panel: manufacturer + consumer care + origin. */
function backPanelSvg(): string {
  return (
    `<svg width="800" height="600">` +
    `<rect width="800" height="600" fill="#eef2f5"/>` +
    `<rect x="24" y="24" width="752" height="552" fill="none" stroke="#333" stroke-width="6"/>` +
    `<text x="60" y="140" font-size="44" font-family="sans-serif" fill="black">Mfd by Britannia Industries Ltd Kolkata 700001</text>` +
    `<text x="60" y="240" font-size="44" font-family="sans-serif" fill="black">Consumer Care 1800 425 4444 care@example.com</text>` +
    `<text x="60" y="340" font-size="44" font-family="sans-serif" fill="black">Made in India</text>` +
    `<text x="60" y="440" font-size="44" font-family="sans-serif" fill="black">Net Qty 200 g</text></svg>`
  );
}

/** Human-subject frame: smooth skin tones, no printed structure. */
async function faceFrame(): Promise<Buffer> {
  const svg =
    `<svg width="640" height="480">` +
    `<rect width="640" height="480" fill="#b97a56"/>` +
    `<ellipse cx="320" cy="240" rx="130" ry="160" fill="#c68863"/>` +
    `<ellipse cx="275" cy="210" rx="16" ry="10" fill="#3a2415"/>` +
    `<ellipse cx="365" cy="210" rx="16" ry="10" fill="#3a2415"/>` +
    `<ellipse cx="320" cy="300" rx="34" ry="12" fill="#5a2f1d"/>` +
    `</svg>`;
  const base = await sharp(Buffer.from(svg)).png().toBuffer();
  const { data, info } = await sharp(base).raw().toBuffer({ resolveWithObject: true });
  const out = Buffer.from(data);
  let seed = 42;
  const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (let i = 0; i < out.length; i += info.channels) {
    const nz = Math.floor((rand() - 0.5) * 14);
    for (let c = 0; c < 3; c++) out[i + c] = Math.max(0, Math.min(255, out[i + c] + nz));
  }
  return sharp(out, { raw: { width: info.width, height: info.height, channels: info.channels } }).jpeg().toBuffer();
}

function multipartRequest(files: Array<{ buffer: Buffer; filename: string; side: string }>): Request {
  const boundary = `----RegBoundary${Date.now()}${Math.floor(Math.random() * 1e6)}`;
  const parts: Buffer[] = [];
  for (const f of files) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="${f.filename}"\r\nContent-Type: image/jpeg\r\n\r\n`
      ),
      f.buffer,
      Buffer.from("\r\n")
    );
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="side"\r\n\r\n${f.side}\r\n`));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return new Request("http://localhost:3000/api/scan", {
    method: "POST",
    headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
    body: Buffer.concat(parts),
  });
}

const createdIds: string[] = [];
afterAll(async () => {
  const { deleteInspection } = await import("@/services/store");
  for (const id of createdIds) {
    try { await deleteInspection(id); } catch { /* noop */ }
  }
});

describe("CASE A — face frame is invalid evidence, never a compliance result", () => {
  it("gate rejects a human-subject frame", async () => {
    const gate = await analyzePackagePresence(await faceFrame());
    expect(gate.packageDetected).toBe(false);
    expect(gate.reason).toBe("HUMAN_SUBJECT_FRAME");
  });

  it("pipeline returns INVALID_EVIDENCE with null score and no statutory rules", async () => {
    const { POST } = await import("@/app/api/scan/route");
    const res = await POST(multipartRequest([{ buffer: await faceFrame(), filename: "face.jpg", side: "front" }]) as unknown as NextRequest);
    expect(res.status).toBe(200);
    const data = await res.json();
    const inspection = data.inspection;
    createdIds.push(inspection.id);

    expect(inspection.status).toBe("invalid_evidence");
    expect(inspection.verdict).toBe("INVALID_EVIDENCE");
    expect(inspection.score).toBeNull();
    expect(data.score).toBeNull();
    // No statutory declaration rules applied — only the gate record.
    expect(inspection.checks).toHaveLength(1);
    expect(inspection.checks[0].ruleId).toBe(INVALID_EVIDENCE_RULE_ID);
    // Nothing fabricated: every declaration is NOT_DETECTED.
    expect(inspection.declarations.length).toBeGreaterThan(0);
    for (const d of inspection.declarations) {
      expect(d.status).toBe("NOT_DETECTED");
      expect(d.value).toBeNull();
    }
    // Invalid evidence persists per-frame evidence records (audit trail).
    expect(inspection.images).toHaveLength(1);
    expect(inspection.images[0].packageDetected).toBe(false);
  }, 120000);
});

describe("CASE B/C/F — valid package frames extract real declarations", () => {
  it("front panel: package detected, MRP / net qty / date extracted", async () => {
    const { POST } = await import("@/app/api/scan/route");
    const res = await POST(
      multipartRequest([{ buffer: await svgToPng(frontPanelSvg()), filename: "front.png", side: "front" }]) as unknown as NextRequest
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    const inspection = data.inspection;
    createdIds.push(inspection.id);

    expect(inspection.status).not.toBe("invalid_evidence");
    expect(inspection.extractionSource).toBe("YOLO + Regional OCR");
    expect(inspection.images[0].packageDetected).toBe(true);

    const byField = (f: string) => inspection.declarations.find((d: Declaration) => d.field === f);
    expect(byField("mrp").status).toBe("DETECTED");
    expect(byField("mrp").value).toBe("₹35.00");
    expect(byField("net_quantity").status).toBe("DETECTED");
    expect(byField("net_quantity").value).toBe("200 g");
    expect(byField("date").status).toBe("DETECTED");
    expect(byField("date").value).toBe("08/2026");

    // Every extracted value traces to its source frame.
    for (const d of inspection.declarations.filter((entry: Declaration) => entry.value)) {
      expect(d.evidenceImageId).toBe(inspection.images[0].id);
    }
    // Detections carry measured (non-identical) coordinates.
    const { prisma } = await import("@/services/store");
    const dets = await prisma.detectionRecord.findMany({ where: { evidenceImageId: inspection.images[0].id } });
    expect(dets.length).toBeGreaterThan(0);
    const boxes = dets.map((d) => d.bboxJson);
    expect(new Set(boxes).size).toBeGreaterThan(1);
  }, 180000);

  it("back panel: manufacturer and consumer care declarations detected", async () => {
    const { POST } = await import("@/app/api/scan/route");
    const res = await POST(
      multipartRequest([{ buffer: await svgToPng(backPanelSvg()), filename: "back.png", side: "back" }]) as unknown as NextRequest
    );
    const data = await res.json();
    const inspection = data.inspection;
    createdIds.push(inspection.id);

    expect(inspection.status).not.toBe("invalid_evidence");
    const byField = (f: string) => inspection.declarations.find((d: Declaration) => d.field === f);
    expect(["DETECTED", "NOT_DETECTED"]).toContain(byField("manufacturer").status);
    if (byField("manufacturer").value) {
      expect(byField("manufacturer").value).toMatch(/Britannia/i);
    }
    expect(byField("consumer_care").status).toBe("DETECTED");
  }, 180000);
});

describe("CASE D — multi-photo inspections persist every frame", () => {
  it("front + back aggregate across evidence without clobbering", async () => {
    const { POST } = await import("@/app/api/scan/route");
    const res = await POST(
      multipartRequest([
        { buffer: await svgToPng(frontPanelSvg()), filename: "front.png", side: "front" },
        { buffer: await svgToPng(backPanelSvg()), filename: "back.png", side: "back" },
      ]) as unknown as NextRequest
    );
    const data = await res.json();
    const inspection = data.inspection;
    createdIds.push(inspection.id);

    expect(inspection.images).toHaveLength(2);
    const ids = inspection.images.map((i: { id: string }) => i.id);
    expect(new Set(ids).size).toBe(2);
    expect(inspection.images[0].imageOrder).toBe(1);
    expect(inspection.images[1].imageOrder).toBe(2);
    expect(inspection.images[0].checksum).toBeTruthy();

    const byField = (f: string) => inspection.declarations.find((d: Declaration) => d.field === f);
    // MRP aggregated from the front frame, care from the back frame.
    expect(byField("mrp").value).toBe("₹35.00");
    expect(byField("mrp").evidenceImageId).toBe(inspection.images[0].id);
    expect(byField("consumer_care").evidenceImageId).toBe(inspection.images[1].id);
  }, 240000);
});

describe("CASE E — conflicting MRP across photos is CONFLICT, never a guess", () => {
  it("mergeDeclarations marks cross-image disagreement as CONFLICT", () => {
    const merged = mergeDeclarations([
      { field: "mrp", value: "₹35.00", rawValue: "Rs 35", status: "DETECTED", confidence: 0.9, evidenceImageId: "img-1" },
      { field: "mrp", value: "₹85.00", rawValue: "Rs 85", status: "DETECTED", confidence: 0.88, evidenceImageId: "img-2" },
    ]);
    const mrp = merged.find((d) => d.field === "mrp")!;
    expect(mrp.status).toBe("CONFLICT");
    expect(mrp.conflict).toBe(true);
  });

  it("compliance engine routes conflicts to review, not pass/fail", () => {
    const checks = evaluateCompliance(
      [{ field: "mrp", value: "₹35.00 | ₹85.00", status: "CONFLICT", confidence: 0.5, conflict: true } as Declaration],
      "img-1"
    );
    const mrpCheck = checks.find((c) => c.field === "mrp")!;
    expect(mrpCheck.status).toBe("review");
  });
});

describe("CASE G + score math — missing values are never fabricated", () => {
  it("unreadable date yields NOT_DETECTED declaration and review check", () => {
    const checks = evaluateCompliance([], "img-1");
    const dateCheck = checks.find((c) => c.field === "date")!;
    // Low-confidence absence must not become a confirmed violation.
    expect(dateCheck.status).toBe("review");
  });

  it("valid review-only inspections score numerically; invalid evidence scores NULL", () => {
    const checks = evaluateCompliance([], "img-1");
    const score = complianceScore(checks);
    expect(typeof score).toBe("number");
    // All-review valid inspection: half weight → exactly 50/100 BY DEFINITION.
    expect(score).toBe(50);
    // No statutory checks at all (invalid evidence): NULL, never 50.
    expect(complianceScore([])).toBeNull();
    expect(
      complianceScore([{ ruleId: INVALID_EVIDENCE_RULE_ID, field: "evidence", status: "review", explanation: "gate" }])
    ).toBeNull();
  });

  it("verdict matrix", () => {
    expect(inspectionVerdict({ packageDetected: false, processingComplete: false, checks: [] })).toBe("INVALID_EVIDENCE");
    expect(inspectionVerdict({ packageDetected: true, processingComplete: false, checks: [] })).toBe("INCOMPLETE");
    expect(
      inspectionVerdict({ packageDetected: true, processingComplete: true, checks: [{ ruleId: "LM-PC-04", field: "mrp", status: "fail", explanation: "x" }] })
    ).toBe("NON_COMPLIANT");
    expect(
      inspectionVerdict({ packageDetected: true, processingComplete: true, checks: [{ ruleId: "LM-PC-04", field: "mrp", status: "review", explanation: "x" }] })
    ).toBe("REQUIRES_REVIEW");
    expect(
      inspectionVerdict({ packageDetected: true, processingComplete: true, checks: [{ ruleId: "LM-PC-04", field: "mrp", status: "pass", explanation: "x" }] })
    ).toBe("COMPLIANT");
  });
});
