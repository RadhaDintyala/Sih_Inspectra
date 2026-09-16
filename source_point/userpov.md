# User POV — Enforcement Inspection Workflow

## Primary user

A Legal Metrology enforcement officer inspecting a packaged commodity.

## Golden path

### 1. Start inspection
Officer opens the inspection workspace and chooses:
**Scan product**

### 2. Capture/upload
Officer takes or uploads package photographs.

The interface immediately shows:
- image quality
- readable/unreadable areas
- front/back/side evidence where available

### 3. SEE
Computer vision identifies text regions and relevant package areas.

### 4. READ
OCR extracts declarations.

The officer can inspect the original image alongside extracted text.

### 5. UNDERSTAND
The system structures the extraction:

- product name
- manufacturer/packer/importer
- net quantity
- MRP
- date information
- consumer care
- other relevant declarations

### 6. CHECK
The rules engine evaluates each applicable requirement.

Each result has:
- status
- extracted evidence
- rule reference
- confidence
- explanation

### 7. Review violations
Officer clicks a violation.

The original photograph focuses on the exact evidence region.

### 8. Decide
Officer can:
- accept the finding
- mark for manual review
- add an observation
- attach another photograph

### 9. Generate report
System produces a structured inspection report containing:
- product information
- evidence images
- extracted declarations
- rule-by-rule result
- violations
- review notes
- timestamp/inspection ID

### 10. Save
Inspection enters searchable history.

## Golden demo

Use a real supermarket packet.

Judge photographs it.

Within one flow:

**scan → extracted declarations → highlighted evidence → compliance result → violation explanation → report**

That is the moment the product has to earn its place.
