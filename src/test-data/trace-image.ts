import fs from "fs";
import path from "path";
import sharp from "sharp";
import { detectPackageRoi } from "../services/package-roi";
import { ocrService } from "../services/ocr-service";
import { extractTextRegions } from "../services/text-region-proposals";
import { extractFieldCandidates, type TextLine } from "../services/field-extraction";
import { yoloService } from "../services/yolo-service";

async function traceImage(imagePath: string) {
  console.log(`\n==================================================`);
  console.log(`TRACING IMAGE: ${imagePath}`);
  console.log(`==================================================\n`);

  const tStart = Date.now();

  // 1. Buffer check
  const buf = fs.readFileSync(imagePath);
  const meta = await sharp(buf).metadata();
  console.log(`1. IMAGE BUFFER & DIMS:`);
  console.log(`   Bytes: ${buf.length}`);
  console.log(`   Dimensions: ${meta.width}x${meta.height}`);
  console.log(`   Format: ${meta.format}, Density: ${meta.density}`);

  // 2. Package ROI
  const tRoiStart = Date.now();
  const roiRes = await detectPackageRoi(buf);
  const tRoi = Date.now() - tRoiStart;
  console.log(`\n2. PACKAGE ROI: (${tRoi}ms)`);
  console.log(`   Status: ${roiRes.status}`);
  console.log(`   Selected:`, roiRes.selected ? JSON.stringify(roiRes.selected) : "NONE");

  // 3. Text Region Proposals inside Package ROI
  const tPropStart = Date.now();
  let proposalBuf = buf;
  if (roiRes.selected) {
    const b = roiRes.selected.bbox;
    const origW = meta.width ?? 1000;
    const origH = meta.height ?? 1000;
    const left = Math.max(0, Math.floor((b.x / 100) * origW));
    const top = Math.max(0, Math.floor((b.y / 100) * origH));
    const width = Math.min(origW - left, Math.max(10, Math.ceil((b.width / 100) * origW)));
    const height = Math.min(origH - top, Math.max(10, Math.ceil((b.height / 100) * origH)));
    proposalBuf = await sharp(buf).extract({ left, top, width, height }).toBuffer();
  }

  const textRois = await extractTextRegions(proposalBuf, { maxRegions: 12 });
  const tProp = Date.now() - tPropStart;
  console.log(`\n3. TEXT REGION PROPOSALS: (${tProp}ms)`);
  console.log(`   Number of Text ROIs: ${textRois.length}`);
  for (const tr of textRois) {
    console.log(`   - ROI ${tr.id}: bbox=${JSON.stringify(tr.bbox)} estCharHeight=${tr.estCharHeightPx}px polarity=${tr.polarity} score=${tr.score}`);
  }

  // 4. Height-aware Crop OCR
  const tCropOcrStart = Date.now();
  const cropOcrRes = await ocrService.recognizeCropProposals(proposalBuf, textRois);
  const tCropOcr = Date.now() - tCropOcrStart;
  console.log(`\n4. HEIGHT-AWARE CROP OCR: (${tCropOcr}ms)`);
  console.log(`   Lines Extracted: ${cropOcrRes.lines.length}`);
  console.log(`   Merged Crop OCR text (first 500 chars):`);
  console.log(`--------------------------------------------------`);
  console.log(cropOcrRes.mergedText.slice(0, 500));
  console.log(`--------------------------------------------------`);

  // 5. Whole-Image OCR Baseline
  const tWholeOcrStart = Date.now();
  const wholeOcr = await ocrService.recognizeWholeImage(buf);
  const tWholeOcr = Date.now() - tWholeOcrStart;
  console.log(`\n5. WHOLE IMAGE OCR BASELINE: (${tWholeOcr}ms)`);
  console.log(`   Selected candidate: ${wholeOcr.selectedCandidate}`);
  console.log(`   Text length: ${wholeOcr.fullText.length}`);

  // 6. Field Extraction
  const tExtractStart = Date.now();
  const combinedText = [wholeOcr.fullText, cropOcrRes.mergedText].filter(Boolean).join("\n");
  const lines: TextLine[] = combinedText
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l.length >= 2)
    .map((text, idx) => ({
      text,
      confidence: 75,
      bbox: { x: 2, y: idx * 10, width: 96, height: 8 }
    }));

  const fields = extractFieldCandidates(lines, [
    "product_name", "mrp", "net_quantity", "date", "manufacturer", "consumer_care", "country_of_origin", "unit_sale_price"
  ]);
  const tExtract = Date.now() - tExtractStart;

  console.log(`\n6. FIELD EXTRACTION RESULTS: (${tExtract}ms)`);
  console.log(`   Candidates count: ${fields.length}`);
  for (const f of fields.filter(c => c.value)) {
    console.log(`   - Field [${f.field}]: value="${f.value}" score=${f.score} rawText="${f.rawText}" source=${f.source}`);
  }

  const tTotal = Date.now() - tStart;
  console.log(`\nTIMINGS SUMMARY:`);
  console.log(`   ROI: ${tRoi}ms | Proposals: ${tProp}ms | Crop OCR: ${tCropOcr}ms | Whole OCR: ${tWholeOcr}ms | Extract: ${tExtract}ms | TOTAL: ${tTotal}ms`);
}

async function main() {
  const images = [
    ".scan-store/vault/inspections/INSP-2026-1135/evidence/EV-INSP-2026-1135-001.jpg",
    ".scan-store/vault/inspections/INSP-2026-1275/evidence/EV-INSP-2026-1275-001.jpg"
  ];

  for (const img of images) {
    if (fs.existsSync(img)) {
      await traceImage(img);
    } else {
      console.log(`File not found: ${img}`);
    }
  }
}

main().catch(console.error);
