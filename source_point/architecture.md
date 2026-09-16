# Architecture — SIH 26034

## Product architecture

```text
                    ┌──────────────────────┐
                    │     Web / Mobile     │
                    │  Inspection Console  │
                    └──────────┬───────────┘
                               │
                         Upload / Capture
                               │
                    ┌──────────▼───────────┐
                    │   Inspection API     │
                    └──────────┬───────────┘
                               │
             ┌─────────────────┼─────────────────┐
             │                 │                 │
      ┌──────▼──────┐   ┌──────▼──────┐   ┌────▼─────────┐
      │ Image/CV    │   │ OCR Adapter  │   │ Inspection DB│
      │ preprocessing│   │              │   │              │
      └──────┬──────┘   └──────┬───────┘   └──────────────┘
             │                 │
             └────────┬────────┘
                      ▼
              Structured Extraction
                      │
                      ▼
             ┌──────────────────┐
             │ Compliance Engine│
             │ deterministic    │
             └────────┬─────────┘
                      │
            ┌─────────┴──────────┐
            ▼                    ▼
      Evidence/Violations     Report Model
            │                    │
            └─────────┬──────────┘
                      ▼
                 UI + History
```

## Separation of concerns

### Capture layer
Handles images only.

### Extraction layer
Converts images into structured declarations and evidence regions.

### Compliance layer
Applies explicit rules. It should not depend on UI code.

### Evidence layer
Stores source image references, bounding boxes, extracted values and confidence.

### Reporting layer
Turns inspection data into a human-readable report.

### Persistence
Stores inspections, products, extracted declarations, violations and evidence metadata.

## Core design principle

The same inspection object must drive:
- result screen
- evidence screen
- history
- dashboard
- report

No screen should invent its own version of the result.

## AI boundary

AI/CV can:
- detect text
- extract fields
- classify packaging regions
- estimate readability/font characteristics

The deterministic rules engine decides compliance based on structured evidence.

An LLM can help explain an existing rule result, but cannot create the rule.

## Prototype deployment

Local-first development.

Production architecture can later add:
- authentication
- object storage
- cloud deployment
- audit logging
- multi-tenant access

Do not let these delay the internal prototype.
