# Compliance Rules — 26034

## Purpose

This file defines how legal requirements become deterministic software checks.

## Source of truth

Use the Legal Metrology Act and the Legal Metrology (Packaged Commodities) Rules, 2011 from the Department of Consumer Affairs.

Reference:
`https://consumeraffairs.gov.in/pages/legal-metrology-act`

## Rule-engine principles

1. Each rule has a stable internal ID.
2. Each rule records its legal source/reference.
3. Each rule defines:
   - input evidence
   - validation
   - pass condition
   - fail condition
   - review condition
4. Rules are versioned.
5. The UI displays the rule reference used.
6. No rule is invented by an LLM.

## Initial prototype rule families

- mandatory declaration presence
- net quantity presence/format
- MRP declaration presence/format
- manufacturer/packer/importer declaration
- date/month/year declaration
- consumer-care details
- readability
- placement where objectively measurable
- font-size/character-height assessment where a defensible physical reference is available

## Measurement warning

Font-size in millimetres is the hardest part of the PS.

Do not claim physical font-size compliance from an arbitrary photograph without a scale/reference assumption.

If the system cannot establish a trustworthy physical scale:

**return REVIEW**, not FAIL.

## Rule result

```text
PASS     = sufficient evidence supports compliance
FAIL     = sufficient evidence supports non-compliance
REVIEW   = evidence is insufficient/ambiguous
N/A      = rule does not apply
```

## Evidence-first requirement

Every FAIL should be traceable to:
1. the extracted value or missing value
2. the image/evidence region
3. the rule ID/reference
4. the reason
