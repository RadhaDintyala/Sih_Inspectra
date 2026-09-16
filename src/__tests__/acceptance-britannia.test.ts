import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { PaddleOcrService } from "@/services/ocr-service";
import type { Declaration } from "@/domain/inspection";
import { evaluateCompliance, overallStatus, complianceScore } from "@/domain/rules";
import { normalizeDate } from "@/services/normalizer";

const TARGET_FIELDS: Declaration["field"][] = [
  "product_name",
  "mrp",
  "net_quantity",
  "date",
  "manufacturer",
  "consumer_care",
  "country_of_origin",
  "unit_sale_price",
  "dimensions",
  "best_before",
  "batch_number",
];

const PHOTO_DIR = path.join(process.cwd(), ".scan-store", "vault", "inspections", "INSP-2026-3441", "evidence");

describe("Acceptance: 5-photo Britannia Good Day Cookies label", () => {
  it("runs the real OCR pipeline and produces a deterministic verdict", async () => {
    const files = fs.existsSync(PHOTO_DIR)
      ? fs.readdirSync(PHOTO_DIR).filter((f) => /\.(jpe?g|png)$/i.test(f)).sort()
      : [];
    if (files.length < 5) {
      // Evidence vault is not committed to the repository; skip on machines
      // without the real photo set rather than failing the whole suite.
      console.warn("[acceptance] Britannia photo vault not found — skipping acceptance run.");
      return;
    }

    const ocr = new PaddleOcrService();
    const batch = await ocr.processImageBatch(
      files.map((f, i) => ({ id: `br${i + 1}`, buffer: fs.readFileSync(path.join(PHOTO_DIR, f)), side: i === 0 ? "front" : "evidence" })),
    );

    console.log("[acceptance] raw OCR text:", batch.rawOcrText.slice(0, 1500));

    const declarations: Declaration[] = [];
    for (const field of TARGET_FIELDS) {
      const declMatch = batch.declarations.find((d) => d.field === field);
      if (declMatch && declMatch.status === "DETECTED" && declMatch.value) {
        declarations.push({
          field,
          value: field === "date" ? (normalizeDate(declMatch.value) ?? declMatch.value) : declMatch.value,
          rawValue: declMatch.rawValue || declMatch.value,
          status: "DETECTED",
          confidence: declMatch.confidence ?? 0.95,
          boundingBox: declMatch.bbox,
          polygon: declMatch.polygon,
          evidence: { rawText: declMatch.rawValue || declMatch.value, boundingBox: declMatch.bbox, polygon: declMatch.polygon },
        });
      } else {
        declarations.push({ field, value: null, status: "NOT_DETECTED", confidence: null });
      }
    }

    for (const d of declarations) {
      console.log(`[acceptance] DECL ${d.field}: ${d.status} ${d.value ?? ""}`);
    }

    const checks = evaluateCompliance(declarations, "br1", {});
    const status = overallStatus(checks);
    const score = complianceScore(checks);
    console.log("[acceptance] OVERALL:", status, "SCORE:", score);
    for (const c of checks) {
      console.log(`[acceptance]   ${c.ruleId} ${c.status} | ${c.explanation}`);
    }

    // Deterministic statutory finding on the real label:
    // MRP incl.-of-all-taxes, mfg date, net qty, manufacturer, care, COO, USP.
    const byRule = (id: string) => checks.find((c) => c.ruleId === id);
    expect(byRule("LM-PC-04")?.status).toBe("pass"); // MRP + incl. of all taxes
    expect(byRule("LM-PC-05")?.status).toBe("pass"); // mfg date
    expect(byRule("LM-PC-03")?.status).toBe("pass"); // net quantity
    expect(byRule("LM-PC-10-COO")?.status).toBe("pass"); // country of origin
    // No evaluated check may fail against a compliant real label.
    for (const c of checks) {
      if (c.status === "fail") {
        throw new Error(`Unexpected statutory FAIL ${c.ruleId}: ${c.explanation}`);
      }
    }
    expect(score).toBeGreaterThanOrEqual(90);
  });
});