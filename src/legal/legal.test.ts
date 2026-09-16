import { describe, expect, it } from "vitest";
import { LEGAL_DOCUMENTS, LEGAL_DOCUMENT_BY_ID, OUT_OF_SCOPE_DOCUMENT_FAMILIES } from "./documents";
import { classifyOfficialDocument, ingestOfficialDocumentText } from "./ingestion";
import { LEGAL_RULE_REGISTRY } from "./registry";

describe("official legal document registry", () => {
  it("keeps unrelated rule families out of packaged commodity scope", () => {
    expect(OUT_OF_SCOPE_DOCUMENT_FAMILIES.length).toBeGreaterThan(0);
    expect(classifyOfficialDocument("The Legal Metrology (General) Rules, 2011").inScope).toBe(false);
    expect(classifyOfficialDocument("The Legal Metrology (Packaged Commodities) Amendment Rules, 2026").inScope).toBe(true);
  });

  it("catalogues the latest 2025 and 2026 packaged commodity amendments", () => {
    expect(LEGAL_DOCUMENTS.some((document) => document.year === 2025)).toBe(true);
    expect(LEGAL_DOCUMENTS.some((document) => document.year === 2026)).toBe(true);
    expect(LEGAL_RULE_REGISTRY.every((rule) => LEGAL_DOCUMENT_BY_ID[rule.sourceDocument])).toBe(true);
    expect(LEGAL_DOCUMENT_BY_ID["LM-PC-2022-A2"].reviewStatus).toBe("VERIFIED");
    expect(LEGAL_DOCUMENT_BY_ID["LM-PC-2025-A2"].effectiveDate).toBe("2026-02-01");
    expect(LEGAL_DOCUMENT_BY_ID["LM-PC-2026-A1"].effectiveDate).toBe("2026-07-01");
    expect(LEGAL_RULE_REGISTRY.find((rule) => rule.ruleId === "LM-PC-09")?.sourceSection).toBe("Rule 6(10A)");
    expect(LEGAL_RULE_REGISTRY.find((rule) => rule.ruleId === "LM-PC-01")?.sourceUrl).toContain("8_1732871406.pdf");
  });

  it("only promotes explicitly supplied official text to text_ingested", () => {
    const document = ingestOfficialDocumentText(LEGAL_DOCUMENT_BY_ID["LM-PC-2011-CONSOLIDATED"], "Verified source text supplied by the official PDF ingestion job.");
    expect(document.textStatus).toBe("text_ingested");
    expect(() => ingestOfficialDocumentText(document, "text", "https://example.com/not-official")).toThrow();
  });
});