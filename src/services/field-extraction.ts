/**
 * Field-Oriented Extraction — fuzzy anchors + gazetteer + strict plausibility.
 *
 * - Fuzzy anchor matching (Levenshtein ≤ 2) for label detection
 * - Gazetteer snap for product name (score ≥ 0.72 → canonical name)
 * - Strict plausibility gate BEFORE status=DETECTED
 * - Numeric fields: normalizer only (invalid parse → NOT_DETECTED)
 */

import type { DeclarationField, BoundingBox } from "@/domain/inspection";
import {
  normalizeMRP,
  normalizeNetQuantity,
  normalizeDate,
  normalizeProductName,
  normalizeManufacturer,
  normalizeConsumerCare,
  normalizeCountryOfOrigin,
  normalizeBatchNumber,
} from "@/services/normalizer";
import { matchAnchor, bestFuzzyMatch, tokenize } from "@/services/fuzzy-match";
import { lookupProduct, type GazetteerProduct } from "@/services/gazetteer";

export interface TextLine {
  text: string;
  confidence: number;
  bbox: BoundingBox;
  polygon?: number[][];
  imageId?: string;
  /**
   * Ratio of this line's bbox height to the median bbox height of all lines
   * in the same image. Resolution-independent prominence signal.
   * relativeHeight > 2.5 ≈ headline / brand name text.
   * relativeHeight ≈ 1.0 ≈ typical body / label text.
   * Populated by ocr-service from the Python pipeline output.
   */
  relativeHeight?: number;
  /** Horizontal centre of bbox in percentage coordinates. */
  centerX?: number;
  /** Vertical centre of bbox in percentage coordinates. */
  centerY?: number;
}

export interface FieldCandidate {
  field: DeclarationField;
  value: string;
  rawText: string;
  score: number;
  confidence: number;
  bbox?: BoundingBox;
  source: string;
  rejectionReason?: string;
}

/** Fuzzy anchor labels per field (Levenshtein ≤ 2). */
const FIELD_ANCHORS: Record<DeclarationField, string[]> = {
  mrp: ["MRP", "M.R.P", "M R P", "RSP", "R.S.P", "Retail Sale Price"],
  net_quantity: ["Net Wt", "Net Qty", "Net Weight", "Net Contents", "Net Quantity", "Net Vol"],
  date: ["Mfg", "Mfd", "Pkd", "Packed", "MFG", "MFD", "Best Before", "Exp", "Expiry", "Use By"],
  manufacturer: ["Manufactured by", "Marketed by", "Packed by", "Produced by", "Mfd by", "Mfr"],
  consumer_care: ["Consumer Care", "Customer Care", "Care Cell", "Helpline", "Toll Free", "Help Line"],
  country_of_origin: ["Country of Origin", "Origin", "Made in", "Product of", "Manufactured in", "Imported from"],
  product_name: [],
  unit_sale_price: ["Sale Price", "Retail Price"],
  dimensions: ["Dimensions", "Size", "Pack Size", "Measurement"],
  best_before: ["Best Before", "Use By", "Expiry", "Exp", "Shelf Life"],
  batch_number: ["Batch No", "Lot No", "B.No", "Batch", "Lot"],
  other: [],
};

/**
 * Extract field candidates from OCR text lines.
 * Uses fuzzy anchors, gazetteer lookup, and strict plausibility.
 */
export function extractFieldCandidates(
  lines: TextLine[],
  targetFields: DeclarationField[]
): FieldCandidate[] {
  const candidates: FieldCandidate[] = [];

  if (targetFields.includes("product_name") && lines.length > 0) {
    const fullJoined = lines.map((l) => l.text).join(" ");
    const gazetteerMatch = matchProductGazetteer(fullJoined, lines[0].bbox);
    if (gazetteerMatch) {
      candidates.push(gazetteerMatch);
    }
  }

  for (const field of targetFields) {
    const fieldCandidates = extractSingleField(field, lines);
    candidates.push(...fieldCandidates);
  }

  return candidates;
}

function extractSingleField(field: DeclarationField, lines: TextLine[]): FieldCandidate[] {
  const anchors = FIELD_ANCHORS[field] ?? [];
  const candidates: FieldCandidate[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (field === "manufacturer") {
      const prevLineText = i > 0 ? lines[i - 1].text : "";
      const nextLineText = i + 1 < lines.length ? lines[i + 1].text : "";
      const isDatePhrase = /\b(?:months?|date|dt)\s+(?:from|of)\b/i.test(line.text) ||
                           /\b(?:best\s*before|shelf\s*life|use\s*by|use\s*within)\b/i.test(line.text) ||
                           /\b(?:mfg|mfd|pkd|packed)\s+(?:date|dt|month|year)\b/i.test(line.text);
      const isAdjacentToDate = /\b(?:month|months|best\s*before|shelf\s*life|date|dt)\b/i.test(prevLineText) ||
                               /\b(?:month|months|best\s*before|shelf\s*life|date|dt)\b/i.test(nextLineText);
      const hasMfrRole = /\b(?:by|for)\b/i.test(line.text) || /:\s*\w+/.test(line.text) || /\b(?:ltd|limited|pvt|llp|inc|corp)\b/i.test(line.text);
      if (isDatePhrase || (isAdjacentToDate && !hasMfrRole)) continue;
    }

    // ── Fuzzy anchor matching ──────────────────────────────────────
    let anchorMatch: { anchor: string; distance: number; position: number } | null = null;
    if (anchors.length > 0) {
      anchorMatch = matchAnchor(line.text, anchors, 2);
    }

    // Product name: gazetteer-based matching (single line and adjacent joined lines)
    if (field === "product_name") {
      const gazetteerResult = matchProductGazetteer(line.text, line.bbox);
      if (gazetteerResult) {
        candidates.push(gazetteerResult);
      }
      // Adjacent multi-line join for product name (e.g., "Britannia" + "Good Day")
      if (i + 1 < lines.length) {
        const nextLine = lines[i + 1];
        if (Math.abs(nextLine.bbox.y - line.bbox.y) < 15) {
          const joinedText = `${line.text} ${nextLine.text}`;
          const joinedGazetteer = matchProductGazetteer(joinedText, line.bbox);
          if (joinedGazetteer) {
            candidates.push(joinedGazetteer);
          }
        }
      }

      // Also try geometry-based match for product name (must not match any statutory declaration anchor)
      const allStatutoryAnchors = Object.entries(FIELD_ANCHORS)
        .filter(([k]) => k !== "product_name")
        .flatMap(([, v]) => v);
      // Use distance=0 for short-name statutory check (exact match only — no fuzzy).
      const isStatutoryLine = matchAnchor(line.text, allStatutoryAnchors, 2) !== null;
      const isStatutoryExact = matchAnchor(line.text, allStatutoryAnchors, 0) !== null;

      // Resolution-independent prominence: use relativeHeight when available,
      // fall back to raw bbox.height divided by a typical body-text height (4%).
      const relH = line.relativeHeight ?? (line.bbox.height > 0 ? line.bbox.height / 4 : 1.0);

      // Position OK: in the top 70% of the image, OR text is larger than median.
      const isProminentPosition = line.bbox.y < 70;
      const isProminentSize = relH >= 1.5;       // larger than median label text
      const isVeryProminentSize = relH >= 2.5;   // headline / brand-name text
      // Discard near-zero height noise only (artefacts with no real bbox).
      const isVisibleText = line.bbox.height > 0.5;
      const isNotNumeric = !/^\d/.test(line.text.trim());
      const positionOk = isProminentPosition || isProminentSize;

      // ── Standard path: any text that passes the normalizer at a prominent position ─
      // We do NOT gate on text length here — a 2-char brand name at prominence
      // is valid evidence. normalizeProductName is the semantic gate.
      if (positionOk && isVisibleText && isNotNumeric && !isStatutoryLine) {
        const normalized = normalizeProductName(line.text);
        if (normalized) {
          const score = computeFieldScore(field, line, 0.5, normalized);
          candidates.push({
            field,
            value: normalized,
            rawText: line.text,
            score,
            confidence: line.confidence,
            bbox: line.bbox,
            source: "geometry-match",
          });
        }
      }

      // ── Short-name path: 2–4 letter brand names (VIM, ORS, ACT, A1, etc.) ──
      // Gate on relativeHeight > 2.5 (substantially larger than median text).
      // Statutory abbreviations ("MRP", "Mfg", "Ltd") appear at body-text size
      // (relativeHeight ≈ 1.0) — they will not pass this threshold.
      // All-caps or Title-case is required (brand naming convention on FMCG packs).
      const rawTrimmed = line.text.trim();
      const isPurelyAlpha = /^[a-zA-Z\s-]+$/.test(rawTrimmed);
      const isAllCapsOrTitle =
        rawTrimmed === rawTrimmed.toUpperCase() ||
        /^[A-Z][a-zA-Z\s-]*$/.test(rawTrimmed);
      const strippedLen = rawTrimmed.replace(/\s+/g, "").length;

      if (
        isVeryProminentSize &&
        isPurelyAlpha &&
        isAllCapsOrTitle &&
        strippedLen >= 2 &&
        strippedLen <= 4 &&
        !isStatutoryExact &&
        !isStatutoryLine
      ) {
        const cleanedShort = rawTrimmed.charAt(0).toUpperCase() + rawTrimmed.slice(1).toLowerCase();
        candidates.push({
          field,
          value: cleanedShort,
          rawText: rawTrimmed,
          score: computeFieldScore(field, line, 0.8, cleanedShort),
          confidence: line.confidence,
          bbox: line.bbox,
          source: `geometry-match-short-name(relH=${relH.toFixed(1)})`,
        });
      }

      continue;
    }

    if (!anchorMatch) continue;

    // ── Extract value after anchor ─────────────────────────────────
    // For consumer_care and manufacturer, perform 1–4 line lookahead join
    let valueText: string;
    if (field === "consumer_care" || field === "manufacturer") {
      const lineParts: string[] = [line.text.trim()];
      for (let j = 1; j <= 3 && i + j < lines.length; j++) {
        const nextLine = lines[i + j].text.trim();
        if (!nextLine) break;
        // Stop lookahead if next line hits a new anchor label
        if (matchAnchor(nextLine, ["MRP", "Net Wt", "Net Qty", "Mfg", "Best Before", "Country of Origin"], 1)) {
          break;
        }
        lineParts.push(nextLine);
      }
      valueText = lineParts.join(" ");
    } else {
      valueText = extractValueAfterAnchor(line.text, anchorMatch.anchor, anchorMatch.position);
    }

    // Fix 7 — net_quantity: marketing-phrase guard.
    // Nutritional callouts ("3g protein", "38 kcal") and cooking timers
    // ("Ready in 3 minutes") carry the same N + unit pattern as statutory
    // net-quantity declarations. Reject them here before normalization.
    if (field === "net_quantity") {
      const marketingRe = /\b(?:minute|min|ready|protein|fat|fibre|fiber|energy|calorie|serving|per\s+\d|vitamin|calcium|iron|sodium|carb|sugar|cholesterol)\b/i;
      if (marketingRe.test(valueText) || marketingRe.test(line.text)) {
        candidates.push({
          field,
          value: "",
          rawText: line.text,
          score: 0,
          confidence: line.confidence,
          bbox: line.bbox,
          source: `fuzzy-anchor-${anchorMatch.anchor}-marketing-guard-reject`,
          rejectionReason: `marketing/nutritional callout — not a net-quantity declaration`,
        });
        continue;
      }
    }

    // ── Normalize and validate ─────────────────────────────────────
    const normalized = normalizeFieldFromLine(field, valueText);
    if (!normalized) {
      candidates.push({
        field,
        value: "",
        rawText: line.text,
        score: 0,
        confidence: line.confidence,
        bbox: line.bbox,
        source: `fuzzy-anchor-${anchorMatch.anchor}-normalizer-reject`,
        rejectionReason: `normalizer rejected "${valueText.slice(0, 40)}"`,
      });
      continue;
    }

    // ── Strict plausibility gate ───────────────────────────────────
    const plausibility = passesPlausibilityGate(field, normalized);
    if (!plausibility.passes) {
      candidates.push({
        field,
        value: "",
        rawText: line.text,
        score: 0,
        confidence: line.confidence,
        bbox: line.bbox,
        source: `fuzzy-anchor-${anchorMatch.anchor}-plausibility-reject`,
        rejectionReason: plausibility.reason,
      });
      continue;
    }

    const score = computeFieldScore(field, line, anchorMatch.distance, normalized);
    candidates.push({
      field,
      value: normalized,
      rawText: line.text,
      score,
      confidence: line.confidence,
      bbox: line.bbox,
      source: `fuzzy-anchor-${anchorMatch.anchor}-d${anchorMatch.distance}`,
    });
  }

  return candidates;
}

/**
 * Match product name against gazetteer.
 * Returns a candidate if gazetteer score ≥ 0.72.
 */
function matchProductGazetteer(text: string, bbox: BoundingBox): FieldCandidate | null {
  const result = lookupProduct(text);
  if (!result) return null;

  return {
    field: "product_name",
    value: result.canonical,
    rawText: text,
    score: 0.95, // gazetteer match gets high base score
    confidence: Math.round(result.score * 100),
    bbox,
    source: `gazetteer-match-${result.product.name}`,
  };
}

/**
 * Extract the value portion after an anchor label.
 * Returns the text after the anchor on the same line.
 */
function extractValueAfterAnchor(lineText: string, anchor: string, position: number): string {
  const afterAnchor = lineText.slice(position + anchor.length);
  // Clean leading punctuation/separators
  const cleaned = afterAnchor.replace(/^[\s:.\-\/\\]+/, "").trim();
  return cleaned || lineText.trim();
}

/**
 * Compute a composite score for a field candidate.
 */
function computeFieldScore(
  field: DeclarationField,
  line: TextLine,
  anchorDistance: number,
  normalizedValue: string,
): number {
  let score = 0;

  // Base: OCR confidence (0–100 normalized to 0–1)
  score += (line.confidence / 100) * 0.25;

  // Anchor match quality (distance 0 = perfect, 2 = fuzzy)
  score += Math.max(0, 1 - anchorDistance / 3) * 0.25;

  // Geometry bonus
  const positionScore = getFieldPositionScore(field, line.bbox);
  score += positionScore * 0.20;

  // Value plausibility (length, format)
  const len = normalizedValue.length;
  const lenScore = len >= 3 && len <= 120 ? 1.0 : len > 120 ? 0.5 : 0.3;
  score += lenScore * 0.15;

  // Normalizer success bonus
  score += 0.15;

  return Math.round(score * 100) / 100;
}

/**
 * Strict plausibility gate — applied BEFORE status=DETECTED.
 * Free-text fields must have real words; numeric fields rely on normalizer.
 */
function passesPlausibilityGate(
  field: DeclarationField,
  value: string,
): { passes: boolean; reason?: string } {
  if (!value || value.trim().length === 0) {
    return { passes: false, reason: "empty value" };
  }

  // Numeric and code fields: normalizer already validated, just check length
  if (["mrp", "net_quantity", "date", "unit_sale_price", "batch_number"].includes(field)) {
    if (value.length > 50) return { passes: false, reason: "numeric/code value too long" };
    return { passes: true };
  }

  // Free-text fields: stricter checks
  const cleaned = value.trim();

  // Length check
  if (cleaned.length > 150) {
    return { passes: false, reason: "value too long — likely garbage dump" };
  }

  // Noise check: non-alphanumeric > 35% = garbage
  const alphaNumCount = cleaned.replace(/[^a-zA-Z0-9]/g, "").length;
  const noiseRatio = 1 - alphaNumCount / cleaned.length;
  if (noiseRatio > 0.35) {
    return { passes: false, reason: `noise ratio ${(noiseRatio * 100).toFixed(0)}% > 35%` };
  }

  // Token check: need at least one token with ≥3 alpha chars
  const tokens = tokenize(cleaned);
  const longAlphaTokens = tokens.filter((t) => /^[a-z]{3,}$/.test(t));
  if (longAlphaTokens.length === 0) {
    return { passes: false, reason: "no alpha token ≥ 3 chars" };
  }

  // Product name: need at least one word ≥ 4 letters (common words or gazetteer)
  if (field === "product_name") {
    const hasLongWord = tokens.some((t) => t.length >= 4);
    if (!hasLongWord) {
      return { passes: false, reason: "no word ≥ 4 chars for product name" };
    }
  }

  // Fix 8 — manufacturer: require at least one entity/address signal.
  // An anchor keyword ("Manufactured by") alone can fire on front-panel text;
  // we also need a PIN code, Indian state name, or corporate suffix in the
  // assembled value before we consider it a valid manufacturer declaration.
  if (field === "manufacturer") {
    const isDatePhrase = /\b(?:months?|date|dt)\s+(?:from|of)\b/i.test(cleaned) || /\b(?:best\s*before|shelf\s*life|use\s*by|use\s*within)\b/i.test(cleaned) || /\b(?:mfg|mfd|pkd|packed)\s+(?:date|dt|month|year)\b/i.test(cleaned);
    if (isDatePhrase) {
      return { passes: false, reason: "date/shelf-life phrase — not a manufacturer declaration" };
    }
    const hasPIN = /\b\d{5,6}\b/.test(cleaned);
    const hasState = /\b(?:karnataka|bangalore|bengaluru|mumbai|delhi|kolkata|chennai|hyderabad|pune|ahmedabad|gurgaon|noida|haryana|maharashtra|tamil\s*nadu|kerala|andhra|telangana|gujarat|rajasthan|punjab|uttar\s*pradesh|bihar|odisha|west\s*bengal|assam|goa|india)\b/i.test(cleaned);
    const hasEntity = /\b(?:pvt\.?\s*ltd|limited|ltd\.?|llp|foods|industries|beverages|consumer\s*products|confectionery|bakeries|enterprises)\b/i.test(cleaned);
    const hasAddressKw = /\b(?:road|rd|street|st|lane|nagar|sector|phase|industrial|midc|gidc|district|village|taluk|post|opp|near)\b/i.test(cleaned);
    if (!((hasPIN || hasState) && (hasEntity || hasAddressKw))) {
      return {
        passes: false,
        reason: "manufacturer value lacks address/entity signal — likely marketing text",
      };
    }
  }

  if (field === "batch_number") {
    if (cleaned.length > 35) {
      return { passes: false, reason: "batch number candidate exceeds maximum 35 characters" };
    }
    if (/\b(?:composition|contains|ingredients|sodium|chloride|dextrose|excipients|mfg|manufactured|marketed)\b/i.test(cleaned)) {
      return { passes: false, reason: "batch number candidate contains composition or ingredient prose" };
    }
  }

  return { passes: true };
}

function normalizeFieldFromLine(field: DeclarationField, text: string): string | null {
  switch (field) {
    case "mrp": return normalizeMRP(text);
    case "net_quantity": return normalizeNetQuantity(text);
    case "date": return normalizeDate(text);
    case "product_name": return normalizeProductName(text);
    case "manufacturer": return normalizeManufacturer(text);
    case "consumer_care": return normalizeConsumerCare(text);
    case "country_of_origin": return normalizeCountryOfOrigin(text);
    case "unit_sale_price": return normalizeMRP(text);
    case "dimensions": return text.trim() || null;
    case "best_before": return normalizeDate(text);
    case "batch_number": return normalizeBatchNumber(text);
    default: return text.trim() || null;
  }
}

function getFieldPositionScore(field: DeclarationField, bbox: BoundingBox): number {
  const expectedY: Record<string, number> = {
    product_name: 15,
    mrp: 70,
    net_quantity: 65,
    date: 75,
    manufacturer: 80,
    consumer_care: 85,
    country_of_origin: 90,
    unit_sale_price: 72,
  };
  const expected = expectedY[field] ?? 50;
  const diff = Math.abs(bbox.y - expected);
  return Math.max(0, 1 - diff / 50);
}
