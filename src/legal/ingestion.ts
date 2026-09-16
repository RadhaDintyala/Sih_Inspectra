import type { LegalDocument, LegalDocumentType } from "./documents";
import { OFFICIAL_LEGAL_METROLOGY_PAGE } from "./documents";

export type DocumentClassification = {
  documentType: LegalDocumentType;
  inScope: boolean;
  reason: string;
};

export function classifyOfficialDocument(title: string): DocumentClassification {
  const normalized = title.toLowerCase();
  const packaged = normalized.includes("packaged commodities");
  if (!packaged) return { documentType: "advisory", inScope: false, reason: "Unrelated Legal Metrology family; excluded from packaged-commodity label rules." };
  if (normalized.includes("corrigendum")) return { documentType: "corrigendum", inScope: true, reason: "Correction linked to a Packaged Commodities document." };
  if (normalized.includes("guideline")) return { documentType: "guideline", inScope: true, reason: "Implementation guidance for the Packaged Commodities family." };
  if (normalized.includes("advisory")) return { documentType: "advisory", inScope: true, reason: "Packaged Commodities advisory; may clarify scope or enforcement." };
  if (normalized.includes("sop")) return { documentType: "procedure", inScope: true, reason: "Packaged Commodities measurement procedure." };
  if (normalized.includes("amendment")) return { documentType: "amendment", inScope: true, reason: "Amendment linked to the Packaged Commodities family." };
  return { documentType: "consolidated_rules", inScope: true, reason: "Base Packaged Commodities rules document." };
}

export function ingestOfficialDocumentText(document: LegalDocument, sourceText: string, sourceUrl = document.officialSourceUrl): LegalDocument {
  if (sourceUrl !== OFFICIAL_LEGAL_METROLOGY_PAGE && !sourceUrl.startsWith("https://consumeraffairs.gov.in/")) {
    throw new Error("Legal document source must be an official Department of Consumer Affairs URL.");
  }
  if (!sourceText.trim()) throw new Error("Cannot ingest an empty legal document text.");
  return { ...document, officialSourceUrl: sourceUrl, sourceText: sourceText.trim(), textStatus: "text_ingested", reviewStatus: "VERIFIED" };
}