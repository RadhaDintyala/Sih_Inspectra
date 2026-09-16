# UI/UX Requirements — 26034

## Product direction

**Industrial inspection instrument meets premium modern software.**

The UI should feel credible enough for a government enforcement officer, but refined enough to look like a serious commercial product.

## Core screens

### 1. Inspection Home
Purpose: start work immediately.

Elements:
- Start inspection
- Recent inspections
- Compliance snapshot
- search
- clear system status

### 2. Scan Workspace
Primary hero screen.

Layout:
- large package image area
- capture/upload action
- image quality indicator
- detected-side/evidence indicator
- inspection metadata

### 3. Analysis State
Shows real progress:
- Image processing
- Text detection
- Declaration extraction
- Rule validation

Do not fake progress.

### 4. Compliance Result
Primary result screen.

Must show:
- overall status
- compliance score only if defensible
- PASS / FAIL / REVIEW breakdown
- exact violations
- evidence regions
- extracted declarations
- rule references
- confidence

### 5. Evidence Detail
Split view:
**original image ↔ extracted text ↔ rule requirement**

This is a key differentiator.

### 6. Inspection History
Searchable table/list:
- product
- date
- status
- violations
- inspection ID

### 7. Inspection Detail / Report
A complete record with:
- evidence
- extracted fields
- rule checks
- officer notes
- export action

### 8. Enforcement Dashboard
Only meaningful metrics:
- inspections
- compliant/non-compliant/review
- common violations
- recent activity
- products requiring review

### 9. Rules Reference
Human-readable rule references used by the engine.

## UX rules

- One primary action per major state.
- Always show why a violation occurred.
- Never make evidence harder to reach than the verdict.
- Do not rely on color alone.
- Every async operation has a visible state.
- Empty/error states must tell the user what to do next.
- Keyboard navigation must work.
- Mobile capture flow must remain usable.
- Desktop inspection workflow should be optimized for an enforcement workstation.

## Visual system

Do not choose colors/fonts before defining the product's visual concept.

Required process:
1. establish visual direction
2. define tokens
3. design one hero workflow
4. review against Anthropic frontend-design
5. audit against Vercel web-interface-guidelines
6. then scale to secondary screens

## Anti-patterns

- generic admin dashboard
- 12 equal cards
- giant meaningless gradient
- excessive rounded containers
- tiny grey text
- hidden violation evidence
- decorative charts with no decision value
