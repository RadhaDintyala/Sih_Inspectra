# Testing Strategy — 26034

## P0 — business-critical tests

### Extraction
- clean front label
- rotated label
- low-light image
- partial/cropped label
- multilingual text
- unreadable text

### Compliance
- all mandatory declarations present
- one missing declaration
- malformed MRP
- malformed net quantity
- missing manufacturer/packer
- missing consumer-care details
- ambiguous OCR
- uncertain physical measurement

### Integration
Test:

**upload → OCR → structured data → rule engine → result**

### UI
- upload works
- loading state works
- result renders from real API/data
- evidence highlight opens
- report export works
- history persists/retrieves inspection

## P1

- multiple images
- repeated scans
- report regeneration
- network/API failure
- large image handling

## P2

- visual regression
- performance
- advanced accessibility audit
- batch scanning

## Definition of done

A feature is not done until:
- typecheck passes
- relevant tests pass
- happy path works
- error state exists
- no fake data is required for the demonstrated path
