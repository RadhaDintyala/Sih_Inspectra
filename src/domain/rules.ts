/**
 * Deterministic Legal Metrology (Packaged Commodities) Rules, 2011
 * Compliance Engine — v2.0
 *
 * Rules are data. The engine is code. They never mix.
 * OCR extracts. This engine decides.
 *
 * Rule result semantics:
 *   pass           = sufficient evidence supports compliance
 *   fail           = sufficient evidence supports non-compliance
 *   review         = evidence is insufficient or ambiguous
 *   not_applicable = rule does not apply to this product category
 *   not_evaluated  = cannot be evaluated without physical scale / external input
 */

import type { Declaration, ComplianceCheck, DeclarationField, PhysicalMeasurement, ValidationType } from "./inspection";
import { LEGAL_RULE_REGISTRY, legalDocumentForRule, legalRuleFor, type LegalRule } from "@/legal/registry";
import {
  hasTaxInclusiveDeclaration,
  hasMonthAndYear,
  hasAddressStructure,
  normalizeCountryOfOrigin,
} from "@/services/normalizer";

// ---------------------------------------------------------------------------
// Rule catalogue
// ---------------------------------------------------------------------------

export type RuleDefinition = {
  id: string;
  field: DeclarationField | "readability" | "placement" | "evidence" | "quantity_inspection" | "wholesale";
  label: string;
  reference: string;
  requirement: string;
  severity: "critical" | "major" | "minor";
  validationType: ValidationType;
};

export const RULES: RuleDefinition[] = LEGAL_RULE_REGISTRY.filter((rule) => rule.engineEnabled !== false).map((rule) => ({
  id: rule.ruleId,
  field: rule.field,
  label: rule.title,
  reference: rule.sourceSection,
  requirement: rule.requirement,
  severity: rule.severity,
  validationType: (rule.validatorType as ValidationType) ?? "declaration_presence",
}));

// ---------------------------------------------------------------------------
// Quantity parsing — handles "100 g + 12.7 g EXTRA", "112.7 g", "500 ml"
// ---------------------------------------------------------------------------

export type ParsedQuantity = {
  totalValue: number | null;
  baseValue: number | null;
  extraValue: number | null;
  unit: string | null;
  raw: string;
};

const QUANTITY_UNITS = new Set(["g", "gm", "gms", "gram", "grams", "kg", "kgs", "ml", "mll", "l", "ltr", "ltrs", "litre", "liters", "cl", "pcs", "pc", "piece", "pieces", "no", "nos", "numbers", "units", "unit", "pack", "packs"]);

export function parseNetQuantity(raw: string): ParsedQuantity {
  const cleaned = (raw ?? "").replace(/\s+/g, " ").trim();
  if (!cleaned) return { totalValue: null, baseValue: null, extraValue: null, unit: null, raw: cleaned };

  // Standardize unit tokens
  const unitMap: Record<string, string> = {
    g: "g", gm: "g", gms: "g", gram: "g", grams: "g",
    kg: "kg", kgs: "kg",
    ml: "ml", mll: "ml",
    l: "l", ltr: "l", ltrs: "l", litre: "l", liters: "l",
    cl: "cl",
    pcs: "pcs", pc: "pcs", piece: "pcs", pieces: "pcs",
    no: "pcs", nos: "pcs", numbers: "pcs", units: "pcs", unit: "pcs",
    pack: "pcs", packs: "pcs",
  };

  // Pattern 1: "N unit + M unit EXTRA" / "N unit + M unit FREE"
  const extraPattern = /(\d+(?:\.\d+)?)\s*(g|gm|gms|grams?|kg|ml|l|ltrs?|litres?)\s*\+\s*(\d+(?:\.\d+)?)\s*(g|gm|gms|grams?|kg|ml|l|ltrs?|litres?)\s*(?:EXTRA|FREE|additional)?/i;
  const extraMatch = cleaned.match(extraPattern);
  if (extraMatch) {
    const baseValue = parseFloat(extraMatch[1]);
    const extraValue = parseFloat(extraMatch[3]);
    const unit = unitMap[extraMatch[2].toLowerCase()] ?? extraMatch[2].toLowerCase();
    const totalValue = baseValue + extraValue;
    return { totalValue, baseValue, extraValue, unit, raw: cleaned };
  }

  // Pattern 2: "N unit" (with EXTRA on a separate line handled by pipeline)
  const simpleMatch = cleaned.match(/(\d+(?:\.\d+)?)\s*(g|gm|gms|grams?|kg|kgs|ml|l|ltrs?|litres?|cl|pcs?|pieces?|nos?|numbers?|units?|packs?)\b/i);
  if (simpleMatch) {
    const value = parseFloat(simpleMatch[1]);
    const unit = unitMap[simpleMatch[2].toLowerCase()] ?? simpleMatch[2].toLowerCase();
    return { totalValue: value, baseValue: value, extraValue: null, unit, raw: cleaned };
  }

  return { totalValue: null, baseValue: null, extraValue: null, unit: null, raw: cleaned };
}

// ---------------------------------------------------------------------------
// Physical-quantity verification — officer-entered / connected weighing
// ---------------------------------------------------------------------------

/** Permissible error (Rule 19) thresholds expressed as fraction of declared quantity. */
export function permissibleErrorFraction(unit: string | null): number {
  // General rule: 2% for most commodities (Rule 19 / Schedule)
  // More conservative for volume/weight
  return 0.02;
}

export function evaluatePhysicalQuantity(
  declaredRaw: string,
  measuredValue: number,
  measuredUnit: string,
): {
  status: ComplianceCheck["status"];
  deviationPct: number;
  withinTolerance: boolean;
  reason: string;
} {
  const parsed = parseNetQuantity(declaredRaw);
  if (parsed.totalValue === null || parsed.unit === null) {
    return {
      status: "review",
      deviationPct: 0,
      withinTolerance: false,
      reason: "Declared quantity could not be parsed for comparison.",
    };
  }

  // Unit compatibility check
  const massUnits = ["g", "kg"];
  const volumeUnits = ["ml", "l", "cl"];
  const countUnits = ["pcs"];
  const declaredUnit = parsed.unit.toLowerCase();
  const measuredUnitNorm = measuredUnit.toLowerCase();

  const compatible =
    (massUnits.includes(declaredUnit) && massUnits.includes(measuredUnitNorm)) ||
    (volumeUnits.includes(declaredUnit) && volumeUnits.includes(measuredUnitNorm)) ||
    (countUnits.includes(declaredUnit) && countUnits.includes(measuredUnitNorm));

  if (!compatible) {
    return {
      status: "review",
      deviationPct: 0,
      withinTolerance: false,
      reason: `Units incompatible for comparison: declared "${parsed.unit}" vs measured "${measuredUnit}".`,
    };
  }

  // Convert to base units
  const toGram = (v: number, u: string) => u === "kg" ? v * 1000 : v;
  const toMl = (v: number, u: string) => u === "l" ? v * 1000 : u === "cl" ? v * 10 : v;
  let declaredBase = parsed.totalValue;
  let measuredBase = measuredValue;
  if (massUnits.includes(declaredUnit)) {
    declaredBase = toGram(parsed.totalValue, declaredUnit);
    measuredBase = toGram(measuredValue, measuredUnitNorm);
  } else if (volumeUnits.includes(declaredUnit)) {
    declaredBase = toMl(parsed.totalValue, declaredUnit);
    measuredBase = toMl(measuredValue, measuredUnitNorm);
  } else {
    measuredBase = measuredValue;
  }

  if (declaredBase === 0) {
    return { status: "review", deviationPct: 0, withinTolerance: false, reason: "Declared quantity is zero — cannot verify." };
  }

  const deviationPct = ((measuredBase - declaredBase) / declaredBase) * 100;
  const tolerance = permissibleErrorFraction(parsed.unit) * 100;
  const withinTolerance = Math.abs(deviationPct) <= tolerance;

  const status: ComplianceCheck["status"] = withinTolerance ? "pass" : "fail";
  return {
    status,
    deviationPct: Math.round(deviationPct * 100) / 100,
    withinTolerance,
    reason: withinTolerance
      ? `Measured ${measuredValue} ${measuredUnit} is within the permissible error of ±${tolerance}% of declared ${parsed.totalValue} ${parsed.unit}.`
      : `Measured ${measuredValue} ${measuredUnit} deviates ${Math.abs(Math.round(deviationPct * 100) / 100)}% from declared ${parsed.totalValue} ${parsed.unit}, exceeding the permissible error of ±${tolerance}%. Rule 18(19) violation.`,
  };
}

// ---------------------------------------------------------------------------
// Field validators
// ---------------------------------------------------------------------------

/** MRP: must contain a recognizable Indian currency marker + positive number. */
function validateMRP(value: string): { ok: boolean; reason?: string } {
  if (!value.trim()) return { ok: false, reason: "No MRP declaration found." };

  const hasCurrency = /₹|rs\.?|inr/i.test(value);
  const hasAmount = /\d+/.test(value);

  if (!hasCurrency) {
    return {
      ok: false,
      reason: "MRP is present but lacks a recognizable Indian currency marker (₹ / Rs / INR). Required by Rule 6(1)(e).",
    };
  }
  if (!hasAmount) {
    return { ok: false, reason: "MRP currency marker found but no numeric amount detected." };
  }

  const num = parseFloat(value.replace(/[^\d.]/g, ""));
  if (isNaN(num) || num <= 0) {
    return { ok: false, reason: `MRP amount (${value}) resolves to zero or negative — not a valid retail price.` };
  }

  return { ok: true };
}

/**
 * MRP tax-inclusive: Rule 6(1)(e) requires "INCLUSIVE OF ALL TAXES" wording near
 * the retail sale price. Assessed through the raw OCR evidence text where available.
 */
function validateMRPTaxInclusive(declaration: Declaration | undefined): { ok: boolean; reason?: string } {
  const raw = declaration?.evidence?.rawText ?? declaration?.rawValue ?? declaration?.value ?? "";
  if (hasTaxInclusiveDeclaration(raw)) return { ok: true };
  return {
    ok: false,
    reason: "The phrase 'inclusive of all taxes' must accompany the maximum retail price (Rule 6(1)(e)).",
  };
}

/** Net quantity: must contain a number + a recognized unit. */
function validateNetQuantity(value: string): { ok: boolean; reason?: string } {
  if (!value.trim()) return { ok: false, reason: "No net quantity declaration found." };

  const parsed = parseNetQuantity(value);
  if (parsed.totalValue === null || !parsed.unit) {
    return {
      ok: false,
      reason: `Net quantity "${value}" does not include a recognizable SI/metric unit (g, kg, ml, l, pcs). Required by Rule 6(1)(b).`,
    };
  }
  const allowedUnits = /^(?:g|kg|ml|l|cl|pcs|tabs|caps)$/;
  if (!allowedUnits.test(parsed.unit)) {
    return {
      ok: false,
      reason: `Net quantity unit "${parsed.unit}" is not an approved SI/metric unit under the National Standards Rules.`,
    };
  }
  return { ok: true };
}

/** Date: must contain at least a month/year or year pattern. */
function validateDate(value: string): { ok: boolean; reason?: string } {
  if (!value.trim()) return { ok: false, reason: "No date declaration found." };

  const hasYear = /20\d{2}/.test(value);
  if (!hasYear) {
    return { ok: false, reason: `Date "${value}" does not contain a recognizable year. Month and year of manufacture/packing are required by Rule 6(1)(d).` };
  }
  return { ok: true };
}

/** Manufacturer: must be non-empty and look substantive (> 8 chars) with address structure. */
function validateManufacturer(value: string, declaration?: Declaration): { ok: boolean; reason?: string } {
  if (!value.trim()) {
    return { ok: false, reason: "Name and complete address of the manufacturer/packer/importer could not be found. Required by Rule 6(1)(a)." };
  }
  if (value.trim().length < 8) {
    return { ok: false, reason: `Manufacturer declaration "${value}" is too short to be a complete name and address. Rule 6(1)(a) requires full details.` };
  }

  // Rule 10 requires name + complete address structure
  const address = hasAddressStructure(value);
  if (!address.ok) {
    const missing: string[] = [];
    if (!address.hasPin) missing.push("PIN code");
    if (!address.hasStateOrCity) missing.push("city/state");
    if (!address.hasEntity) missing.push("corporate entity marker");
    if (!address.hasAddressKeyword) missing.push("address keyword");
    if (!address.isMultiPart) missing.push("multi-part address structure");
    return {
      ok: false,
      reason: `Manufacturer declaration lacks a complete postal address (missing: ${missing.join(", ")}). Rule 6(1)(a)/Rule 10 requires name and complete address.`,
    };
  }
  return { ok: true };
}

/** Product name: must be non-empty. */
function validateProductName(value: string): { ok: boolean; reason?: string } {
  if (!value.trim()) {
    return { ok: false, reason: "Product name or commodity description could not be found." };
  }
  if (value.trim().length < 3) {
    return { ok: false, reason: "Product name is too short to be a valid commodity description." };
  }
  return { ok: true };
}

/** Consumer care: must be non-empty and contain a verifiable contact. */
function validateConsumerCare(value: string): { ok: boolean; reason?: string } {
  if (!value.trim()) {
    return { ok: false, reason: "Consumer care contact details could not be found. Required by Rule 6(1)(f)." };
  }
  const hasPhone = /\b(?:1800|1860|1[3-9]\d{8}|\+91[-\s]?\d{10}|\d{10,12})\b/.test(value) || /\b\d{3,5}[-\s]?\d{6,8}\b/.test(value);
  const hasEmail = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(value);
  const hasCareCell = /consumer\s*care|customer\s*care|care\s*cell|helpline|toll\s*free/i.test(value) && value.trim().length >= 15;
  if (!hasPhone && !hasEmail && !hasCareCell) {
    return { ok: false, reason: "Consumer care declaration does not contain a verifiable contact (phone, email, or care-cell address). Rule 6(1)(f)." };
  }
  return { ok: true };
}

/** Country of origin: for imported products must be declared. */
function validateCountryOfOrigin(value: string | null | undefined): { ok: boolean; reason?: string } {
  if (!value || !value.trim()) {
    return { ok: false, reason: "Country of origin not declared. Required for imported goods; if domestically manufactured this may be inferred from manufacturer address, but a clear declaration is preferable." };
  }
  const known = normalizeCountryOfOrigin(value);
  if (!known) {
    return { ok: false, reason: `Country of origin declaration "${value}" is not a recognizable country.` };
  }
  return { ok: true };
}

/** Unit sale price must be ₹ per standard unit. */
function validateUnitSalePrice(value: string): { ok: boolean; reason?: string } {
  if (!value.trim()) {
    return { ok: true, reason: "Unit sale price not mandatory for packages below threshold; evaluated as supplementary." };
  }
  const pattern = /(?:₹|rs\.?|inr)?\s*\d+(?:\.\d{1,3})?\s*\/\s*(?:g|gm|kg|ml|l|pcs?|piece|unit)\b/i;
  if (!pattern.test(value)) {
    return { ok: false, reason: "Unit sale price must be expressed as an amount per standard unit (₹ per g/kg/ml/l/piece)." };
  }
  return { ok: true };
}

/** Dimensions declaration. */
function validateDimensions(value: string | null | undefined): { ok: boolean; reason?: string } {
  if (!value || !value.trim()) {
    return { ok: false, reason: "Dimensions declaration required for dimensioned commodities (paper, textile, plastic film)." };
  }
  const pattern = /\d+(?:\.\d+)?\s*(?:cm|mm|m|inch|in|ft|feet)?\s*[x×]\s*\d+(?:\.\d+)?(?:\s*[x×]\s*\d+(?:\.\d+)?)?/i;
  if (!pattern.test(value)) {
    return { ok: false, reason: `Dimensions "${value}" is not in L×W (×H) format.` };
  }
  return { ok: true };
}

/** Best-before / use-by date. */
function validateBestBefore(value: string | null | undefined): { ok: boolean; reason?: string } {
  if (!value || !value.trim()) {
    return { ok: false, reason: "Best-before / use-by date not declared." };
  }
  return validateDate(value);
}

// ---------------------------------------------------------------------------
// Conflicting declarations detection
// ---------------------------------------------------------------------------

export function detectConflictingDeclarations(
  declarations: Declaration[],
  field: DeclarationField,
): { conflict: boolean; candidates: string[] } {
  const matches = declarations.filter(
    (d) => d.field === field && d.status !== "NOT_DETECTED" && d.value && d.value.trim().length > 0,
  );
  if (matches.length <= 1) return { conflict: false, candidates: matches.map((m) => m.value ?? "") };
  const distinct = new Set(matches.map((m) => m.value?.trim().toLowerCase()));
  return { conflict: distinct.size > 1, candidates: [...new Set(matches.map((m) => m.value ?? ""))] };
}

// ---------------------------------------------------------------------------
// Dimension / font-size helpers
// ---------------------------------------------------------------------------

/**
 * Estimate character height in pixels from a text-region bounding box:
 * the box height approximates capital-letter height when the region is a
 * single OCR line. Physical conversion requires a pixels-per-mm calibration.
 */
export function estimateCharacterHeightPx(bbox: { height: number } | undefined): number | null {
  if (!bbox || typeof bbox.height !== "number" || bbox.height <= 0) return null;
  return bbox.height;
}

/**
 * Font-size / character-height validation (Rule 7(3)).
 *
 * Returns:
 *   PASS                — calibrated physical height ≥ statutory minimum
 *   FAIL                — calibrated physical height < statutory minimum
 *   NOT EVALUATED — PHYSICAL SCALE REQUIRED  — no calibration available,
 *                       never a heuristic legal PASS.
 */
export function evaluateCharacterHeight(args: {
  bboxHeightPct: number | null;
  packageHeightPx: number | null;
  fontSizePx?: number | null;
  physicalScale?: { pixelsPerMm: number; scaleReference: string } | null;
  packageType: "LARGE" | "SMALL";
  declarationKind: "NUMERALS" | "LETTERS";
}): { status: ComplianceCheck["status"]; reason: string; calculatedHeightMm?: number; requiredMm?: number } {
  const requiredMm =
    args.packageType === "LARGE"
      ? args.declarationKind === "NUMERALS" ? 4 : 3
      : args.declarationKind === "NUMERALS" ? 3 : 1.5;

  // Physical scale present → real measurement
  if (args.physicalScale?.pixelsPerMm && args.physicalScale.pixelsPerMm > 0 && args.fontSizePx != null) {
    const heightMm = args.fontSizePx / args.physicalScale.pixelsPerMm;
    if (heightMm >= requiredMm) {
      return {
        status: "pass",
        reason: `Measured character height ${heightMm.toFixed(2)} mm (≥ required ${requiredMm} mm for ${args.declarationKind.toLowerCase()} on a ${args.packageType.toLowerCase()} package).`,
        calculatedHeightMm: heightMm,
        requiredMm,
      };
    }
    return {
      status: "fail",
      reason: `Measured character height ${heightMm.toFixed(2)} mm is below the statutory minimum ${requiredMm} mm for ${args.declarationKind.toLowerCase()} on a ${args.packageType.toLowerCase()} package (Rule 7(3)).`,
      calculatedHeightMm: heightMm,
      requiredMm,
    };
  }

  // No physical scale → NOT EVALUATED, never heuristic PASS
  return {
    status: "not_evaluated",
    reason: "NOT EVALUATED — PHYSICAL SCALE REQUIRED. Character height cannot be determined from image geometry alone. Provide a calibrated physical scale reference (pixels-per-mm) or measure the label directly.",
    requiredMm,
  };
}

// ---------------------------------------------------------------------------
// Confidence → status mapping
// ---------------------------------------------------------------------------

function applyConfidenceGate(
  proposedStatus: ComplianceCheck["status"],
  confidence: number,
  threshold = 0.40,
): ComplianceCheck["status"] {
  if (proposedStatus === "fail" && confidence < threshold) return "review";
  return proposedStatus;
}

// ---------------------------------------------------------------------------
// Main engine entry point
// ---------------------------------------------------------------------------

function declarationFor(declarations: Declaration[], field: DeclarationField) {
  return declarations.find((d) => d.field === field);
}

export type ComplianceContext = {
  packageCategory?: string;
  extractionSource?: string;
  packageType?: "LARGE" | "SMALL";
  physicalScale?: { pixelsPerMm: number; scaleReference: string } | null;
  measuredQuantities?: PhysicalMeasurement[];
  observedSalePrice?: number;
  ecommerceListing?: boolean;
};

export function evaluateCompliance(
  declarations: Declaration[],
  imageId: string,
  context: ComplianceContext = {},
): ComplianceCheck[] {
  const registryRules = LEGAL_RULE_REGISTRY.filter((rule) => rule.engineEnabled !== false);

  return registryRules.map((registryRule): ComplianceCheck => {
    const rule: RuleDefinition = {
      id: registryRule.ruleId,
      field: registryRule.field,
      label: registryRule.title,
      reference: registryRule.sourceSection,
      requirement: registryRule.requirement,
      severity: registryRule.severity,
      validationType: (registryRule.validatorType as ValidationType) ?? "declaration_presence",
    };
    return evaluateSingleRule(rule, registryRule, declarations, imageId, context);
  });
}

function evaluateSingleRule(
  rule: RuleDefinition,
  registryRule: LegalRule,
  declarations: Declaration[],
  imageId: string,
  context: ComplianceContext,
): ComplianceCheck {
  const sourceDocument = legalDocumentForRule(registryRule);
  const evidenceImageId = (field: DeclarationField) => declarationFor(declarations, field)?.evidenceImageId ?? imageId;
  const boundingBoxFor = (field: DeclarationField) => declarationFor(declarations, field)?.boundingBox;

  const baseEvidence = <T extends Record<string, unknown>>(extra: T) => ({
    ruleId: rule.id,
    field: rule.field,
    severity: rule.severity,
    sourceDocument: sourceDocument?.documentId,
    sourceUrl: registryRule.sourceUrl,
    sourceSection: registryRule.sourceSection,
    validationType: rule.validationType,
    ...extra,
  });

  if (context.packageCategory === "unsupported") {
    return {
      ...baseEvidence({
        status: "not_applicable",
        evidence: "Package category is outside the configured inspection scope.",
        explanation: "The current registry does not establish that this package category is governed by the selected Packaged Commodities rule set.",
        confidence: 1,
        evidenceImageId: imageId,
      }),
    };
  }

  // ── Applicability gating by package category ──────────────────────────
  const category = context.packageCategory ?? "";
  const categoryLower = category.toLowerCase();
  const applicableCategory = registryRule.applicablePackageCategory ?? "";
  if (applicableCategory && category) {
    const applies = applicableCategory.split(",").some((a) => category.toLowerCase().includes(a.trim().toLowerCase()));
    if (!applies) {
      return {
        ...baseEvidence({
          status: "not_applicable",
          evidence: "Rule does not apply to this package category.",
          explanation: `${rule.label} applies to: ${applicableCategory}. Current package category: ${category || "unspecified"}.`,
          confidence: 1,
          evidenceImageId: imageId,
        }),
      };
    }
  }

  // ── Physical quantity verification (Rules 19/20) ──────────────────────
  if (rule.field === "quantity_inspection" && rule.validationType === "physical_verification") {
    const measurement = context.measuredQuantities?.[0];
    if (!measurement) {
      return {
        ...baseEvidence({
          status: "not_evaluated",
          evidence: "No physical measurement entered.",
          explanation: "NOT EVALUATED — PHYSICAL MEASUREMENT REQUIRED. Enter a weighing scale reading to apply Rule 19 permissible-error inspection.",
          confidence: null,
          evidenceImageId: imageId,
        }),
      };
    }
    const measuredValue = parseFloat(measurement.measuredValue ?? "");
    if (isNaN(measuredValue)) {
      return {
        ...baseEvidence({
          status: "not_evaluated",
          evidence: "Physical measurement value unavailable.",
          explanation: "NOT EVALUATED — PHYSICAL MEASUREMENT REQUIRED. The measured value is not numeric.",
          confidence: null,
          evidenceImageId: imageId,
        }),
      };
    }
    const result = evaluatePhysicalQuantity(measurement.declaredValue, measuredValue, measurement.unit);
    return {
      ...baseEvidence({
        status: result.status,
        evidence: `Declared ${measurement.declaredValue} | Measured ${measurement.measuredValue} ${measurement.unit} | Deviation ${result.deviationPct}% | Permissible error ±2%`,
        explanation: result.reason,
        confidence: 0.98,
        evidenceImageId: evidenceImageId("net_quantity"),
      }),
    };
  }

  // ── Character-height validation (Rule 7) ──────────────────────────────
  if (rule.validationType === "character_height") {
    const bbox = boundingBoxFor("net_quantity") ?? declarationFor(declarations, "mrp")?.boundingBox;
    const heightPct = bbox?.height ?? null;
    const fontPx = heightPct != null ? (context.physicalScale?.pixelsPerMm ? heightPct : null) : null;
    const packageType = context.packageType ?? "SMALL";
    const result = evaluateCharacterHeight({
      bboxHeightPct: heightPct,
      packageHeightPx: null,
      fontSizePx: fontPx,
      physicalScale: context.physicalScale ?? null,
      packageType,
      declarationKind: "NUMERALS",
    });
    return {
      ...baseEvidence({
        status: result.status,
        evidence: result.status === "not_evaluated"
          ? "NOT EVALUATED — PHYSICAL SCALE REQUIRED"
          : `Character height ${result.calculatedHeightMm?.toFixed(2)} mm (required ≥ ${result.requiredMm} mm)`,
        explanation: result.reason,
        confidence: result.status === "pass" ? 0.95 : result.status === "fail" ? 0.9 : 0.5,
        evidenceImageId: evidenceImageId("net_quantity"),
      }),
    };
  }

  // ── Readability / visibility (Rules 4/8/9) through declaration regions ──
  if (rule.validationType === "readability") {
    const mandatory = ["product_name", "mrp", "net_quantity"] as const;
    const withRegions = declarations.filter((d) => mandatory.includes(d.field as (typeof mandatory)[number]) && d.boundingBox);
    const extractableMandatory = declarations.filter((d) => mandatory.includes(d.field as (typeof mandatory)[number]));

    // No region geometry → legibility cannot be assessed; never a heuristic pass.
    if (extractableMandatory.length > 0 && withRegions.length === 0) {
      return {
        ...baseEvidence({
          status: "review",
          evidence: "READABILITY_NO_REGION_DATA",
          explanation: "OCR text was extracted but declaration regions lack bounding-box geometry. Readability cannot be fully assessed. This is an uncalibrated visual proxy requiring manual review.",
          confidence: 0.5,
          evidenceImageId: imageId,
        }),
      };
    }

    // Proportionally tiny mandatory text regions → likely not legible per
    // Rule 9. Only flags text regions, never character-height compliance.
    const MANDATORY_HEIGHT_PCT_THRESHOLD = 2.5;
    const tiny = withRegions.find((d) => (d.boundingBox?.height ?? 0) < MANDATORY_HEIGHT_PCT_THRESHOLD);
    if (tiny) {
      return {
        ...baseEvidence({
          status: "review",
          evidence: `READABILITY_REGION_PROPORTIONALLY_TINY (${tiny.field}: ${tiny.boundingBox?.height}% frame height < ${MANDATORY_HEIGHT_PCT_THRESHOLD}%)`,
          explanation: "HEURISTIC READABILITY PROXY — one or more mandatory declaration regions are proportionally tiny relative to the frame and may be illegible. Uncalibrated proxy; verify legibility manually.",
          confidence: 0.4,
          evidenceImageId: tiny.evidenceImageId ?? imageId,
          boundingBox: tiny.boundingBox,
          polygon: tiny.polygon,
        }),
      };
    }

    // OCR extraction confidence is a secondary legibility signal.
    const confidences = declarations.filter((d) => d.confidence != null).map((d) => d.confidence as number);
    const avgConfidence = confidences.length ? confidences.reduce((a, b) => a + b, 0) / confidences.length : null;
    if (avgConfidence != null && avgConfidence < 0.6) {
      return {
        ...baseEvidence({
          status: "review",
          evidence: `OCR confidence (avg ${Math.round(avgConfidence * 100)}%) below legibility threshold.`,
          explanation: "OCR extraction confidence is low, which may indicate obscured, distorted, or faint declarations — or a hard-to-read surface.",
          confidence: avgConfidence,
          evidenceImageId: imageId,
        }),
      };
    }

    return {
      ...baseEvidence({
        status: withRegions.length > 0 ? "pass" : "review",
        evidence: withRegions.length > 0
          ? `Mandatory declaration regions (${withRegions.length}) meet readability heuristics.`
          : "No mandatory declaration regions available for legibility assessment.",
        explanation: withRegions.length > 0
          ? "uncalibrated visual proxy — declaration text regions are proportionally sized and OCR-confident, indicating a legible label. OCR confidence and region geometry combine as a legibility proxy only; it is not a physical character-height measurement."
          : "Legibility proxy inconclusive without region geometry.",
        confidence: avgConfidence ?? 0.6,
        evidenceImageId: imageId,
      }),
    };
  }

  // ── Package / label evidence presence (Rule 4(1)) ──────────────────────
  if (rule.field === "evidence" && rule.validationType === "presence") {
    const anyDeclared = declarations.some((d) => d.status === "DETECTED" || d.status === "VERIFIED");
    if (anyDeclared) {
      return {
        ...baseEvidence({
          status: "pass",
          evidence: `${declarations.filter((d) => d.status === "DETECTED" || d.status === "VERIFIED").length} declaration(s) read from label evidence.`,
          explanation: "A package label with statutory declarations is present in the evidence, satisfying the Rule 4 package-and-label form requirement for this analysis.",
          confidence: 0.95,
          evidenceImageId: imageId,
        }),
      };
    }
    return {
      ...baseEvidence({
        status: "review",
        evidence: "No declaration evidence readable from the frame.",
        explanation: "No readable label declarations were extracted, so conformity of the package label form cannot be confirmed. Verify that a valid pre-packed commodity label was photographed.",
        confidence: 0.4,
        evidenceImageId: imageId,
      }),
    };
  }

  // ── Placement (Rule 8) — principal display panel position ─────────────
  if (rule.validationType === "placement") {
    const mandatory = declarations.filter((d) => ["mrp", "net_quantity", "manufacturer"].includes(d.field) && d.boundingBox);
    if (mandatory.length === 0) {
      return {
        ...baseEvidence({
          status: "review",
          evidence: "No declaration bounding boxes available for placement assessment.",
          explanation: "Bounding-box geometry is required to assess placement of declarations. Without region coordinates, placement on the principal display panel cannot be confirmed.",
          confidence: 0.4,
          evidenceImageId: imageId,
        }),
      };
    }
    const offPanel = mandatory.filter((d) => (d.boundingBox?.x ?? 0) < 2 || (d.boundingBox?.x ?? 0) > 98 || (d.boundingBox?.y ?? 0) > 97);
    if (offPanel.length > 0) {
      return {
        ...baseEvidence({
          status: "review",
          evidence: `${offPanel.length} mandatory declaration(s) located at the edge of the frame — possible outside principal display panel.`,
          explanation: "One or more statutory declarations may be positioned outside the principal display panel area. Verify placement manually (Rule 8 / Rule 7).",
          confidence: 0.5,
          evidenceImageId: evidenceImageId(offPanel[0].field as DeclarationField),
        }),
      };
    }
    return {
      ...baseEvidence({
        status: "pass",
        evidence: "Mandatory declaration regions are positioned within the package principal display panel bounds.",
        explanation: "Declared text regions fall within the primary package display area and are not clipped at frame edges.",
        confidence: 0.85,
        evidenceImageId: evidenceImageId("mrp"),
      }),
    };
  }

  // ── Principal display panel (Rule 7) ──────────────────────────────────
  if (rule.validationType === "principal_display_panel") {
    const productName = declarationFor(declarations, "product_name");
    const mrp = declarationFor(declarations, "mrp");
    if (productName?.boundingBox && mrp?.boundingBox) {
      return {
        ...baseEvidence({
          status: "pass",
          evidence: "Product name and retail price both present on the principal display panel.",
          explanation: "Both the commodity name and retail sale price are detected on what is assessed as the principal display panel.",
          confidence: 0.8,
          evidenceImageId: productName.evidenceImageId ?? imageId,
        }),
      };
    }
    return {
      ...baseEvidence({
        status: "review",
        evidence: "Principal display panel presence uncertain.",
        explanation: "Cannot confirm the product name and MRP are both on the principal display panel. Review visual evidence.",
        confidence: 0.5,
        evidenceImageId: imageId,
      }),
    };
  }

  // ── Conflicting declarations (validation type 18) ─────────────────────
  if (rule.validationType === "conflict_detection" || rule.validationType === "conflicting_declarations") {
    const conflicted = declarations.find((d) => d.conflict || d.status === "CONFLICT");
    if (conflicted) {
      return {
        ...baseEvidence({
          status: "review",
          evidence: conflicted.value ?? "Conflicting values",
          explanation: "Conflicting declarations were extracted from multiple package images. Both values are retained for officer review.",
          confidence: conflicted.confidence,
          evidenceImageId: conflicted.evidenceImageId ?? imageId,
          boundingBox: conflicted.boundingBox,
          polygon: conflicted.polygon,
        }),
      };
    }
    return {
      ...baseEvidence({
        status: "pass",
        evidence: "No conflicting declaration values detected.",
        explanation: "Cross-image declaration comparison found consistent values across photographs.",
        confidence: 0.9,
        evidenceImageId: imageId,
      }),
    };
  }

  // ── Misleading declarations (validation type 19) ──────────────────────
  if (rule.validationType === "misleading" || rule.validationType === "misleading_declarations") {
    const misleading = detectMisleading(declarations);
    return {
      ...baseEvidence({
        status: misleading.status,
        evidence: misleading.evidence ?? "No misleading declaration signals detected.",
        explanation: misleading.reason,
        confidence: misleading.confidence,
        evidenceImageId: imageId,
      }),
    };
  }

  // ── E-commerce listing COO (Rule 6(10A)) ───────────────────────────
  // Only applies when the inspection is in e-commerce mode where the listing
  // is the primary evidence source; physical-label COO is covered by
  // LM-PC-10-COO using the same declaration.
  if (rule.id === "LM-PC-09" && !context.ecommerceListing) {
    return {
      ...baseEvidence({
        status: "not_applicable",
        evidence: "Inspection is not an e-commerce listing review.",
        explanation: "NOT EVALUATED — RULE NOT APPLICABLE. Rule 6(10A) governs e-commerce listings; this is a physical package inspection.",
        confidence: null,
        evidenceImageId: imageId,
      }),
    };
  }

  // ── Wholesale package (Rule 24) ────────────────────────────────────────
  if (rule.id === "LM-PC-24") {
    const wholesaleScope = categoryLower.includes("wholesale") || categoryLower.includes("bulk") || categoryLower.includes("ancillary");
    if (!wholesaleScope) {
      return {
        ...baseEvidence({
          status: "not_applicable",
          evidence: "Package category does not identify a wholesale/ancillary sale.",
          explanation: "NOT EVALUATED — RULE NOT APPLICABLE. Rule 24 governs wholesale packages; this inspection was not categorized as wholesale. Wholesale-compliant comparisons are intentionally skipped.",
          confidence: null,
          evidenceImageId: imageId,
        }),
      };
    }
    const required: DeclarationField[] = ["manufacturer", "net_quantity", "date"];
    const missing = required.filter((f) => {
      const d = declarationFor(declarations, f);
      return !d || d.status !== "DETECTED" || !d.value;
    });
    if (missing.length === 0) {
      return {
        ...baseEvidence({
          status: "pass",
          evidence: "Manufacturer, net quantity, and date all declared on wholesale package.",
          explanation: "All Rule 24 wholesale package declarations are present.",
          confidence: 0.9,
          evidenceImageId: imageId,
        }),
      };
    }
    return {
      ...baseEvidence({
        status: "fail",
        evidence: `Missing declarations: ${missing.join(", ")}`,
        explanation: `Rule 24 requires wholesale packages to declare manufacturer details, net quantity, and date of manufacture/packing/import. Missing: ${missing.join(", ")}.`,
        confidence: 0.8,
        evidenceImageId: imageId,
      }),
    };
  }

  // ── Universal field validators ─────────────────────────────────────────
  const field = rule.field;
  if (field === "readability" || field === "placement" || field === "evidence" || field === "quantity_inspection" || field === "wholesale") {
    // Handled by dedicated branches above.
    return {
      ...baseEvidence({
        status: "not_applicable",
        evidence: "Rule not directly field-mapped.",
        explanation: "This rule was not applied because it depends on a dedicated domain check which was not triggered.",
        confidence: 1,
        evidenceImageId: imageId,
      }),
    };
  }

  const declaration = declarationFor(declarations, field as DeclarationField);
  const value = declaration?.value?.trim() ?? "";
  const confidence = declaration?.confidence ?? null;

  // ── Applicability: optional / "where applicable" declarations ─────────
  // Rules whose operator scope is a commodity category or a package size
  // (e.g. dimensions for textiles/papers, sheets, unit-sale-price above
  // 250 g/l) are NOT statutory fails when the field is absent on an
  // unrelated package. Emit not_applicable instead of a fabricated fail.
  const scopeRule = registryRule.applicablePackageCategory;
  const scopeUnconfirmed = Boolean(scopeRule) && !categoryLower;
  const scopeMismatch = scopeRule && categoryLower && !scopeRule.split(",").some((s) => categoryLower.includes(s.trim().toLowerCase()));
  const categoryAgreed = scopeRule ? Boolean(categoryLower) : false;
  const optionalScope = Boolean(!scopeRule && ["best_before", "unit_sale_price", "dimensions", "batch_number"].includes(field));
  const fieldMissing = !declaration || declaration.status === "NOT_DETECTED" || !value;

  // Package category not supplied → commodity-scope rules cannot confirm they
  // apply; report NOT APPLICABLE rather than demanding a scope-typical field.
  if (scopeUnconfirmed) {
    return {
      ...baseEvidence({
        status: "not_applicable",
        evidence: `Package commodity scope unconfirmed (${(scopeRule ?? "").replace(",", " / ")}).`,
        explanation: "NOT EVALUATED — RULE NOT APPLICABLE. No package category was supplied, so the system cannot confirm this commodity-scope declaration requirement applies. Supply the package category to activate the rule.",
        confidence: null,
        evidenceImageId: imageId,
      }),
    };
  }

  if (fieldMissing) {
    if (scopeRule && categoryAgreed && !scopeMismatch) {
      // Category matches but field missing → the requirement genuinely applies.
      return {
        ...baseEvidence({
          status: "review",
          evidence: `${field} not declared for an applicable package category (${scopeRule.replace(",", " / ")}).`,
          explanation: `Rule ${registryRule.ruleNumber} applies to this package category but the declaration was not extracted. Manual verification required.`,
          confidence: null,
          evidenceImageId: imageId,
        }),
      };
    }
    if (scopeMismatch || optionalScope) {
      return {
        ...baseEvidence({
          status: "not_applicable",
          evidence: `Declaration field "${field}" not applicable to the assessed package scope.`,
          explanation: "NOT EVALUATED — RULE NOT APPLICABLE. The assessed commodity scope does not establish that this optional declaration is required for this package.",
          confidence: null,
          evidenceImageId: imageId,
        }),
      };
    }
  }

  // Unit-sale-price scale gate (Rule 6(1) — only required above 250 g/l).
  if (field === "unit_sale_price" && !declaration?.value) {
    const nqty = declarationFor(declarations, "net_quantity")?.value ?? "";
    const parsedNqty = parseNetQuantity(nqty);
    if (parsedNqty.totalValue !== null && parsedNqty.totalValue > 250) {
      return {
        ...baseEvidence({
          status: "review",
          evidence: `Package net quantity ${nqty} exceeds 250 g/l — unit sale price declaration required but not extracted.`,
          explanation: "Unit sale price is mandatory for packages above 250 g / 250 ml. Manual verification required.",
          confidence: null,
          evidenceImageId: imageId,
        }),
      };
    }
  }

  if (registryRule.status !== "active" || sourceDocument?.reviewStatus !== "VERIFIED") {
    return {
      ...baseEvidence({
        status: "review",
        evidence: value || "Source rule text not verified for definitive image enforcement",
        explanation: "The official source document or operative text for this rule is not verified in the registry. The system will not make a definitive legal finding.",
        confidence,
        evidenceImageId: declaration?.evidenceImageId ?? imageId,
        boundingBox: declaration?.boundingBox,
        polygon: declaration?.polygon,
      }),
    };
  }
  if (declaration?.status === "CONFLICT" || declaration?.conflict) {
    return {
      ...baseEvidence({
        status: "review",
        evidence: declaration.value ?? "",
        explanation: "Conflicting declarations were extracted from multiple package images. Both evidence sources are retained for manual verification.",
        confidence,
        evidenceImageId: declaration.evidenceImageId,
        boundingBox: declaration.boundingBox,
        polygon: declaration.polygon,
      }),
    };
  }

  // Run field-specific validator
  let validation: { ok: boolean; reason?: string };
  switch (field) {
    case "mrp":
      validation = validateMRP(value);
      break;
    case "net_quantity":
      validation = validateNetQuantity(value);
      break;
    case "date":
      validation = validateDate(value);
      break;
    case "manufacturer":
      validation = validateManufacturer(value, declaration);
      break;
    case "product_name":
      validation = validateProductName(value);
      break;
    case "consumer_care":
      validation = validateConsumerCare(value);
      break;
    case "country_of_origin":
      validation = validateCountryOfOrigin(declaration?.value ?? value);
      break;
    case "unit_sale_price":
      validation = validateUnitSalePrice(value);
      break;
    case "dimensions":
      validation = validateDimensions(declaration?.value ?? value);
      break;
    case "best_before":
      validation = validateBestBefore(declaration?.value ?? value);
      break;
    default:
      validation = value ? { ok: true } : { ok: false, reason: "Declaration missing." };
  }

  // MRP tax-inclusive sub-check (Rule 6(1)(e))
  // Tri-state: evidence line present + phrase missing → FAIL (true violation);
  // phrase present → PASS; no OCR evidence line captured → REVIEW (not assessable).
  if (field === "mrp" && validation.ok) {
    const rawEvidenceText = declaration?.evidence?.rawText ?? declaration?.rawValue ?? "";
    const hasEvidenceLine = Boolean(rawEvidenceText.trim());
    const taxInclusive = validateMRPTaxInclusive(declaration);
    if (!taxInclusive.ok) {
      if (!hasEvidenceLine) {
        return {
          ...baseEvidence({
            status: "review",
            evidence: value,
            explanation: "MRP_TAX_INCLUSIVE_NOT_ASSESSABLE — the raw OCR evidence line for the retail price was not captured, so the mandatory 'inclusive of all taxes' wording cannot be verified. Manual inspection of the physical label required.",
            confidence,
            evidenceImageId: declaration?.evidenceImageId ?? imageId,
            boundingBox: declaration?.boundingBox,
            polygon: declaration?.polygon,
          }),
        };
      }
      return {
        ...baseEvidence({
          status: applyConfidenceGate("fail", confidence ?? 0, 0.4),
          evidence: value,
          explanation: `${taxInclusive.reason ?? "Tax-inclusive declaration missing."}`,
          confidence,
          evidenceImageId: declaration?.evidenceImageId ?? imageId,
          boundingBox: declaration?.boundingBox,
          polygon: declaration?.polygon,
        }),
      };
    }
  }

  /**
   * OCR confidence is evidence quality, not a legal decision.
   */
  const passThreshold = context.extractionSource === "local_offline_ocr" ? 0.48 : 0.45;
  const failGateThreshold = context.extractionSource === "local_offline_ocr" ? 0.45 : 0.40;

  if (validation.ok && (declaration?.status === "DETECTED" || declaration?.status === "VERIFIED") && confidence !== null && confidence >= passThreshold) {
    return {
      ...baseEvidence({
        status: "pass",
        evidence: value,
        explanation: `${rule.label} is present and passes rule evaluation.`,
        confidence: declaration?.confidence,
        evidenceImageId: declaration?.evidenceImageId ?? imageId,
        boundingBox: declaration?.boundingBox,
        polygon: declaration?.polygon,
      }),
    };
  }

  // FAIL — but gate on extraction confidence
  const rawStatus = applyConfidenceGate("fail", confidence ?? 0, failGateThreshold);
  const explanation =
    rawStatus === "review"
      ? `Extraction confidence (${confidence === null ? "not available" : `${Math.round(confidence * 100)}%`}) is below threshold (${Math.round(failGateThreshold * 100)}%). ${validation.reason ?? ""} Manual inspection or re-capture recommended.`
      : `${validation.reason ?? `${rule.label} is non-compliant.`}`;

  return {
    ...baseEvidence({
      status: rawStatus,
      evidence: value || "No readable declaration detected",
      explanation,
      confidence,
      evidenceImageId: declaration?.evidenceImageId ?? imageId,
      boundingBox: declaration?.boundingBox,
      polygon: declaration?.polygon,
    }),
  };
}

// ---------------------------------------------------------------------------
// Misleading declaration detection
// ---------------------------------------------------------------------------

function detectMisleading(declarations: Declaration[]): {
  status: ComplianceCheck["status"];
  evidence?: string;
  reason: string;
  confidence: number;
} {
  const signals: string[] = [];

  // "100% EXTRA FREE" marketing vs actual net quantity
  const quantity = declarationFor(declarations, "net_quantity");
  if (quantity?.value) {
    const m = quantity.value.match(/EXTRA/i);
    if (m) signals.push("Promotional 'EXTRA' quantity wording present — verify the extra product is actually included in the net weight.");
  }

  // "MRP ₹X" flashed as selling price when MRP is inclusive
  const mrp = declarationFor(declarations, "mrp");
  if (mrp?.value && !/incl/i.test(`${mrp.evidence?.rawText ?? mrp.rawValue ?? ""}`)) {
    signals.push("MRP declared without explicit 'inclusive of all taxes' wording.");
  }

  if (signals.length === 0) {
    return { status: "pass", reason: "No potential misleading declaration signals detected.", confidence: 0.9 };
  }
  return {
    status: "review",
    evidence: signals.join(" | "),
    reason: "Potential misleading declaration signals identified. Officer review required before enforcement action.",
    confidence: 0.6,
  };
}

// ---------------------------------------------------------------------------
// Roll-up status
// ---------------------------------------------------------------------------

export function overallStatus(
  checks: ComplianceCheck[],
): "pass" | "fail" | "review" | "not_evaluated" {
  if (checks.some((c) => c.status === "fail")) return "fail";
  if (checks.some((c) => c.status === "review")) return "review";
  if (checks.some((c) => c.status === "not_evaluated")) return "review";
  return "pass";
}

// ---------------------------------------------------------------------------
// Compliance score (0–100)
// ---------------------------------------------------------------------------

export function complianceScore(checks: ComplianceCheck[]): number | null {
  const statutory = checks.filter((c) => c.ruleId !== INVALID_EVIDENCE_RULE_ID);
  if (statutory.length === 0) return null;

  const weight: Record<RuleDefinition["severity"], number> = {
    critical: 3,
    major: 2,
    minor: 1,
  };
  let total = 0;
  let earned = 0;

  // Rules that are not_applicable or not_evaluated (e.g. physical scale
  // unavailable, officer weighing pending) are excluded from the score: they
  // measure nothing about the evaluated evidence. The VERDICT — not the
  // score — is what flags them as REQUIRES_REVIEW (blocking).
  for (const check of statutory) {
    const rule = RULES.find((r) => r.id === check.ruleId);
    const w = weight[rule?.severity ?? "minor"];
    if (check.status === "not_applicable" || check.status === "not_evaluated") continue;
    total += w;
    if (check.status === "pass") earned += w;
    else if (check.status === "review") earned += w * 0.5;
  }

  return total === 0 ? null : Math.round((earned / total) * 100);
}

/**
 * Rule ID emitted by the package-presence gate when no valid package evidence
 * exists. It is NOT a statutory declaration rule and is excluded from scoring.
 */
export const INVALID_EVIDENCE_RULE_ID = "EVIDENCE-01";

/** Single gate check explaining why an inspection holds no compliance result. */
export function invalidEvidenceCheck(reason: string, evidenceImageId?: string): ComplianceCheck {
  return {
    ruleId: INVALID_EVIDENCE_RULE_ID,
    field: "evidence",
    status: "review",
    evidence: reason,
    explanation:
      "Package presence gate: no valid packaged-commodity evidence was detected. " +
      "Statutory declaration rules were NOT applied. Capture a valid package frame and resubmit.",
    confidence: null,
    evidenceImageId,
  };
}

export type InspectionVerdict =
  | "COMPLIANT"
  | "NON_COMPLIANT"
  | "REQUIRES_REVIEW"
  | "INVALID_EVIDENCE"
  | "INCOMPLETE"
  | "PROCESSING";

/**
 * Official verdict logic. Pure function of backend state — the frontend MUST
 * render this value and MUST NOT compute its own.
 *
 * - INVALID_EVIDENCE: package gate failed → no compliance analysis ran.
 * - INCOMPLETE: valid evidence but processing never completed.
 * - NON_COMPLIANT: ≥1 confirmed statutory violation.
 * - REQUIRES_REVIEW: valid evidence with ≥1 uncertain check (incl. not_evaluated).
 * - COMPLIANT: every applicable statutory rule passed.
 */
export function inspectionVerdict(args: {
  packageDetected: boolean;
  processingComplete: boolean;
  checks: ComplianceCheck[];
}): InspectionVerdict {
  if (!args.packageDetected) return "INVALID_EVIDENCE";
  const statutory = args.checks.filter((c) => c.ruleId !== INVALID_EVIDENCE_RULE_ID);
  if (!args.processingComplete || statutory.length === 0) return "INCOMPLETE";
  if (statutory.some((c) => c.status === "fail")) return "NON_COMPLIANT";
  if (statutory.some((c) => c.status === "review" || c.status === "not_evaluated")) return "REQUIRES_REVIEW";
  return "COMPLIANT";
}

/** Map an official verdict to the legacy inspection status enum. */
export function verdictToStatus(verdict: InspectionVerdict): "pass" | "fail" | "review" | "processing" | "invalid_evidence" | "incomplete" {
  switch (verdict) {
    case "COMPLIANT":
      return "pass";
    case "NON_COMPLIANT":
      return "fail";
    case "REQUIRES_REVIEW":
      return "review";
    case "INVALID_EVIDENCE":
      return "invalid_evidence";
    case "INCOMPLETE":
      return "incomplete";
    case "PROCESSING":
      return "processing";
  }
}