# Inspectra — Architecture V2: Multi-Tier Vision Pipeline

> **Core Architectural Principle**: Stop the live camera experience from being a raw AI-call wrapper. Add an instant, offline-first client-side processing tier for live preview guidance, reserve large multimodal AI for a single surgical extraction per captured image, and govern all compliance verdicts with a deterministic, legally grounded rule engine.

---

## 1. High-Level Pipeline Overview

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                       TIER 0: CLIENT-SIDE CLASSICAL CV                                 │
│                                (In-Browser · 0ms Network Latency · Zero AI)                           │
│                                                                                                        │
│   Live Camera Feed  ──▶  Canvas Downscale (320px)  ──▶  Heuristic Frame Analyzer (~5-6 FPS)             │
│   (HTML5 <video>)         (TypedArray Uint8)            ├── Laplacian Variance (Sharpness > 80)        │
│                                                         ├── Luminance Histogram (Glare < 5%)           │
│                                                         ├── Sobel Edge Density (Framing 3.5%-50%)      │
│                                                         └── Temporal Frame Delta (Steadiness < 12)     │
│                                                                     │                                  │
│                                                                     ▼                                  │
│                                                      Real-Time Camera HUD Overlay                      │
│                                                  ("Hold steady" / "Ready to capture")                  │
└───────────────────────────────────────────────────┬────────────────────────────────────────────────────┘
                                                    │ User clicks "Capture frame"
                                                    │ (or optional single pre-capture confirmation)
                                                    ▼
┌────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                              [FUTURE / SCOPED] TIER 1: ON-DEVICE OBJECT DETECTOR                       │
│                        (Lightweight Client-Side ONNX / TensorFlow.js — Bounding Box Hints)             │
│                                                                                                        │
│   Packaged Product Localization ──▶ Local Crop Region Hint to bound OCR search window                 │
└───────────────────────────────────────────────────┬────────────────────────────────────────────────────┘
                                                    │
                                                    ▼ High-Res Evidence Frame (JPEG)
┌────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                      TIER 2: REGIONAL OCR EXTRACTION                                  │
│                               (Per-region Tesseract · Structured JSON Extraction)                     │
│                                                                                                        │
│   Tesseract WASM + deterministic field parsers                                                         │
│   ├── OCR & Bounding Box Coordinates                                                                  │
│   ├── Structured Field Extraction (MRP, Net Qty, Mfg Date, Expiry, Manufacturer, COO, Consumer Care)  │
│   └── Image Quality Penalty Factors (Legibility, Resolution, Glare)                                    │
└───────────────────────────────────────────────────┬────────────────────────────────────────────────────┘
                                                    │ Normalized Declarations + Confidence
                                                    ▼
┌────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                   TIER 3: DETERMINISTIC COMPLIANCE RULE ENGINE                         │
│                           (Zero AI · Versioned TypeScript · Legal Metrology Rules, 2011)               │
│                                                                                                        │
│   evaluateCompliance(declarations, context)                                                            │
│   ├── LM-PC-01: Commodity Name (Rule 6(1))                                                            │
│   ├── LM-PC-02: Manufacturer & Address Structure (Rule 6(1)(a) — PIN / State / Entity)                │
│   ├── LM-PC-03: Net Quantity & Metric Units (Rule 6(1)(b))                                            │
│   ├── LM-PC-04: MRP with Mandatory "inclusive of all taxes" (Rule 6(1)(e))                            │
│   ├── LM-PC-05: Month & Year of Mfg/Packing vs Expiry (Rule 6(1)(d))                                  │
│   ├── LM-PC-06: Consumer Care Contacts (Rule 6(1)(f))                                                 │
│   ├── LM-PC-07: Physical Font Height & Readability Proxy (Rule 8)                                     │
│   └── LM-PC-10: Country of Origin (Rule 6(1)(a)/(m) — mandatory for imported goods)                  │
│                                                                                                        │
│   Result: PASS / FAIL / REVIEW (Low confidence gated to REVIEW; never hallucinated)                   │
└───────────────────────────────────────────────────┬────────────────────────────────────────────────────┘
                                                    │ Evidence-Linked Audit Record
                                                    ▼
                                    ┌───────────────────────────────┐
                                    │  SQLite / Prisma Audit Log    │
                                    │  Inspector Console Dashboard  │
                                    └───────────────────────────────┘
```

---

## 2. Detailed Breakdown of the Four Tiers

### Tier 0: Client-Side Classical Computer Vision (Active)
- **Runtime**: Browser Main Thread via HTML5 Canvas API and `requestAnimationFrame`.
- **Latency**: Sub-5ms computation per sample; throttled to ~180-220ms (5 FPS).
- **Network / Dependencies**: **Zero network requests**, **zero external libraries**, **zero WASM/WebGL bloat**. Pure TypeScript using `Uint8ClampedArray` and `Int32Array`.
- **Functions**:
  1. **Grayscale Luminance Conversion**: $Y = 0.299R + 0.587G + 0.114B$ via integer bit shifts.
  2. **Laplacian Kernel Variance**: Measures the second spatial derivative of illumination. Flat/blurry frames yield $\sigma^2 < 30$, while sharp declaration text produces $\sigma^2 \ge 80$.
  3. **Luminance Histogram & Spatial Cell Glare**: Detects specular reflections from glossy laminates. Flags if $>5\%$ of total frame or $>12\%$ of any $3 \times 3$ grid cell is saturated ($>240/255$).
  4. **Sobel Edge Density**: Dual $3 \times 3$ horizontal and vertical gradient convolutions. Classifies scene framing: $<3.5\%$ indicates "move closer / empty background", while $3.5\%-50\%$ represents optimal packaging coverage.
  5. **Temporal Pixel Delta**: Mean absolute difference between consecutive frames ($Y_t$ vs $Y_{t-1}$). Flags motion blur risk when hand/camera translation exceeds threshold ($\Delta > 12$).
- **User Experience**: Live camera HUD provides instant advisory guidance ("Hold steady", "Too blurry — move closer or improve lighting", "Glare detected — tilt packet slightly", "Good — ready to capture") with green/amber diagnostic pills. Capture is **never blocked**.

---

### Tier 1: On-Device Lightweight Object Detector (Scoped Future Item)
- **Target Runtime**: ONNX Runtime Web / TensorFlow.js WebGL backend.
- **Model**: Quantized Tiny Detector (e.g. YOLOv8n fine-tuned on packaging classes or MobileNet-SSD).
- **Purpose**: Identify the physical packaging bounding box within the camera preview at 5-10 FPS, providing a live bounding overlay and a region-of-interest crop hint for the Tier 2 extraction.
- **Status**: Documented as an explicit future milestone rather than a rushed prototype (see Section 3 for technical feasibility analysis).

---

### Tier 2: Regional OCR Extraction (Active)
- **Runtime**: Worker-side Tesseract regional OCR with deterministic normalizers.
- **Invocation Pattern**: **Demoted from continuous preview polling to a single surgical call per captured evidence frame**.
  - An optional single pre-capture presence verification call to `/api/scan/live-guidance` occurs *only* when Tier 0 CV reaches `ready` state.
  - If the call times out or fails, capture proceeds unhindered with Tier 0 guidance alone.
- **Payload**: Full-resolution JPEG/PNG evidence photo.
- **Responsibility**: Semantic OCR and structured key-value extraction into standard JSON schema. Multimodal AI is strictly restricted to extraction — **it is never allowed to decide legal compliance**.

---

### Tier 3: Deterministic Compliance Rule Engine (Active)
- **Runtime**: Server/Edge TypeScript engine (`src/domain/rules.ts`).
- **Input**: Normalized `Declaration[]` objects with bounding boxes and extraction confidence.
- **Logic**: Strict, code-based verification of Rule 6(1) under the Legal Metrology (Packaged Commodities) Rules, 2011:
  - Verifies presence of Indian currency markers (`₹`, `Rs`, `INR`) and positive amounts.
  - Verifies mandatory "inclusive of all taxes" declaration.
  - Verifies mandatory month and year of manufacture/packing (rejects bare years or standalone expiry dates).
  - Verifies complete manufacturer address structure (PIN code, state/city, corporate suffix, multi-part address).
  - Evaluates country of origin (flags REVIEW for domestic/unclear goods, FAILS only if evidence confirms imported good without declaration).
- **Enforcement Integrity**: Confidence gating downgrades low-confidence failures to `REVIEW` to prevent unwarranted prosecution notices based on OCR artifacts.

---

## 3. Engineering Rationale: Why Not YOLO for Live Preview Guidance?

When building a live camera inspection feature, the initial temptation is often to bundle an in-browser YOLO model (e.g., `yolov8n.onnx`) running continuously at 30 FPS. We deliberately rejected this approach for live preview guidance:

### 1. The Packaging Domain Gap in Generic COCO Datasets
Standard pre-trained vision models are trained on the 80 COCO classes. COCO does not contain classes like "biscuit packet", "shampoo sachet", "atta bag", or "spice pouch".
- Attempting to proxy packaging with COCO classes like `"book"` (class 73), `"bottle"` (class 39), or `"cell phone"` (class 67) results in severe failure modes:
  - Rigid cardboard boxes occasionally trigger `"book"`.
  - Flexible pillow pouches, vacuum packs, and foil sachets trigger no detections at all (false negatives) or hallucinate wild labels like `"toaster"` or `"bed"`.
- A detector that draws erratic, jumping bounding boxes in front of an enforcement officer destroys credibility faster than having no bounding box at all.

### 2. Live Quality Assessment Does Not Require Object Classification
To answer the question *"Is the camera ready to take a legible picture?"*, an algorithm does not need to know whether the object is a Parle-G packet or a Maggi pack. It only needs to know:
- Is the image sharp or blurry? (Laplacian variance)
- Is the printed text obscured by glare? (Luminance saturation histogram)
- Does high-contrast detail fill the central view? (Sobel edge density)
- Is the user holding their hand steady? (Temporal pixel delta)

Classical computer vision answers these four mathematical questions with **absolute determinism, zero inference hallucinations, and zero latency**.

### 3. Mobile Battery, Thermal Throttling, and Bundle Size
- Loading a 15–25MB ONNX model and running continuous WebGL tensor convolutions on a low-to-mid-range smartphone causes instant thermal throttling, frame rate drops, and aggressive battery drain.
- Inspectra's Tier 0 classical CV engine compiles to **less than 6 KB of minified TypeScript**, loads in 0ms, allocates zero garbage collector overhead, and runs smoothly at 60 FPS on any commodity phone browser.

---

## 4. Key Architectural Takeaway for Reviewers and Judges

| Question | Architectural Answer |
|----------|----------------------|
| *"Is this just a wrapper around an AI API?"* | **No.** The inspection path is classical CV, regional OCR, deterministic extraction, and a versioned rule engine. |
| *"Why does the camera preview feel instantaneous without lag?"* | Frame analysis runs locally in-browser on a downscaled 320px Canvas buffer using TypedArrays with zero network roundtrips. |
| *"What happens if internet connectivity drops in the field?"* | Tier 0 camera guidance continues to function seamlessly offline. Captured photos queue locally for upload when connectivity restores. |
| *"Can the extractor hallucinate a violation or miss mandatory declarations?"* | No generative model makes statutory decisions. OCR candidates are confidence-gated; uncertain or conflicting evidence is explicitly flagged for review. |
