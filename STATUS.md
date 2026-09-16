# Inspectra — Project Status

## Stack
Next.js 16, React 19, TypeScript 5, Prisma ORM, PostgreSQL, Tesseract.js (WASM), Sharp

## Pipeline
Package Gate → YOLO/detectRegions → OCR-layout band segmentation → classifyLine → field extraction → normalizeFieldValue → passesPlausibilityGate → compliance → DB

## Declaration Fields
`product_name`, `manufacturer`, `net_quantity`, `mrp`, `date`, `consumer_care`, `country_of_origin`, `unit_sale_price`

## Core Principles
- Rule engine is deterministic; uncertain extraction = REVIEW/NOT_DETECTED, never PASS
- No fake AI, no LLM, no cloud OCR
- `npx tsc --noEmit` and `npm run build` must pass clean
- 150/150 tests passing (13 test files)

---

## Completed Work

### Detection Sensitivity
- Lowered band height threshold 9→6, ink density 0.015→0.010
- Added keyword patterns for manufacturer, country_of_origin, net_quantity in `yolo-service.ts`

### OCR Preprocessing
- 3-pass preprocessing (standard/threshold/sharpened) in `ocr-service.ts`
- Per-field Tesseract PSM modes: PSM 7 numeric, PSM 6 text blocks, PSM 11 sparse
- Per-field whitelists: numeric fields only, no-whitelist for text fields
- 3 PSMs for whole-image (3/6/11), now **parallelized** via `Promise.all()`
- Capped preprocessing variants at 3 (was 5) for speed

### Field Extraction (NEW)
- **`field-extraction.ts`**: Fuzzy anchors (Levenshtein ≤ 2), gazetteer integration, strict plausibility gate
- **`fuzzy-match.ts`**: Levenshtein distance, similarity, token overlap, `matchAnchor()`, `bestFuzzyMatch()`
- **`gazetteer.ts`**: Lazy-loads `data/fmcg-gazetteer.json` (~250 Indian FMCG SKUs), fuzzy token match score ≥ 0.72 → canonical name
- **`data/fmcg-gazetteer.json`**: 250+ products with aliases
- **Wired into pipeline-worker.ts**: `extractFieldCandidates()` is now primary extraction; old regex `extractFieldFromWholeText()` kept as last-resort fallback

### Plausibility & Anti-Garbage
- `passesPlausibilityGate()` in `pipeline-worker.ts`: 50% noise threshold, COMMON_WORDS check for product_name
- `passesPlausibilityGate()` in `field-extraction.ts`: 35% noise threshold, >150 char reject, no alpha token ≥3 reject, gazetteer cross-check
- Fixed `COMMON_WORDS` typo: `itchen` → `kitchen`

### Package Quality Signals
- `package-gate.ts`: Added `textHeightScore` (median text run length) and `skewDegrees` (projection profile)
- TEXT_TOO_SMALL and SKEWED_IMAGE guidance gates
- `package-roi.ts`: Edge/contour ROI localization (Sobel, union-find, scoring)

### UI
- **`ResultView.tsx`**: Enforcement-grade UI rebuilt
- **`globals.css`**: WCAG AA contrast CSS

### Acceptance Tests
- **`tests/acceptance.test.ts`**: 14 tests verifying field extraction from synthetic Good Day OCR text
- Gazetteer recognition, fuzzy anchor extraction, normalizer output, ≥3 fields extracted, no gibberish

---

## Known Issues / Next Steps

### 25s Latency (PARTIALLY FIXED)
- Parallelized PSMs + capped variants → estimated ~9s (down from ~25s)
- Still needs end-to-end benchmarking on real images

### Product Name Extraction
- Gazetteer works for known products; geometry-based fallback for unknowns
- Single-line OCR ("Britannia") may match wrong product; multi-line combination not yet implemented

### Multi-line Manufacturer Extraction
- When anchor label ("Manufactured by") is alone on a line, now looks at next line
- Still limited to 2-line lookahead

### No YOLO Weights
- Currently using OCR-layout proposals for region detection
- When YOLO weights are present, regions will be more accurate

---

## File Map

| File | Purpose |
|------|---------|
| `src/services/pipeline-worker.ts` | Main pipeline orchestration, field extraction, plausibility gate |
| `src/services/field-extraction.ts` | Fuzzy anchors + gazetteer + strict plausibility (NEW) |
| `src/services/fuzzy-match.ts` | Levenshtein, similarity, token overlap (NEW) |
| `src/services/gazetteer.ts` | Lazy-loads gazetteer, `lookupProduct()` (NEW) |
| `data/fmcg-gazetteer.json` | ~250 Indian FMCG products with aliases (NEW) |
| `src/services/ocr-service.ts` | Per-field PSM, preprocessing ensemble, multi-candidate scoring |
| `src/services/preprocessing.ts` | CLAHE + deskew preprocessing (capped at 3 variants) |
| `src/services/yolo-service.ts` | Detection layer, `classifyLine()`, `runOcrLayoutProposals()` |
| `src/services/package-gate.ts` | Quality signals (textHeightScore, skewDegrees) |
| `src/services/package-roi.ts` | Edge/contour ROI localization |
| `src/services/normalizer.ts` | All normalizer functions |
| `src/services/extraction.ts` | `mergeDeclarations()` cross-image aggregation |
| `src/domain/inspection.ts` | Domain types |
| `src/domain/rules.ts` | Compliance engine |
| `src/components/ResultView.tsx` | Enforcement-grade UI |
| `tests/acceptance.test.ts` | 14 field extraction acceptance tests |
| `tests/pipeline.test.ts` | 41 unit tests |
| `tests/integration.test.ts` | 22 integration tests |
| `e2e/inspection-flow.spec.ts` | E2E test with synthetic SVG fixture |
