/**
 * Gazetteer — deterministic product name lookup from a curated database.
 *
 * Loads data/fmcg-gazetteer.json at first lookup (lazy).
 * Uses fuzzy token matching (similarity ≥ 0.72) to identify products.
 * Returns canonical name + match score, or null if no match.
 */

import fs from "fs";
import path from "path";
import { similarity, tokenize, bestFuzzyMatch } from "@/services/fuzzy-match";

export interface GazetteerProduct {
  name: string;
  aliases: string[];
}

export interface GazetteerMatch {
  product: GazetteerProduct;
  canonical: string;
  score: number;
  matchedAlias: string;
}

let _cache: GazetteerProduct[] | null = null;

function loadGazetteer(): GazetteerProduct[] {
  if (_cache !== null) return _cache;
  try {
    const filePath = path.join(process.cwd(), "data", "fmcg-gazetteer.json");
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    const products: GazetteerProduct[] = parsed.products ?? [];
    _cache = products;
    console.log(`[Gazetteer] Loaded ${products.length} products`);
    return products;
  } catch (err) {
    console.warn("[Gazetteer] Failed to load, using empty set:", err instanceof Error ? err.message : String(err));
    _cache = [];
    return [];
  }
}

/**
 * Look up a product name against the gazetteer.
 * Returns the best match with score ≥ 0.72, or null.
 */
export function lookupProduct(ocrText: string): GazetteerMatch | null {
  const products = loadGazetteer();
  if (products.length === 0) return null;

  const cleaned = ocrText.trim();
  if (!cleaned || cleaned.length < 2) return null;

  let bestMatch: GazetteerMatch | null = null;

  for (const product of products) {
    // Build candidate list: product name + all aliases
    const candidates = [product.name, ...product.aliases];

    for (const candidate of candidates) {
      // Exact match
      if (cleaned.toLowerCase() === candidate.toLowerCase()) {
        return {
          product,
          canonical: product.name,
          score: 1.0,
          matchedAlias: candidate,
        };
      }

      // Token overlap: check if candidate tokens match OCR tokens (exact or prefix)
      const candTokens = tokenize(candidate);
      const ocrTokens = tokenize(cleaned);
      let matchingCount = 0;
      for (const ct of candTokens) {
        if (
          ocrTokens.some(
            (ot) =>
              ot === ct ||
              (ot.length >= 4 && ct.startsWith(ot) && ct.length - ot.length <= 2) ||
              (ct.length >= 4 && ot.startsWith(ct) && ot.length - ct.length <= 1)
          )
        ) {
          matchingCount++;
        }
      }
      const tokenScore = candTokens.length > 0 ? matchingCount / candTokens.length : 0;

      // Similarity score
      const simScore = similarity(cleaned.toLowerCase(), candidate.toLowerCase());

      // Combined score (weight token overlap higher for short queries)
      const combinedScore = candTokens.length <= 2
        ? simScore * 0.6 + tokenScore * 0.4
        : tokenScore * 0.7 + simScore * 0.3;

      if (combinedScore >= 0.72 && combinedScore > (bestMatch?.score ?? 0)) {
        bestMatch = {
          product,
          canonical: product.name,
          score: Math.round(combinedScore * 100) / 100,
          matchedAlias: candidate,
        };
      }
    }
  }

  return bestMatch;
}

/**
 * Check if a product name matches the gazetteer (boolean).
 */
export function isKnownProduct(ocrText: string): boolean {
  return lookupProduct(ocrText) !== null;
}
