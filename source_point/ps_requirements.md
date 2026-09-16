# PS Requirements — 26034

## Official problem

**Software System to check compliance of Packaged Commodities under Legal Metrology (Packaged Commodities) Rules, 2011 by scanning products, images and labels.**

Organization: Ministry of Consumer Affairs, Food & Public Distribution  
Department: Department of Consumer Affairs  
Category: Software  
Theme: Miscellaneous

## Problem

Packaged commodities must carry prescribed declarations such as:
- manufacturer/packer/importer details
- net quantity
- Maximum Retail Price (MRP)
- month/year of manufacture, packing or import
- consumer-care details
- other prescribed declarations

Manual inspection is time-consuming and resource-intensive.

## Required capabilities

1. Scan/analyse package images.
2. Detect mandatory declarations.
3. Extract declaration text.
4. Check correctness and completeness.
5. Check placement where applicable.
6. Check readability and font-size requirements.
7. Identify missing/non-compliant declarations.
8. Generate compliance reports and violation summaries.
9. Store scanned products and inspection history.
10. Provide enforcement dashboards.
11. Attach photographs/evidence.
12. Search/retrieve previous scans.
13. Export reports to PDF/editable formats.
14. Support secure/role-based access in the full product.

## Prototype interpretation

For the internal prototype, the core product is:

**Package image → evidence extraction → deterministic rule evaluation → explainable violations → inspection report → history**

Authentication may be deferred during the 3-hour prototype sprint, but the architecture must leave a clean boundary for it.

## Non-negotiable truthfulness

The prototype must distinguish:
- PASS
- FAIL
- REVIEW / INCONCLUSIVE

Do not present uncertain OCR or image measurements as legal certainty.

## Source

Official SIH archive/statement:
`https://sih2026.vuce.in/ps/SIH26034`

Legal Metrology reference:
`https://consumeraffairs.gov.in/pages/legal-metrology-act`
