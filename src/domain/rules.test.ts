import { describe, expect, it } from "vitest";
import { evaluateCompliance, overallStatus } from "./rules";
import { clearPackageDeclarations, blurryPackageDeclarations } from "@/test-data/package-fixtures";
import { mergeDeclarations } from "@/services/extraction";

describe("deterministic compliance engine", () => {
  it("keeps readability physical measurement as review when bounding box data is missing", () => {
    const checks = evaluateCompliance([{ field: "product_name", value: "Tea", status: "DETECTED", confidence: 0.9 }], "image-1");
    const readability = checks.find((check) => check.ruleId === "LM-PC-07");
    expect(readability?.status).toBe("review");
    expect(readability?.evidence).toContain("READABILITY_NO_REGION_DATA");
  });

  it("flags disproportionately tiny text regions as review with READABILITY_REGION_PROPORTIONALLY_TINY", () => {
    const checks = evaluateCompliance(
      [
        { field: "product_name", value: "Harvest Gold Chickpeas", status: "DETECTED", confidence: 0.9, boundingBox: { x: 10, y: 10, width: 60, height: 12 } },
        { field: "mrp", value: "₹120.00", status: "DETECTED", confidence: 0.9, boundingBox: { x: 10, y: 80, width: 20, height: 1.2 } }, // 1.2% height < 2.5% threshold
      ],
      "image-tiny"
    );
    const readability = checks.find((check) => check.ruleId === "LM-PC-07");
    expect(readability?.status).toBe("review");
    expect(readability?.evidence).toContain("READABILITY_REGION_PROPORTIONALLY_TINY");
    expect(readability?.explanation).toContain("HEURISTIC READABILITY PROXY");
  });

  it("evaluates readability as pass when bounding box height heuristics are satisfied", () => {
    const checks = evaluateCompliance(
      [
        { field: "product_name", value: "Harvest Gold Chickpeas", status: "DETECTED", confidence: 0.9, boundingBox: { x: 10, y: 10, width: 60, height: 10 } },
        { field: "mrp", value: "₹120.00", status: "DETECTED", confidence: 0.9, boundingBox: { x: 10, y: 70, width: 30, height: 8 } },
        { field: "net_quantity", value: "500 g", status: "DETECTED", confidence: 0.9, boundingBox: { x: 10, y: 60, width: 25, height: 7 } },
      ],
      "image-normal"
    );
    const readability = checks.find((check) => check.ruleId === "LM-PC-07");
    expect(readability?.status).toBe("pass");
    expect(readability?.evidence).toContain("meet readability heuristics");
    expect(readability?.explanation).toContain("uncalibrated visual proxy");
  });

  it("flags MRP without a valid currency marker as fail when source is verified", () => {
    const checks = evaluateCompliance([{ field: "mrp", value: "MRP 128", status: "DETECTED", confidence: 0.9, evidenceImageId: "image-1", boundingBox: { x: 10, y: 20, width: 20, height: 10 } }], "image-1");
    const mrp = checks.find((check) => check.ruleId === "LM-PC-04");
    expect(mrp?.status).toBe("fail");
    expect(mrp?.evidence).toBe("MRP 128");
    expect(mrp?.boundingBox).toBeDefined();
    expect(overallStatus(checks)).toBe("fail");
  });

  it("passes a clear package declaration when source text is verified", () => {
    const checks = evaluateCompliance(clearPackageDeclarations, "test-front");
    const mrp = checks.find((check) => check.ruleId === "LM-PC-04");
    expect(mrp?.status).toBe("pass");
    // LM-PC-07 (readability) is still review — no bounding boxes in fixture
    expect(overallStatus(checks)).toBe("review");
  });

  it("downgrades blurry missing text to review", () => {
    const checks = evaluateCompliance(blurryPackageDeclarations, "test-blurry");
    expect(checks.find((check) => check.ruleId === "LM-PC-04")?.status).toBe("review");
  });

  it("marks conflicting values from front and back as review and retains both sources", () => {
    const declarations = mergeDeclarations([
      { field: "mrp", value: "₹120.00", status: "DETECTED", confidence: 0.9, evidenceImageId: "front" },
      { field: "mrp", value: "₹125.00", status: "DETECTED", confidence: 0.88, evidenceImageId: "back" },
    ]);
    expect(declarations[0].conflict).toBe(true);
    expect(declarations[0].evidenceImageIds).toEqual(["front", "back"]);
    expect(evaluateCompliance(declarations, "front").find((check) => check.ruleId === "LM-PC-04")?.status).toBe("review");
  });

  it("represents missing evidence without a fabricated confidence", () => {
    const declarations = mergeDeclarations([
      { field: "mrp", value: null, status: "NOT_DETECTED", confidence: null, evidenceImageId: "front" },
    ]);
    expect(declarations[0].status).toBe("NOT_DETECTED");
    expect(declarations[0].confidence).toBeNull();
    expect(evaluateCompliance(declarations, "front").find((check) => check.ruleId === "LM-PC-04")?.status).toBe("review");
  });

  it("retains agreement evidence from multiple images without conflict", () => {
    const declarations = mergeDeclarations([
      { field: "mrp", value: "₹20.00", status: "DETECTED", confidence: 0.8, evidenceImageId: "front" },
      { field: "mrp", value: "₹20.00", status: "DETECTED", confidence: 0.9, evidenceImageId: "back" },
    ]);
    expect(declarations[0].status).toBe("DETECTED");
    expect(declarations[0].conflict).not.toBe(true);
    expect(declarations[0].evidenceImageIds).toEqual(["front", "back"]);
  });

  it("resolves multiple candidate values within a single image without spurious CONFLICT status", () => {
    const declarations = mergeDeclarations([
      { field: "mrp", value: "₹120.00", status: "DETECTED", confidence: 0.92, evidenceImageId: "front_01" },
      { field: "mrp", value: "₹125.00", status: "DETECTED", confidence: 0.65, evidenceImageId: "front_01" },
    ]);
    expect(declarations[0].conflict).toBe(false);
    expect(declarations[0].status).toBe("DETECTED");
    expect(declarations[0].value).toBe("₹120.00");
    expect(declarations[0].confidence).toBe(0.92);
  });

  it("does not apply packaged commodity rules to an unsupported category", () => {
    const checks = evaluateCompliance(clearPackageDeclarations, "test-front", { packageCategory: "unsupported" });
    expect(checks.every((check) => check.status === "not_applicable")).toBe(true);
  });
});