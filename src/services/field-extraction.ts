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
} from "@/services/normalizer";
import { matchAnchor, bestFuzzyMatch, tokenize } from "@/services/fuzzy-match";
import { lookupProduct, type GazetteerProduct } from "@/services/gazetteer";

export interface TextLine {
  text: string;
  confidence: number;
  bbox: BoundingBox;
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
  batch_number: ["Batch", "Lot", "B.No", "Batch No", "Lot No"],
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

      // Also try geometry-based match for product name
      const isTopHalf = line.bbox.y < 50;
      const isLargeText = line.bbox.height > 4;
      const isNotNumeric = !/^\d/.test(line.text.trim());
      const isLongEnough = line.text.replace(/\s+/g, "").length >= 3;
      if (isTopHalf && isLargeText && isNotNumeric && isLongEnough && !anchorMatch) {
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

  // Numeric fields: normalizer already validated, just check length
  if (["mrp", "net_quantity", "date", "unit_sale_price"].includes(field)) {
    if (value.length > 50) return { passes: false, reason: "numeric value too long" };
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
    case "batch_number": { const c = text.trim(); return c && !/^\d{12,14}$/.test(c.replace(/\s+/g, "")) ? c : null; }
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
