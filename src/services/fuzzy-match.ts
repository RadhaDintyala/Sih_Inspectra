/**
 * Fuzzy string matching — Levenshtein distance and token overlap.
 * Used for anchor matching and gazetteer lookup.
 */

/** Levenshtein edit distance between two strings. */
export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  const dp = Array.from({ length: m + 1 }, () => new Uint16Array(n + 1));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost,
      );
    }
  }
  return dp[m][n];
}

/** Normalized similarity score 0..1 (1 = identical). */
export function similarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}

/** Tokenize a string into lowercase alpha tokens. */
export function tokenize(s: string): string[] {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
}

/** Token overlap (Jaccard-like) between two tokenized strings. */
export function tokenOverlap(a: string, b: string): number {
  const tokA = new Set(tokenize(a));
  const tokB = new Set(tokenize(b));
  if (tokA.size === 0 && tokB.size === 0) return 1;
  let intersection = 0;
  for (const t of tokA) if (tokB.has(t)) intersection++;
  const union = tokA.size + tokB.size - intersection;
  return union > 0 ? intersection / union : 0;
}

/**
 * Find best fuzzy match for a query string in a list of candidates.
 * Returns { match, score, distance } or null if no match above threshold.
 */
export function bestFuzzyMatch(
  query: string,
  candidates: string[],
  threshold: number = 0.72,
): { match: string; score: number; distance: number } | null {
  const q = query.toLowerCase().trim();
  let best: { match: string; score: number; distance: number } | null = null;

  for (const c of candidates) {
    const cl = c.toLowerCase().trim();

    // Exact match
    if (q === cl) return { match: c, score: 1, distance: 0 };

    // Prefix match (brand names are often truncated)
    if (cl.startsWith(q) || q.startsWith(cl)) {
      const score = Math.min(q.length, cl.length) / Math.max(q.length, cl.length);
      if (score > (best?.score ?? 0)) best = { match: c, score, distance: levenshtein(q, cl) };
      continue;
    }

    // Token overlap — if most tokens match, it's likely the same product
    const overlap = tokenOverlap(q, cl);
    if (overlap >= 0.5) {
      const dist = levenshtein(q, cl);
      const score = overlap * 0.6 + similarity(q, cl) * 0.4;
      if (score > (best?.score ?? 0)) best = { match: c, score, distance: dist };
      continue;
    }

    // Levenshtein on full string
    const dist = levenshtein(q, cl);
    const maxLen = Math.max(q.length, cl.length);
    if (maxLen <= 2) continue; // skip very short strings
    const score = 1 - dist / maxLen;
    if (score > (best?.score ?? 0)) best = { match: c, score, distance: dist };
  }

  return best && best.score >= threshold ? best : null;
}

/**
 * Fuzzy anchor match — find the best matching label anchor in OCR text.
 * Uses Levenshtein distance ≤ 2 or similarity ≥ threshold, with OCR confusable map.
 */
const ANCHOR_CONFUSABLES: Record<string, string> = {
  "0": "o",
  "1": "i",
  "5": "s",
  "8": "b",
  "3": "e",
};

export function normalizeConfusables(s: string): string {
  return s
    .toLowerCase()
    .split("")
    .map((ch) => ANCHOR_CONFUSABLES[ch] ?? ch)
    .join("");
}

export function matchAnchor(
  text: string,
  anchors: string[],
  maxDistance: number = 2,
): { anchor: string; distance: number; position: number } | null {
  const lower = text.toLowerCase();
  const normalizedLower = normalizeConfusables(text);
  let best: { anchor: string; distance: number; position: number } | null = null;

  for (const anchor of anchors) {
    const aLower = anchor.toLowerCase();
    const aNorm = normalizeConfusables(anchor);

    // Exact substring match
    const exactPos = lower.indexOf(aLower);
    if (exactPos >= 0) {
      return { anchor, distance: 0, position: exactPos };
    }

    // Confusable exact match
    const confPos = normalizedLower.indexOf(aNorm);
    if (confPos >= 0) {
      return { anchor, distance: 0, position: confPos };
    }

    const anchorLen = aNorm.length;

    // For 3-letter anchors ("mfd", "mfg", "exp", "mrp"), check word tokens
    if (anchorLen <= 3) {
      const words = text.split(/[\s:.\-\/\\]+/);
      let curPos = 0;
      for (const w of words) {
        if (w.length >= 2 && w.length <= 5) {
          const wNorm = normalizeConfusables(w);
          const dist = levenshtein(aNorm, wNorm);
          // Allow edit distance 1 for 3-letter anchors, excluding mrp<->mfr and mfg<->mfr swaps
          const isConfusableSwap =
            (aNorm === "mfr" && (wNorm === "mrp" || wNorm === "mfg")) ||
            (aNorm === "mrp" && wNorm === "mfr") ||
            (aNorm === "mfg" && wNorm === "mfr");

          if (dist <= 1 && !isConfusableSwap) {
            const p = lower.indexOf(w.toLowerCase(), curPos);
            if (!best || dist < best.distance) {
              best = { anchor, distance: dist, position: p >= 0 ? p : curPos };
            }
          }
        }
        curPos += w.length + 1;
      }
      continue;
    }

    const effectiveMaxDist = Math.min(maxDistance, Math.max(0, Math.floor(anchorLen / 3)));

    for (let i = 0; i <= normalizedLower.length - Math.max(3, anchorLen - effectiveMaxDist); i++) {
      for (let wLen = Math.max(3, anchorLen - effectiveMaxDist); wLen <= Math.min(anchorLen + effectiveMaxDist, normalizedLower.length - i); wLen++) {
        const window = normalizedLower.slice(i, i + wLen);
        const dist = levenshtein(aNorm, window);
        if (dist <= effectiveMaxDist) {
          if (!best || dist < best.distance || (dist === best.distance && i < best.position)) {
            best = { anchor, distance: dist, position: i };
          }
        }
      }
    }
  }

  return best;
}
