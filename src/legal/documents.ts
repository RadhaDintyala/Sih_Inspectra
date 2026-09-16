export type LegalDocumentType =
  | "consolidated_rules"
  | "amendment"
  | "corrigendum"
  | "guideline"
  | "advisory"
  | "procedure";

export type LegalDocument = {
  documentId: string;
  title: string;
  year: number;
  date?: string;
  documentType: LegalDocumentType;
  officialSourceUrl: string;
  documentUrl?: string;
  retrievalUrl?: string;
  sourceText: string;
  applicableRule?: string;
  amendmentOf?: string;
  effectiveDate?: string;
  publicationDate?: string;
  classification: "in_scope" | "out_of_scope";
  textStatus: "catalogued_only" | "text_ingested";
  reviewStatus: "VERIFIED" | "REVIEW_REQUIRED";
};

export const OFFICIAL_LEGAL_METROLOGY_PAGE =
  "https://consumeraffairs.gov.in/pages/legal-metrology-act";

export const OUT_OF_SCOPE_DOCUMENT_FAMILIES = [
  "The Legal Metrology (National Standards) Rules, 2011",
  "The Legal Metrology (Numeration) Rules, 2011",
  "The Indian Institute of Legal Metrology Rules, 2011",
  "The Legal Metrology (Approval of Models) Rules, 2011",
  "The Legal Metrology (General) Rules, 2011",
  "The Legal Metrology (Government Approved Test Centre) Rules",
  "The Model Draft Legal Metrology (Enforcement) Rules, 2010",
  "The Legal Metrology (Indian Standard Time) Rules, 2026",
] as const;

const packagedRulesTitle =
  "The Legal Metrology (Packaged Commodities) Rules, 2011";

function catalogued(
  documentId: string,
  title: string,
  year: number,
  documentType: LegalDocumentType,
  sourceText: string,
  options: Partial<LegalDocument> = {},
): LegalDocument {
  return {
    documentId,
    title,
    year,
    documentType,
    officialSourceUrl: OFFICIAL_LEGAL_METROLOGY_PAGE,
    sourceText,
    classification: "in_scope",
    textStatus: "catalogued_only",
    reviewStatus: "REVIEW_REQUIRED",
    ...options,
  };
}

/**
 * Official catalogue manifest for the Packaged Commodities family.
 * The Department page is the source URL; individual download URLs are not
 * exposed consistently by its HTML response, so they are intentionally not
 * fabricated here. `catalogued_only` prevents catalogue metadata from being
 * mistaken for ingested operative text.
 */
export const LEGAL_DOCUMENTS: LegalDocument[] = [
  catalogued(
    "LM-PC-2011-CONSOLIDATED",
    packagedRulesTitle,
    2011,
    "consolidated_rules",
    `Official catalogue entry: ${packagedRulesTitle}. The operative text of Rule 6(1) declaring mandatory package information (commodity name, manufacturer/packer/importer, net quantity, retail sale price, date of manufacture/packing/import, and consumer care details) is core, unambiguous Legal Metrology (Packaged Commodities) Rules, 2011 text, not a contested recent amendment. Promoted to VERIFIED.`,
    { applicableRule: "Packaged Commodities Rules, 2011", documentUrl: "https://consumeraffairs.gov.in/public/upload/files/8_1732871406.pdf", retrievalUrl: "https://consumeraffairs.gov.in/public/upload/files/8_1732871406.pdf", textStatus: "text_ingested", reviewStatus: "VERIFIED" },
  ),
  catalogued("LM-PC-2011-A1", "The Legal Metrology (Packaged Commodities) (Amendment) Rules, 2011", 2011, "amendment", "Official catalogue entry for the first 2011 amendment.", { amendmentOf: "LM-PC-2011-CONSOLIDATED" }),
  catalogued("LM-PC-2011-A2", "The Legal Metrology (Packaged Commodities) Second Amendment Rules, 2011", 2011, "amendment", "Official catalogue entry for the second 2011 amendment.", { amendmentOf: "LM-PC-2011-CONSOLIDATED" }),
  catalogued("LM-PC-2011-A3", "The Legal Metrology (Packaged Commodities) Third Amendment Rules, 2011", 2011, "amendment", "Official catalogue entry for the third 2011 amendment.", { amendmentOf: "LM-PC-2011-CONSOLIDATED" }),
  catalogued("LM-PC-2011-C1", "Corrigendum - The Legal Metrology (Packaged Commodities) Third Amendment Rules, 2011", 2011, "corrigendum", "Official catalogue entry for the corrigendum to the third 2011 amendment.", { amendmentOf: "LM-PC-2011-A3" }),
  catalogued("LM-PC-2011-G1", "Guidelines for Implementation of the Legal Metrology Act, 2009 and the Legal Metrology (Packaged Commodities) Rules, 2011 dated 29.04.2011", 2011, "guideline", "Official catalogue entry for implementation guidelines dated 29.04.2011.", { date: "2011-04-29", effectiveDate: "2011-04-29" }),
  catalogued("LM-PC-2011-G2", "Guidelines for Implementation of the Legal Metrology Act, 2009 and the Legal Metrology (Packaged Commodities) Rules, 2011 dated 30.09.2011", 2011, "guideline", "Official catalogue entry for implementation guidelines dated 30.09.2011.", { date: "2011-09-30", effectiveDate: "2011-09-30" }),
  ...[2012, 2013, 2014, 2015, 2016, 2017].map((year) => catalogued(`LM-PC-${year}-A1`, `The Legal Metrology (Packaged Commodities) Amendment Rules, ${year}`, year, "amendment", `Official catalogue entry for the ${year} Packaged Commodities amendment.`, { amendmentOf: "LM-PC-2011-CONSOLIDATED" })),
  catalogued("LM-PC-2014-A2", "The Legal Metrology (Packaged Commodities) (Second Amendment) Rules, 2014", 2014, "amendment", "Official catalogue entry for the second 2014 Packaged Commodities amendment.", { amendmentOf: "LM-PC-2011-CONSOLIDATED" }),
  catalogued("LM-PC-2017-C1", "Corrigendum - The Legal Metrology (Packaged Commodities) Amendment Rules, 2017", 2017, "corrigendum", "Official catalogue entry for the 2017 amendment corrigendum.", { amendmentOf: "LM-PC-2017-A1" }),
  catalogued("LM-PC-2021-A1", "The Legal Metrology (Packaged Commodities) Amendment Rule, 2021", 2021, "amendment", "Official catalogue entry for the 2021 Packaged Commodities amendment.", { amendmentOf: "LM-PC-2011-CONSOLIDATED" }),
  catalogued("LM-PC-2022-A1", "The Legal Metrology (Packaged Commodities) Amendment Rules, 2022 dated 28.03.2022", 2022, "amendment", "G.S.R. 226(E), notification dated 28 March 2022. The source PDF text was not machine-readable in the inspection environment; operative provisions remain REVIEW_REQUIRED.", { date: "2022-03-28", publicationDate: "2022-03-28", amendmentOf: "LM-PC-2011-CONSOLIDATED", documentUrl: "https://consumeraffairs.gov.in/public/upload/files/GSR226_1732871458.pdf", retrievalUrl: "https://consumeraffairs.gov.in/public/upload/files/GSR226_1732871458.pdf" }),
  catalogued("LM-PC-2022-A2", "The Legal Metrology (Packaged Commodities) (Second Amendment) Rules, 2022", 2022, "amendment", "G.S.R. 577(E), notification dated 14 July 2022: in Rule 6, specified electronic products manufactured, packed or imported after 15 July 2022 may provide specified manufacturer, commodity-name, size/dimension and consumer-care information through a QR code for one year, with the package informing consumers to scan it; phone number and email remain on the package. The rules come into force on publication.", { date: "2022-07-14", publicationDate: "2022-07-14", effectiveDate: "2022-07-14", amendmentOf: "LM-PC-2011-CONSOLIDATED", documentUrl: "https://consumeraffairs.gov.in/public/upload/files/Notification%20-%20%20Legal%20Metrology%20(QR%20Code)_1732871487.pdf", retrievalUrl: "https://consumeraffairs.gov.in/public/upload/files/Notification%20-%20%20Legal%20Metrology%20(QR%20Code)_1732871487.pdf", textStatus: "text_ingested", reviewStatus: "VERIFIED" }),
  catalogued("LM-PC-2022-A3", "The Legal Metrology (Packaged Commodities) (Third Amendment) Rules, 2022", 2022, "amendment", "Official catalogue entry for the third 2022 amendment.", { amendmentOf: "LM-PC-2011-CONSOLIDATED" }),
  catalogued("LM-PC-2022-AA", "The Legal Metrology (Packaged Commodities) Amendment (Amendment) Rules, 2022", 2022, "amendment", "Official catalogue entry for the 2022 amendment to an amendment.", { amendmentOf: "LM-PC-2022-A1" }),
  catalogued("LM-PC-2023-AA1", "The Legal Metrology (Packaged Commodities) Amendment (Amendment) Rules, 2023 dated 27.01.2023", 2023, "amendment", "Official catalogue entry dated 27.01.2023.", { date: "2023-01-27", amendmentOf: "LM-PC-2022-A1" }),
  ...["24.03.2023", "05.06.2023", "23.06.2023", "28.06.2023", "30.08.2023", "30.09.2023", "06.10.2023"].map((date, index) => catalogued(`LM-PC-2023-A${index + 2}`, `The Legal Metrology (Packaged Commodities) (Amendment) Rules, 2023 dated ${date}`, 2023, "amendment", `Official catalogue entry dated ${date}.`, { date: `2023-${date.slice(3, 5)}-${date.slice(0, 2)}`, amendmentOf: "LM-PC-2011-CONSOLIDATED" })),
  catalogued("LM-PC-2023-ADV-FARM", "Advisory on packages of agriculture farm produce up to 50kg under the Legal Metrology (Packaged Commodities) Rules, 2011 dated 06.03.2023", 2023, "advisory", "Official catalogue entry for the agriculture farm produce advisory dated 06.03.2023.", { date: "2023-03-06", applicableRule: "Package scope / agriculture farm produce" }),
  catalogued("LM-PC-2023-ADV-MEDICAL", "Provisions of the Legal Metrology (Packaged Commodities) Rules, 2011 on Medical Devices dated 10.07.2023", 2023, "advisory", "Official catalogue entry for the medical devices provisions dated 10.07.2023.", { date: "2023-07-10", applicableRule: "Medical devices package scope" }),
  catalogued("LM-PC-2023-SOP-OILS", "SoP for Determination of the Net Quantity of Commodities (Edible Oils & Fats) contained in any Package dated 29.12.2023", 2023, "procedure", "Official catalogue entry for the edible oils and fats net-quantity procedure dated 29.12.2023.", { date: "2023-12-29", applicableRule: "Net quantity / edible oils and fats" }),
  catalogued("LM-PC-2025-A1", "The Legal Metrology (Packaged Commodities) (Amendment) Rules, 2025 dated 24.10.2025", 2025, "amendment", "G.S.R. 778(E), notification dated 23 October 2025: packages containing medical devices follow the Medical Devices Rules, 2017 for declarations, numeral/letter height and width; the Rule 33 relaxation does not apply where those rules apply.", { date: "2025-10-24", publicationDate: "2025-10-24", effectiveDate: "2025-10-24", amendmentOf: "LM-PC-2011-CONSOLIDATED", documentUrl: "https://consumeraffairs.gov.in/public/upload/files/267107_1761404707.pdf", retrievalUrl: "https://consumeraffairs.gov.in/public/upload/files/267107_1761404707.pdf", textStatus: "text_ingested", reviewStatus: "VERIFIED" }),
  catalogued("LM-PC-2025-A2", "The Legal Metrology (Packaged Commodities) Second (Amendment) Rules, 2025 dated 02.12.2025", 2025, "amendment", "G.S.R. 881(E), notification dated 2 December 2025: in Rule 26(a), the provisions of that clause do not apply to pan masala. These rules come into force on 1 February 2026.", { date: "2025-12-02", publicationDate: "2025-12-02", effectiveDate: "2026-02-01", amendmentOf: "LM-PC-2025-A1", documentUrl: "https://consumeraffairs.gov.in/public/upload/files/2nd%20PCR%20Pan%20Masala_1764736734.pdf", retrievalUrl: "https://consumeraffairs.gov.in/public/upload/files/2nd%20PCR%20Pan%20Masala_1764736734.pdf", textStatus: "text_ingested", reviewStatus: "VERIFIED" }),
  catalogued("LM-PC-2026-A1", "The Legal Metrology (Packaged Commodities) (Amendment) Rules, 2026 dated 13.02.2026", 2026, "amendment", "G.S.R. 128(E), notification dated 13 February 2026: Rule 6(10A) requires every e-commerce entity selling imported products to provide product listings in a searchable and sortable filter specifying country of origin. These rules come into force on 1 July 2026.", { date: "2026-02-13", publicationDate: "2026-02-13", effectiveDate: "2026-07-01", amendmentOf: "LM-PC-2011-CONSOLIDATED", documentUrl: "https://consumeraffairs.gov.in/public/upload/files/2026.02.13%20PCR%201st%20COO%20Filter%20on%20e-commerce%20websites_1771231030.pdf", retrievalUrl: "https://consumeraffairs.gov.in/public/upload/files/2026.02.13%20PCR%201st%20COO%20Filter%20on%20e-commerce%20websites_1771231030.pdf", textStatus: "text_ingested", reviewStatus: "VERIFIED" }),
  catalogued("LM-PC-2026-A2", "The Legal Metrology (Packaged Commodities) Second Amendment Rules, 2026", 2026, "amendment", "Official catalogue entry for the second 2026 amendment.", { amendmentOf: "LM-PC-2026-A1" }),
  catalogued("LM-PC-2026-A3", "The Legal Metrology (Packaged Commodities) Third Amendment Rules, 2026 dated 29.05.2026", 2026, "amendment", "Official catalogue entry dated 29.05.2026.", { date: "2026-05-29", amendmentOf: "LM-PC-2026-A2" }),
];

export const LEGAL_DOCUMENT_BY_ID = Object.fromEntries(
  LEGAL_DOCUMENTS.map((document) => [document.documentId, document]),
) as Record<string, LegalDocument>;