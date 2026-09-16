import fs from "fs";
import path from "path";
import sharp from "sharp";
import { detectPackageRoi } from "../services/package-roi";
import { ocrService } from "../services/ocr-service";
import { extractTextRegions } from "../services/text-region-proposals";
import { extractFieldCandidates, type TextLine } from "../services/field-extraction";

async function traceUserImage() {
  const imgPath = ".scan-store/vault/inspections/INSP-2026-8825/evidence/EV-INSP-2026-8825-001.jpg";
  console.log(`\n==================================================`);
  console.log(`TRACING USER SCREENSHOT IMAGE: ${imgPath}`);
  console.log(`==================================================\n`);

  const buf = fs.readFileSync(imgPath);
  const meta = await sharp(buf).metadata();
  console.log(`Dimensions: ${meta.width}x${meta.height}, Orientation: ${meta.orientation}`);

  // 1. Check ROI
  const roiRes = await detectPackageRoi(buf);
  console.log(`\nPACKAGE ROI: status=${roiRes.status}`);
  console.log(`Selected ROI:`, roiRes.selected ? JSON.stringify(roiRes.selected) : "NONE");
  console.log(`Top 5 candidates:`);
  for (const c of roiRes.candidates) {
    console.log(`  - score=${c.score} area=${c.areaFraction} bbox=${JSON.stringify(c.bbox)} ${c.reason}`);
  }

  // 2. Try text region proposals on full frame vs ROI crop
  const fullTextRois = await extractTextRegions(buf, { maxRegions: 12 });
  console.log(`\nFULL FRAME Text ROIs count: ${fullTextRois.length}`);
  for (const tr of fullTextRois) {
    console.log(`  - ${tr.id}: bbox=${JSON.stringify(tr.bbox)} h=${tr.estCharHeightPx}px aspect=${tr.aspectRatio}`);
  }

  // 3. Run OCR on 0°, 90°, 180°, 270° rotated buffers to test orientation
  for (const rot of [0, 90, 180, 270]) {
    const rotBuf = rot === 0 ? buf : await sharp(buf).rotate(rot).toBuffer();
    const rotMeta = await sharp(rotBuf).metadata();
    const ocrRes = await ocrService.recognizeWholeImage(rotBuf);
    console.log(`\nOCR at ROTATION ${rot}° (${rotMeta.width}x${rotMeta.height}):`);
    console.log(`  Raw text length: ${ocrRes.fullText.length}, chars=${ocrRes.fullText.replace(/\s+/g, "").length}`);
    console.log(`  First 300 chars: "${ocrRes.fullText.slice(0, 300).replace(/\n/g, " | ")}"`);
  }
}

traceUserImage().catch(console.error);
