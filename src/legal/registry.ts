import type { DeclarationField } from "@/domain/inspection";
import { LEGAL_DOCUMENT_BY_ID, LEGAL_DOCUMENTS, type LegalDocument } from "./documents";

export type ValidatorType =
  | "presence"
  | "format"
  | "measurement"
  | "category_scope"
  | "placement"
  | "character_height"
  | "readability"
  | "contrast"
  | "quantity"
  | "mrp"
  | "date"
  | "address"
  | "origin"
  | "declaration_presence"
  | "declaration_content"
  | "declaration_format"
  | "principal_display_panel"
  | "quantity_unit"
  | "quantity_inspection"
  | "mrp_validation"
  | "date_validation"
  | "manufacturer_address"
  | "country_of_origin"
  | "consumer_care"
  | "consumer_care_format"
  | "unit_price"
  | "unit_sale_price"
  | "product_specific"
  | "physical_verification"
  | "physical_quantity"
  | "conflict_detection"
  | "conflicting_declarations"
  | "misleading"
  | "misleading_declarations"
  | "officer_verification"
  | "manual_officer_verification";

export type RuleRegistryStatus = "provisional" | "active" | "retired";

export type LegalRule = {
  ruleId: string;
  /** Legal Metrology (Packaged Commodities) Rules rule number, e.g. 6. */
  ruleNumber: number;
  /** Sub-rule, e.g. "6(1)(e)". */
  subRule?: string;
  title: string;
  requirement: string;
  applicablePackageCategory?: string;
  field: DeclarationField | "readability" | "placement" | "evidence" | "quantity_inspection" | "wholesale";
  validatorType: ValidatorType;
  severity: "critical" | "major" | "minor";
  sourceDocument: string;
  sourceUrl: string;
  sourceSection: string;
  effectiveDate?: string;
  version?: string;
  evidenceRequirement: string;
  status: RuleRegistryStatus;
  engineEnabled?: boolean;
  validationType?: string;
};

const sourceDocument = "LM-PC-2011-CONSOLIDATED";
const source = LEGAL_DOCUMENT_BY_ID[sourceDocument];
const sourceUrl = source.documentUrl ?? source.officialSourceUrl;
const documentSourceUrl = (documentId: string) => LEGAL_DOCUMENT_BY_ID[documentId].documentUrl ?? LEGAL_DOCUMENT_BY_ID[documentId].officialSourceUrl;

/**
 * Versioned Legal Metrology (Packaged Commodities) Rules, 2011 rule registry.
 *
 * Rules are data. Each rule record carries:
 *   Law    — Legal Metrology Act, 2009 / Packaged Commodities Rules, 2011
 *   Rule   — e.g. "Rule 6"
 *   Sub-rule — e.g. "6(1)"
 *   Title, Requirement, Applicability, Validation type, Severity,
 *   Effective date/version, Official source link.
 *
 * Statuses:
 *   active       — source text verified, safe to apply deterministically
 *   provisional  — physical-calibrated measurements required or text pending
 *   retired      — superseded by amendment
 */
export const LEGAL_RULE_REGISTRY: LegalRule[] = [
  // ── Rule 4: Regulation of pre-packing and sale ───────────────────────────
  {
    ruleId: "LM-PC-R4-01",
    ruleNumber: 4,
    subRule: "4(1)",
    title: "Regulation for pre-packing and sale",
    requirement: "No person shall pre-pack any commodity for sale or expose or possess for sale any pre-packed commodity unless the package is in such form and contains such label and declaration as required by these rules.",
    applicablePackageCategory: "all pre-packed commodities sold in retail",
    field: "evidence",
    validatorType: "presence",
    severity: "critical",
    sourceDocument,
    sourceUrl,
    sourceSection: "Rule 4(1)",
    version: "2011.1",
    evidenceRequirement: "Package presence and label/declaration evidence; package gate and mandatory declaration checks.",
    status: "active",
    engineEnabled: true,
  },
  {
    ruleId: "LM-PC-R4-02",
    ruleNumber: 4,
    title: "Declaration to appear on label",
    requirement: "The label should be securely affixed in a conspicuous place and contain all required particulars in a plain and readable manner.",
    field: "placement",
    validatorType: "placement",
    severity: "major",
    sourceDocument,
    sourceUrl,
    sourceSection: "Rule 4",
    version: "2011.1",
    evidenceRequirement: "Label visibility and placement evidence from photograph.",
    status: "active",
    engineEnabled: true,
  },

  // ── Rule 5: Specific commodities / standard packages ─────────────────────
  {
    ruleId: "LM-PC-R5-01",
    ruleNumber: 5,
    title: "Commodities in scheduled / standard package form",
    requirement: "Commodities specified in Part A of the First Schedule must be pre-packed only in standard quantities specified. Packages violating standard quantities are not to be pre-packed, sold, or possessed.",
    field: "net_quantity",
    validatorType: "quantity",
    severity: "critical",
    sourceDocument,
    sourceUrl,
    sourceSection: "Rule 5",
    applicablePackageCategory: "commodities listed in First Schedule Part A",
    version: "2011.1",
    evidenceRequirement: "Net quantity declaration vs. statutory standard package quantity.",
    status: "active",
    engineEnabled: true,
  },
  {
    ruleId: "LM-PC-R5-02",
    ruleNumber: 5,
    title: "Standard package non-conformance",
    requirement: "The package shall not be pre-packed or sold if its net quantity does not conform with the standard quantity prescribed for the commodity.",
    field: "net_quantity",
    validatorType: "quantity",
    severity: "critical",
    sourceDocument,
    sourceUrl,
    sourceSection: "Rule 5(1)",
    version: "2011.1",
    evidenceRequirement: "Declared net quantity and package valuation.",
    status: "active",
    engineEnabled: true,
  },

  // ── Rule 6: Mandatory declarations ───────────────────────────────────────
  {
    ruleId: "LM-PC-01",
    ruleNumber: 6,
    title: "Commodity name",
    requirement: "A commodity name or common/generic name declaration must appear on the principal display panel.",
    field: "product_name",
    validatorType: "presence",
    severity: "major",
    sourceDocument,
    sourceUrl,
    sourceSection: "Rule 6(1)",
    version: "2011.1",
    evidenceRequirement: "Readable declaration with image region and extraction confidence.",
    status: "active",
    engineEnabled: true,
  },
  {
    ruleId: "LM-PC-02",
    ruleNumber: 6,
    title: "Manufacturer, packer or importer",
    requirement: "The name and complete address of the manufacturer, or where the package is packed or made, the packer or importer shall be declared with address.",
    field: "manufacturer",
    validatorType: "address",
    severity: "critical",
    sourceDocument,
    sourceUrl,
    sourceSection: "Rule 6(1)(a)",
    version: "2011.1",
    evidenceRequirement: "Readable name/address region with source image and confidence.",
    status: "active",
    engineEnabled: true,
  },
  {
    ruleId: "LM-PC-03",
    ruleNumber: 6,
    title: "Net quantity",
    requirement: "The net quantity, in terms of standard unit of weight or measure or number, shall be declared.",
    field: "net_quantity",
    validatorType: "quantity",
    severity: "critical",
    sourceDocument,
    sourceUrl,
    sourceSection: "Rule 6(1)(b)",
    version: "2011.1",
    evidenceRequirement: "Readable quantity, unit, image region, and confidence.",
    status: "active",
    engineEnabled: true,
  },
  {
    ruleId: "LM-PC-05",
    ruleNumber: 6,
    title: "Date declaration",
    requirement: "The month and year in which the commodity is manufactured or pre-packed or imported shall be declared.",
    field: "date",
    validatorType: "date",
    severity: "critical",
    sourceDocument,
    sourceUrl,
    sourceSection: "Rule 6(1)(d)",
    version: "2011.1",
    evidenceRequirement: "Readable date region with image and confidence.",
    status: "active",
    engineEnabled: true,
  },
  {
    ruleId: "LM-PC-04",
    ruleNumber: 6,
    title: "Retail sale price (MRP)",
    requirement: "The retail sale price of the package shall be indicated with the words 'INCLUSIVE OF ALL TAXES' or 'inclusive of all taxes shall be applicable' including the maximum retail price in Indian currency and the phrase 'Maximum Retail Price'.",
    field: "mrp",
    validatorType: "mrp",
    severity: "critical",
    sourceDocument,
    sourceUrl,
    sourceSection: "Rule 6(1)(e)",
    version: "2011.1",
    evidenceRequirement: "Readable price declaration with tax-inclusive wording, image region and confidence.",
    status: "active",
    engineEnabled: true,
  },
  {
    ruleId: "LM-PC-06",
    ruleNumber: 6,
    title: "Consumer care details",
    requirement: "The name, address, telephone number, e-mail address of the person or the office to be contacted for complaints and queries shall be declared.",
    field: "consumer_care",
    validatorType: "consumer_care_format",
    severity: "major",
    sourceDocument,
    sourceUrl,
    sourceSection: "Rule 6(1)(f)",
    version: "2011.1",
    evidenceRequirement: "Readable contact declaration with image region and confidence.",
    status: "active",
    engineEnabled: true,
  },
  {
    ruleId: "LM-PC-R6-02",
    ruleNumber: 6,
    title: "Best before / use by date",
    requirement: "Where applicable, the best-before or use-by date of the commodity shall be declared in a proper and conspicuous manner.",
    field: "best_before",
    validatorType: "date",
    severity: "major",
    sourceDocument,
    sourceUrl,
    sourceSection: "Rule 6(1)",
    version: "2011.1",
    evidenceRequirement: "Readable best-before / use-by date region.",
    status: "active",
    engineEnabled: true,
  },
  {
    ruleId: "LM-PC-R6-03",
    ruleNumber: 6,
    title: "Unit sale price",
    requirement: "The unit sale price of the commodity (amount per standard unit) shall be declared wherever applicable, for larger packages (above 250 g/l) where unit-sale price declaration is mandated.",
    field: "unit_sale_price",
    validatorType: "unit_price",
    severity: "major",
    sourceDocument,
    sourceUrl,
    sourceSection: "Rule 6(1)",
    version: "2011.1",
    evidenceRequirement: "Readable unit price declaration (₹ per g/kg/ml/l/piece).",
    status: "active",
    engineEnabled: true,
  },
  {
    ruleId: "LM-PC-R6-04",
    ruleNumber: 6,
    title: "Dimensions declaration",
    requirement: "Where applicable (textile, paper, plastic film and other dimensioned commodities), the dimensions of the commodity shall be declared.",
    field: "dimensions",
    validatorType: "product_specific",
    severity: "major",
    applicablePackageCategory: "paper, textile, plastic film, and dimensioned commodities",
    sourceDocument,
    sourceUrl,
    sourceSection: "Rule 6(1)",
    version: "2011.1",
    evidenceRequirement: "Readable dimension declaration (length x width x height or length x width).",
    status: "active",
    engineEnabled: true,
  },
  {
    ruleId: "LM-PC-R6-05",
    ruleNumber: 6,
    title: "Customer care name",
    requirement: "The name and address of the packer or importer, and the office/person for consumer complaints must be declared.",
    field: "consumer_care",
    validatorType: "consumer_care_format",
    severity: "major",
    sourceDocument,
    sourceUrl,
    sourceSection: "Rule 6(2)",
    version: "2011.1",
    evidenceRequirement: "Consumer care cell/office declaration with address.",
    status: "active",
    engineEnabled: false,
  },
{
    ruleId: "LM-PC-07",
    ruleNumber: 9,
    title: "Manner / readability / visibility of declarations",
    requirement: "Declarations shall be legible, prominent, definite, plain and conspicuous, and shall not be hidden or obscured by other written, printed, or graphic material.",
    field: "readability",
    validatorType: "readability",
    severity: "major",
    sourceDocument,
    sourceUrl,
    sourceSection: "Rule 9",
    version: "2011.1",
    evidenceRequirement: "OCR text clarity, region geometry, and obstruction detection.",
    status: "active",
    engineEnabled: true,
  },
  {
    ruleId: "LM-PC-R7-01",
    ruleNumber: 7,
    subRule: "7(3)",
    title: "Character height on principal display panel",
    requirement: "The height of numerals and letters used in declarations must not be less than the minimum prescribed: (a) larger package: not less than 4 mm for numerals of net quantity and price, 3 mm for other declarations; (b) smaller package: not less than 3 mm for numerals of net quantity and price, 1.5 mm for other letters.",
    field: "readability",
    validatorType: "character_height",
    severity: "minor",
    sourceDocument,
    sourceUrl,
    sourceSection: "Rule 7(3)",
    version: "2011.1",
    evidenceRequirement: "Calibrated physical measurement (pixels-per-mm scale reference) of declared letter/number height.",
    status: "active",
    engineEnabled: true,
  },
  {
    ruleId: "LM-PC-08",
    ruleNumber: 8,
    title: "Placement of declarations",
    requirement: "All declarations required under these rules shall be legible, prominent, definite, plain, and conspicuous, and shall not be distorted or hidden. The declarations must appear on the principal display panel of the package.",
    field: "placement",
    validatorType: "placement",
    severity: "minor",
    sourceDocument,
    sourceUrl,
    sourceSection: "Rule 8",
    version: "2011.1",
    evidenceRequirement: "Image evidence showing position of declarations on the package.",
    status: "active",
    engineEnabled: true,
  },
  {
    ruleId: "LM-PC-09",
    ruleNumber: 6,
    subRule: "6(10A)",
    title: "E-commerce listing — country of origin disclosure",
    requirement: "Rule 6(10A) (as amended 2026) requires every e-commerce entity selling imported products to provide product listings in a searchable and sortable filter specifying the country of origin.",
    field: "country_of_origin",
    validatorType: "origin",
    severity: "major",
    sourceDocument,
    sourceUrl,
    sourceSection: "Rule 6(10A)",
    version: "2026.1",
    evidenceRequirement: "E-commerce listing country-of-origin filter / declaration.",
    status: "active",
    engineEnabled: true,
  },
  {
    ruleId: "LM-PC-10",
    ruleNumber: 10,
    title: "Manufacturer / packer / importer declaration",
    requirement: "The name and complete address of the manufacturer, packer or importer shall be declared on the package.",
    field: "manufacturer",
    validatorType: "address",
    severity: "critical",
    sourceDocument,
    sourceUrl,
    sourceSection: "Rule 10",
    version: "2011.1",
    evidenceRequirement: "Name and address with PIN code or address structure.",
    status: "active",
    engineEnabled: false,
  },
  {
    ruleId: "LM-PC-11",
    ruleNumber: 11,
    title: "General provisions for declaration of quantity",
    requirement: "The declaration of quantity shall be expressed in the units prescribed and the net quantity declared shall be measured in such standard units.",
    field: "net_quantity",
    validatorType: "quantity",
    severity: "critical",
    sourceDocument,
    sourceUrl,
    sourceSection: "Rule 11",
    version: "2011.1",
    evidenceRequirement: "Quantity declaration in standard SI units.",
    status: "active",
    engineEnabled: false,
  },
  {
    ruleId: "LM-PC-12",
    ruleNumber: 12,
    title: "Manner of declaration of quantity",
    requirement: "The declaration of quantity of a commodity shall be made on the package in the form required under Rule 12, including the applicable exemptions for small packages and fractional quantities.",
    field: "net_quantity",
    validatorType: "quantity",
    severity: "critical",
    sourceDocument,
    sourceUrl,
    sourceSection: "Rule 12",
    version: "2011.1",
    evidenceRequirement: "Declared quantity in required format, unit, and exact value.",
    status: "active",
    engineEnabled: false,
  },
  {
    ruleId: "LM-PC-13",
    ruleNumber: 13,
    title: "Units of weight, measure and number",
    requirement: "The declaration of quantity shall be expressed in accordance with the units of weight, measure or number specified under the Legal Metrology (National Standards) Rules, 2011 (SI metric system).",
    field: "net_quantity",
    validatorType: "quantity",
    severity: "critical",
    sourceDocument,
    sourceUrl,
    sourceSection: "Rule 13",
    version: "2011.1",
    evidenceRequirement: "Assess that declared unit is SI/metric.",
    status: "active",
    engineEnabled: false,
  },
  {
    ruleId: "LM-PC-14",
    ruleNumber: 14,
    title: "Dimensions of applicable commodities",
    requirement: "Where applicable, the dimensions of the commodity (e.g., paper, textile, plastic film) shall be declared in the manner prescribed.",
    field: "dimensions",
    validatorType: "product_specific",
    severity: "minor",
    applicablePackageCategory: "paper, textile, plastic film, dimensioned commodities",
    sourceDocument,
    sourceUrl,
    sourceSection: "Rule 14",
    version: "2011.1",
    evidenceRequirement: "Dimension declaration on package.",
    status: "active",
    engineEnabled: true,
  },
  {
    ruleId: "LM-PC-16",
    ruleNumber: 16,
    title: "Number of usable sheets",
    requirement: "Where a commodity is sold or intended to be sold by number of usable sheets, the package shall declare the number of usable sheets contained therein.",
    field: "net_quantity",
    validatorType: "product_specific",
    severity: "minor",
    applicablePackageCategory: "paper sheets, tissues, similar sheet commodities",
    sourceDocument,
    sourceUrl,
    sourceSection: "Rule 16",
    version: "2011.1",
    evidenceRequirement: "Sheet-count declaration on package.",
    status: "active",
    engineEnabled: true,
  },
  {
    ruleId: "LM-PC-17",
    ruleNumber: 17,
    title: "Dimensions of container-type commodities",
    requirement: "Where a commodity is sold in a container of a specified size or dimensions (e.g., bags, boxes), the dimensions of the container/commodity shall be declared.",
    field: "dimensions",
    validatorType: "product_specific",
    severity: "minor",
    applicablePackageCategory: "container-type commodities",
    sourceDocument,
    sourceUrl,
    sourceSection: "Rule 17",
    version: "2011.1",
    evidenceRequirement: "Container dimension declaration.",
    status: "active",
    engineEnabled: true,
  },
  {
    ruleId: "LM-PC-18",
    ruleNumber: 18,
    title: "Wholesale / retail dealer and retail sale price requirements",
    requirement: "No wholesale dealer or retail dealer shall sell or expose for sale any commodity in packaged form at a price exceeding the retail sale price declared on the package, and retail sale price must include all taxes.",
    field: "mrp",
    validatorType: "mrp",
    severity: "critical",
    sourceDocument,
    sourceUrl,
    sourceSection: "Rule 18",
    version: "2011.1",
    evidenceRequirement: "Declared MRP vs observed selling price; alteration detection.",
    status: "active",
    engineEnabled: false,
  },
  {
    ruleId: "LM-PC-19",
    ruleNumber: 19,
    title: "Inspection of quantity and error",
    requirement: "Any legal metrology officer may inspect any package or pre-packed commodity to determine whether the quantity declared is correct, and the prescribed permissible error under Rule 19 applies.",
    field: "quantity_inspection",
    validatorType: "physical_verification",
    severity: "major",
    sourceDocument,
    sourceUrl,
    sourceSection: "Rule 19",
    version: "2011.1",
    evidenceRequirement: "Officer-entered or connected weighing measurement vs declared quantity.",
    status: "active",
    engineEnabled: true,
  },
  {
    ruleId: "LM-PC-20",
    ruleNumber: 20,
    title: "Action following inspection",
    requirement: "Where an inspection under Rule 19 discloses that the net quantity is less than the declared quantity beyond permissible error, the officer may take appropriate action under the Act including seizure.",
    field: "quantity_inspection",
    validatorType: "physical_verification",
    severity: "critical",
    sourceDocument,
    sourceUrl,
    sourceSection: "Rule 20",
    version: "2011.1",
    evidenceRequirement: "Measurement record with permissible error evaluated.",
    status: "active",
    engineEnabled: true,
  },
  {
    ruleId: "LM-PC-21",
    ruleNumber: 21,
    title: "Inspection at wholesale / retail premises",
    requirement: "Legal metrology officers may enter wholesale or retail premises to inspect packages and verify compliance with quantity declarations.",
    field: "quantity_inspection",
    validatorType: "physical_verification",
    severity: "major",
    sourceDocument,
    sourceUrl,
    sourceSection: "Rule 21",
    version: "2011.1",
    evidenceRequirement: "Premises inspection record.",
    status: "active",
    engineEnabled: false,
  },
  {
    ruleId: "LM-PC-24",
    ruleNumber: 24,
    title: "Wholesale package declarations",
    requirement: "Wholesale packages shall declare the name and address of the manufacturer/packer/importer, net quantity in standard units, and the date of manufacture/packing/import.",
    field: "wholesale",
    validatorType: "declaration_presence",
    severity: "major",
    applicablePackageCategory: "wholesale packages",
    sourceDocument,
    sourceUrl,
    sourceSection: "Rule 24",
    version: "2011.1",
    evidenceRequirement: "Wholesale package labels with required declarations.",
    status: "active",
    engineEnabled: true,
  },
  {
    ruleId: "LM-PC-10-COO",
    ruleNumber: 6,
    title: "Country of origin",
    requirement: "For imported products, the country of origin or manufacture must be declared on the package per Rule 6(1)(a)/(m) and Rule 6(10A) for e-commerce listings.",
    field: "country_of_origin",
    validatorType: "origin",
    severity: "major",
    sourceDocument,
    sourceUrl,
    sourceSection: "Rule 6(1)(a)/(m)",
    version: "2011.1",
    evidenceRequirement: "Country of origin declaration or domestic manufacture evidence.",
    status: "active",
    engineEnabled: true,
  },
];

export function legalDocumentForRule(rule: LegalRule): LegalDocument | undefined {
  return LEGAL_DOCUMENT_BY_ID[rule.sourceDocument];
}

export function legalRuleFor(ruleId: string): LegalRule | undefined {
  return LEGAL_RULE_REGISTRY.find((rule) => rule.ruleId === ruleId);
}

export function activeLegalRules(): LegalRule[] {
  return LEGAL_RULE_REGISTRY.filter((rule) => rule.status === "active");
}

export function executableLegalRules(): LegalRule[] {
  return LEGAL_RULE_REGISTRY.filter(
    (rule) => (rule.status === "active" || rule.status === "provisional") && rule.engineEnabled !== false,
  );
}

export function legalRuleBySection(section: string): LegalRule[] {
  return LEGAL_RULE_REGISTRY.filter((rule) => rule.sourceSection === section);
}

export const LEGAL_REGISTRY_STATUS = {
  sourceUrl: source?.officialSourceUrl,
  documents: LEGAL_DOCUMENTS.length,
  textIngestionRequired: true,
} as const;