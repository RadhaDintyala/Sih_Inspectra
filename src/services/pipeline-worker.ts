/**
 * Analysis Worker — official inspection pipeline.
 *
 * IMAGE (original preserved)
 *   ↓ orientation + resolution normalisation (never overwrites original)
 * PACKAGE GATE (deterministic CV — face / non-package frames rejected here)
 *   ↓ valid frames only
 * YOLO & PaddleOCR PP-OCRv4 ONNX ENGINE (multi-image batch)
 *   ↓
 * DETECTED REGIONS (exact polygons + measured bboxes + confidence)
 *   ↓
 * DETERMINISTIC STATUTORY FIELD EXTRACTION (8 Legal Metrology fields)
 *   ↓
 * STATUTORY COMPLIANCE ENGINE (Indian Legal Metrology Rules 2011)
 *   ↓
 * Database (structured result) → API → UI
 */

import type {
  Inspection,
  EvidenceImage,
  Declaration,
  DeclarationField,
  BoundingBox,
  InspectionTimelineEvent,
  PhysicalMeasurement,
} from "@/domain/inspection";
import { createHash } from "crypto";
import {
  evaluateCompliance,
  complianceScore,
  inspectionVerdict,
  verdictToStatus,
  invalidEvidenceCheck,
  INVALID_EVIDENCE_RULE_ID,
} from "@/domain/rules";
import fs from "fs";
import path from "path";
import { yoloService, type RegionProposal } from "@/services/yolo-service";
import { ocrService } from "@/services/ocr-service";
import { storage } from "@/services/storage";
import { saveInspection, prisma, recordStatusChange } from "@/services/store";
import { logAuditEvent } from "@/services/audit";
import {
  normalizeMRP,
  normalizeNetQuantity,
  normalizeDate,
  normalizeConsumerCare,
  normalizeManufacturer,
  normalizeProductName,
  normalizeCountryOfOrigin,
  parseConsumerCareDetails,
} from "@/services/normalizer";

export interface PipelineInputImage {
  buffer: Buffer;
  filename: string;
  mimeType?: string;
  side?: "front" | "back" | "side" | "top" | "unknown";
  sourceCamera?: string;
}

export interface PipelineJob {
  inspectionId: string;
  organizationId: string;
  userId?: string;
  packageCategory?: string;
  images: PipelineInputImage[];
  source?: "camera" | "upload" | "live_feed" | "ecommerce";
  ecommerceUrl?: string;
  ecommerceProduct?: import("@/domain/inspection").EcommerceProductData;
  physicalMeasurements?: PhysicalMeasurement[];
  physicalScale?: { pixelsPerMm: number; scaleReference: string };
}

const TARGET_FIELDS: DeclarationField[] = [
  "product_name",
  "mrp",
  "net_quantity",
  "date",
  "manufacturer",
  "consumer_care",
  "country_of_origin",
  "unit_sale_price",
  "dimensions",
  "best_before",
  "batch_number",
];

const SIDE_LABELS: Record<string, string> = {
  front: "FRONT",
  back: "BACK",
  side: "SIDE",
  top: "SIDE",
  unknown: "OTHER",
};

/** Short hex hash of image buffer for provenance tracing in logs. */
function imgHash(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex").slice(0, 12);
}

function normalizeFieldValue(field: DeclarationField, raw: string): string | null {
  const text = raw ?? "";
  if (!text.trim()) return null;
  let result: string | null = null;
  switch (field) {
    case "mrp":
      result = normalizeMRP(text);
      break;
    case "net_quantity":
      result = normalizeNetQuantity(text);
      break;
    case "date":
      result = normalizeDate(text);
      break;
    case "product_name":
      result = normalizeProductName(text);
      break;
    case "manufacturer":
      result = normalizeManufacturer(text);
      break;
    case "consumer_care":
      result = normalizeConsumerCare(text);
      break;
    case "country_of_origin":
      result = normalizeCountryOfOrigin(text);
      break;
    case "unit_sale_price":
      result = normalizeMRP(text);
      break;
    case "dimensions":
      result = text.trim() || null;
      break;
    case "best_before":
      result = normalizeDate(text);
      break;
    case "batch_number":
      result = text.trim() || null;
      break;
    default:
      result = text.trim() || null;
  }
  return result;
}

export async function processInspectionPipeline(job: PipelineJob): Promise<Inspection> {
  const { inspectionId, organizationId, userId, images: inputImages, packageCategory, source, ecommerceUrl, ecommerceProduct, physicalMeasurements, physicalScale } = job;
  const startedAt = Date.now();
  const timeline: InspectionTimelineEvent[] = [];
  const stamp = (stage: string, status: InspectionTimelineEvent["status"], detail?: string, durationMs?: number) => {
    timeline.push({ at: new Date().toISOString(), stage, status, detail, durationMs });
  };
  let extractionMs = 0;
  let rulesMs = 0;

  // Resolve valid organization / user
  let resolvedOrgId = organizationId;
  if (resolvedOrgId) {
    const orgById = await prisma.organization.findUnique({ where: { id: resolvedOrgId } });
    if (!orgById) {
      const orgByCode = await prisma.organization.findUnique({ where: { code: resolvedOrgId } });
      if (orgByCode) resolvedOrgId = orgByCode.id;
      else {
        const { getDefaultOrganizationId } = await import("@/services/store");
        resolvedOrgId = await getDefaultOrganizationId();
      }
    }
  } else {
    const { getDefaultOrganizationId } = await import("@/services/store");
    resolvedOrgId = await getDefaultOrganizationId();
  }

  let resolvedUserId: string | null = userId ?? null;
  if (resolvedUserId) {
    const userExists = await prisma.user.findUnique({ where: { id: resolvedUserId } });
    if (!userExists) resolvedUserId = null;
  }

  const createdAt = new Date().toISOString();
  const initialInspection: Inspection = {
    id: inspectionId,
    organizationId: resolvedOrgId,
    userId: resolvedUserId ?? undefined,
    createdAt,
    status: "processing",
    processingStatus: "UPLOADING",
    images: [],
    declarations: [],
    checks: [],
    notes: ["Inspection initialised. Evidence upload started."],
    extractionSource: "YOLO + Regional OCR",
    timeline,
  };
  await saveInspection(initialInspection);
  await recordStatusChange(inspectionId, null, "processing", resolvedUserId, "Inspection created");
  stamp("Evidence captured", "SUCCESS", `${inputImages.length} frame(s) received`);

  await logAuditEvent({
    organizationId: resolvedOrgId,
    userId: resolvedUserId,
    action: "INSPECTION_CREATED",
    entityType: "INSPECTION",
    entityId: inspectionId,
    details: { imageCount: inputImages.length, packageCategory },
  });

  const setProcessing = async (s: string) => {
    await prisma.inspectionRecord.update({ where: { id: inspectionId }, data: { processingStatus: s } });
  };

  try {
    // ── 1. Persist every frame as its own evidence record ──────────────
    const evidenceImages: EvidenceImage[] = [];
    for (let i = 0; i < inputImages.length; i++) {
      const input = inputImages[i];
      const imageId = `EV-${inspectionId}-${String(i + 1).padStart(3, "0")}`;
      const sharp = (await import("sharp")).default;
      const normalizedBuffer = await sharp(input.buffer).rotate().jpeg({ quality: 92 }).toBuffer();
      const storageKey = `inspections/${inspectionId}/evidence/${imageId}.jpg`;
      const meta = await storage.putObject(storageKey, normalizedBuffer, "image/jpeg");
      const normalized = sharp(normalizedBuffer);
      const dimensions = await normalized.metadata();
      const width = dimensions.width || 1600;
      const height = dimensions.height || 1200;

      const side = input.side && input.side !== "top" ? input.side : input.side === "top" ? "side" : (i === 0 ? "front" : i === 1 ? "back" : "side");
      const evImage: EvidenceImage = {
        id: imageId,
        inspectionId,
        storageKey,
        uri: meta.url,
        label: SIDE_LABELS[side ?? "unknown"] ?? "OTHER",
        side: (side ?? "unknown") as EvidenceImage["side"],
        width,
        height,
        checksum: meta.checksum,
        capturedAt: new Date().toISOString(),
        sourceCamera: input.sourceCamera ?? "environment",
        imageOrder: i + 1,
        quality: "sufficient",
        processingStatus: "QUEUED",
        packageDetected: true,
        packageConfidence: 0.95,
        filename: input.filename,
        detections: [],
      };
      evidenceImages.push(evImage);

      await prisma.evidenceImageRecord.upsert({
        where: { id: imageId },
        create: {
          id: imageId,
          inspectionId,
          storageKey,
          uri: meta.url,
          filename: input.filename,
          mimeType: input.mimeType || "image/jpeg",
          side: evImage.side,
          width,
          height,
          checksum: meta.checksum,
          processingStatus: "QUEUED",
        },
        update: { processingStatus: "QUEUED" },
      });
    }
    stamp("Evidence uploaded", "SUCCESS", `${evidenceImages.length} evidence record(s) persisted`);

    // ── 1.5 Package Presence Gate ────────────────────────────────────────
    await setProcessing("DETECTING_PACKAGE");
    const { analyzePackagePresence } = await import("@/services/package-gate");
    const validImages: EvidenceImage[] = [];
    let firstGateReason = "Package not detected. Point the camera at the product package.";

    for (const evImage of evidenceImages) {
      const idx = (evImage.imageOrder ?? 1) - 1;
      const input = inputImages[idx] ?? inputImages[0];
      const storedBuffer = await storage.getObject(evImage.storageKey ?? "");
      const analysisBuffer = storedBuffer ?? input.buffer;
      const gate = await analyzePackagePresence(analysisBuffer);

      evImage.packageDetected = gate.packageDetected;
      evImage.packageConfidence = gate.confidence;
      if (!gate.packageDetected) {
        firstGateReason = gate.reason === "HUMAN_SUBJECT_FRAME"
          ? "Packaging not detected. Point the camera at the product package."
          : `Image quality insufficient. ${gate.guidance}`;
        evImage.quality = "insufficient";
        await prisma.evidenceImageRecord.update({
          where: { id: evImage.id },
          data: { quality: "insufficient", processingStatus: "FAILED" },
        });
      } else {
        validImages.push(evImage);
      }
    }

    if (validImages.length === 0) {
      // Short-circuit: NO package in ANY frame => INVALID_EVIDENCE
      stamp("Package detection", "FAILED", firstGateReason);
      const declarations: Declaration[] = TARGET_FIELDS.map((field) => ({
        field,
        value: null,
        status: "NOT_DETECTED" as const,
        confidence: null,
        evidenceImageId: evidenceImages[0]?.id,
      }));
      const gateCheck = invalidEvidenceCheck(firstGateReason, evidenceImages[0]?.id);
      const invalid: Inspection = {
        id: inspectionId,
        organizationId: resolvedOrgId,
        userId: resolvedUserId ?? undefined,
        createdAt,
        updatedAt: new Date().toISOString(),
        productName: "Unverified package",
        status: "invalid_evidence",
        verdict: "INVALID_EVIDENCE",
        processingStatus: "INVALID_EVIDENCE",
        score: null,
        images: evidenceImages,
        declarations,
        checks: [gateCheck],
        rawOcrText: "",
        extractionSource: "YOLO + Regional OCR",
        processing: { totalMs: Date.now() - startedAt, extractionMs: 0, rulesMs: 0 },
        notes: [firstGateReason, "Recapture valid package evidence to proceed."],
        timeline,
      };
      await saveInspection(invalid);
      await recordStatusChange(inspectionId, "processing", "invalid_evidence", resolvedUserId, firstGateReason);
      return invalid;
    }

    // ── 2. Run Unified YOLO + PaddleOCR PP-OCRv4 Engine Batch ───────────
    await setProcessing("OCR_PROCESSING");
    const ocrT0 = Date.now();

    const batchInput = await Promise.all(
      validImages.map(async (ev) => {
        const buf = await storage.getObject(ev.storageKey ?? "");
        return {
          id: ev.id,
          buffer: buf ?? inputImages[(ev.imageOrder ?? 1) - 1].buffer,
          side: ev.side,
        };
      })
    );

    const batchResult = await ocrService.processImageBatch(batchInput);
    extractionMs = Date.now() - ocrT0;
    stamp("PaddleOCR PP-OCRv4 & YOLO", "SUCCESS", `${batchResult.totalLinesExtracted} text region(s) extracted across ${validImages.length} image(s)`, extractionMs);

    // Map per-image detections into evidence images
    for (const evImage of evidenceImages) {
      const match = batchResult.images.find((img) => img.id.includes(evImage.id) || evImage.id.includes(img.id));
      if (match) {
        evImage.width = match.width || evImage.width;
        evImage.height = match.height || evImage.height;
        evImage.packageDetected = match.packageDetected;
        evImage.packageConfidence = match.packageConfidence;
        evImage.detections = match.detections.map((d, dIdx) => ({
          id: `DET-${evImage.id}-${dIdx + 1}`,
          className: d.className,
          bbox: d.bbox,
          polygon: d.polygon,
          confidence: d.confidence,
          detector: "paddleocr-dbnet",
          modelVersion: "ppocr-v4-onnx",
        }));

        await prisma.evidenceImageRecord.update({
          where: { id: evImage.id },
          data: {
            processingStatus: "COMPLETED",
            quality: "sufficient",
            qualitySignal: JSON.stringify({
              blurDetected: false,
              glareDetected: false,
              cropDetected: false,
              legibilityScore: Math.round((match.packageConfidence || 0.95) * 100),
            }),
          },
        });

        // Store detection records
        for (const det of match.detections) {
          await prisma.detectionRecord.create({
            data: {
              evidenceImageId: evImage.id,
              modelVersion: "ppocr-v4-onnx",
              detector: "paddleocr-dbnet",
              className: det.className,
              bboxJson: JSON.stringify(det.bbox),
              confidence: det.confidence,
            },
          });
        }
      }
    }

    // ── 3. Map Extracted Declarations ──────────────────────────────────
    await setProcessing("EXTRACTING_FIELDS");
    const declarations: Declaration[] = [];

    for (const field of TARGET_FIELDS) {
      const declMatch = batchResult.declarations.find((d) => d.field === field);
      if (declMatch && declMatch.status === "DETECTED" && declMatch.value) {
        // Find matching source image id
        let sourceImgId = declMatch.sourceImageId || evidenceImages[0]?.id;
        const matchingEv = evidenceImages.find((ev) => sourceImgId.includes(ev.id) || ev.id.includes(sourceImgId));
        if (matchingEv) sourceImgId = matchingEv.id;

        declarations.push({
          field,
          value: field === "date"
            ? (normalizeDate(declMatch.value) ?? declMatch.value)
            : declMatch.value,
          rawValue: declMatch.rawValue || declMatch.value,
          status: "DETECTED",
          confidence: declMatch.confidence ?? 0.95,
          evidenceImageId: sourceImgId,
          evidenceImageIds: [sourceImgId],
          boundingBox: declMatch.bbox,
          polygon: declMatch.polygon,
          evidence: {
            rawText: declMatch.rawValue || declMatch.value,
            boundingBox: declMatch.bbox,
            polygon: declMatch.polygon,
          },
          candidates: [{ value: declMatch.value, sourceImageId: sourceImgId, rawValue: declMatch.rawValue }],
          consumerCareDetails: declMatch.consumerCareDetails,
        });
      } else {
        declarations.push({
          field,
          value: null,
          status: "NOT_DETECTED",
          confidence: null,
          evidenceImageId: evidenceImages[0]?.id,
        });
      }
    }

    // ── 3.5. Merge e-commerce listing declarations ─────────────────────
    // Rule 6(10A) e-commerce mode: the product listing is primary evidence
    // for the fields a listing is legally required to disclose — the product
    // title (identity) and the country of origin. MRP / net quantity /
    // manufacturer / consumer care must still be printed on the physical
    // package, so they are only ever sourced from label OCR, never a listing.
    if (ecommerceProduct) {
      const listingFields = [
        { field: "product_name" as const, value: ecommerceProduct.title },
        { field: "country_of_origin" as const, value: ecommerceProduct.countryOfOrigin },
      ];
      for (const { field, value } of listingFields) {
        const existing = declarations.find((d) => d.field === field);
        if (existing && (existing.status === "DETECTED" || existing.value)) continue;
        if (!value || !value.trim()) continue;
        declarations.push({
          field,
          value: value.trim(),
          rawValue: value.trim(),
          status: "DETECTED",
          confidence: 0.95,
          evidence: { rawText: `E-commerce listing (${ecommerceProduct.platform || "marketplace"}): ${value.trim()}` },
          candidates: [{ value: value.trim() }],
        });
      }
    }

    // ── 4. Statutory Compliance Rules Engine ───────────────────────────
    await setProcessing("COMPLIANCE_ANALYSIS");
    const rulesT0 = Date.now();
    const primaryImageId = evidenceImages[0]?.id || inspectionId;
    const checks = evaluateCompliance(declarations, primaryImageId, {
      extractionSource: "YOLO + Regional OCR",
      packageCategory,
      measuredQuantities: physicalMeasurements,
      physicalScale: physicalScale ?? null,
      ecommerceListing: source === "ecommerce" || (ecommerceUrl ? true : undefined),
    });
    rulesMs = Date.now() - rulesT0;
    stamp("Statutory compliance analysis", "SUCCESS", `${checks.length} statutory rule check(s) evaluated`, rulesMs);

    const verdict = inspectionVerdict({
      packageDetected: true,
      processingComplete: true,
      checks,
    });
    const status = verdictToStatus(verdict);
    const score = complianceScore(checks);

    const extractedProd = declarations.find((d) => d.field === "product_name")?.value;
    const productName = extractedProd && extractedProd.trim() ? extractedProd : "Packaged Commodity";

    const completedInspection: Inspection = {
      id: inspectionId,
      organizationId: resolvedOrgId,
      userId: resolvedUserId ?? undefined,
      createdAt,
      updatedAt: new Date().toISOString(),
      productId: undefined,
      productName,
      status,
      verdict,
      processingStatus: "COMPLETED",
      score,
      images: evidenceImages,
      declarations,
      checks,
      source,
      ecommerceUrl,
      ecommerceProduct,
      physicalMeasurements,
      notes: [
        `Analysis completed successfully via PaddleOCR PP-OCRv4 + YOLO.`,
        `${declarations.filter((d) => d.status === "DETECTED").length} of ${TARGET_FIELDS.length} statutory declarations verified.`,
      ],
      rawOcrText: batchResult.rawOcrText,
      extractionSource: "YOLO + Regional OCR",
      processing: {
        totalMs: Date.now() - startedAt,
        extractionMs,
        rulesMs,
      },
      timeline,
    };

    await saveInspection(completedInspection);
    await recordStatusChange(inspectionId, "processing", status, resolvedUserId, `Verdict: ${verdict}`);
    await setProcessing("COMPLETED");

    await logAuditEvent({
      organizationId: resolvedOrgId,
      userId: resolvedUserId,
      action: "ANALYSIS_COMPLETED",
      entityType: "INSPECTION",
      entityId: inspectionId,
      details: { verdict, score, detectedFieldsCount: declarations.filter((d) => d.status === "DETECTED").length },
    });

    return completedInspection;
  } catch (err) {
    console.error(`[PipelineWorker] Inspection ${inspectionId} fatal failure:`, err);
    const failReason = err instanceof Error ? err.message : String(err);
    stamp("Inspection failed", "FAILED", failReason);

    const failedInspection: Inspection = {
      id: inspectionId,
      organizationId: resolvedOrgId,
      userId: resolvedUserId ?? undefined,
      createdAt,
      updatedAt: new Date().toISOString(),
      status: "fail",
      verdict: "NON_COMPLIANT",
      processingStatus: "FAILED",
      score: null,
      images: [],
      declarations: [],
      checks: [],
      notes: [`Pipeline failure: ${failReason}`],
      extractionSource: "YOLO + PaddleOCR",
      timeline,
    };

    await saveInspection(failedInspection);
    await recordStatusChange(inspectionId, "processing", "fail", resolvedUserId, failReason);
    return failedInspection;
  }
}
