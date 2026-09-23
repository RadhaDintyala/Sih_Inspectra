/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Server-side persistence for inspection records via SQLite/PostgreSQL & Prisma ORM.
 * Multi-tenant, role-gated, evidence-backed repository.
 */

import { PrismaClient } from "@prisma/client";
import fs from "fs";
import path from "path";
import type { Inspection, InspectionStatus, EvidenceImage, ComplianceCheck, PhysicalMeasurement, DeclarationField } from "@/domain/inspection";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

let defaultOrgId: string | null = null;

export async function getDefaultOrganizationId(): Promise<string> {
  if (defaultOrgId) return defaultOrgId;
  const org = await prisma.organization.findFirst({
    orderBy: { createdAt: "asc" },
  });
  if (org) {
    defaultOrgId = org.id;
    return org.id;
  }
  const created = await prisma.organization.create({
    data: {
      code: "ORG-LM-DEFAULT",
      name: "Legal Metrology Enforcement Authority",
      jurisdiction: "All Jurisdictions",
    },
  });
  defaultOrgId = created.id;
  return created.id;
}

function mapRecordToInspection(record: any): Inspection {
  const processing = record.processingJson ? JSON.parse(record.processingJson) : undefined;
  const physicalMeasurements = record.physicalMeasurementsJson
    ? JSON.parse(record.physicalMeasurementsJson)
    : undefined;
  const ecommerceProduct = record.ecommerceJson ? JSON.parse(record.ecommerceJson) : undefined;
  return {
    id: record.id,
    organizationId: record.organizationId,
    userId: record.userId ?? undefined,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt ? new Date(record.updatedAt).toISOString() : undefined,
    productId: record.productId ?? undefined,
    productName: record.productName ?? undefined,
    status: record.status as InspectionStatus,
    verdict: (record.verdict as Inspection["verdict"]) ?? undefined,
    processingStatus: record.processingStatus as any,
    score: record.score ?? null,
    rawOcrText: record.rawOcrText ?? undefined,
    extractionSource: record.extractionSource ?? undefined,
    source: record.source ?? undefined,
    ecommerceUrl: record.ecommerceUrl ?? undefined,
    ecommerceProduct: ecommerceProduct ?? undefined,
    physicalMeasurements: physicalMeasurements ?? undefined,
    notes: record.notesJson ? JSON.parse(record.notesJson) : [],
    sourceDocumentIds: record.sourceDocIdsJson ? JSON.parse(record.sourceDocIdsJson) : undefined,
    processing: processing ? { totalMs: processing.totalMs ?? 0, extractionMs: processing.extractionMs ?? 0, rulesMs: processing.rulesMs ?? 0 } : undefined,
    timeline: processing?.timeline,
    images: (record.images || []).map((img: any) => ({
      id: img.id,
      inspectionId: record.id,
      storageKey: img.storageKey ?? undefined,
      uri: img.uri,
      label: img.side ? ({ front: "FRONT", back: "BACK", side: "SIDE" } as Record<string, string>)[img.side] ?? "OTHER" : undefined,
      side: img.side ?? undefined,
      width: img.width,
      height: img.height,
      checksum: img.checksum ?? undefined,
      quality: img.quality ?? undefined,
      qualitySignal: img.qualitySignal ? JSON.parse(img.qualitySignal) : undefined,
      processingStatus: img.processingStatus ?? undefined,
      filename: img.filename ?? undefined,
      detections: (img.detections || []).map((d: any) => ({
        id: d.id,
        className: d.className,
        bbox: JSON.parse(d.bboxJson),
        confidence: d.confidence,
        detector: d.detector,
        modelVersion: d.modelVersion,
      })),
    })),
    declarations: (record.declarations || []).map((dec: any) => ({
      field: dec.field,
      value: dec.value ?? null,
      rawValue: dec.rawValue ?? undefined,
      status: dec.status,
      confidence: dec.confidence ?? null,
      evidenceImageId: dec.evidenceImageId ?? undefined,
      evidenceImageIds: dec.evidenceImgIds ? JSON.parse(dec.evidenceImgIds) : undefined,
      candidates: dec.candidates ? JSON.parse(dec.candidates) : undefined,
      evidence: dec.evidenceJson ? JSON.parse(dec.evidenceJson) : undefined,
      boundingBox: dec.boundingBox ? JSON.parse(dec.boundingBox) : undefined,
      polygon: dec.polygonJson ? JSON.parse(dec.polygonJson) : undefined,
      sourceSide: dec.sourceSide ?? undefined,
      conflict: dec.conflict ?? undefined,
      consumerCareDetails: dec.consumerCareJson ? JSON.parse(dec.consumerCareJson) : undefined,
      legalRules: dec.legalRulesJson ? JSON.parse(dec.legalRulesJson) : undefined,
    })),
    checks: (record.checks || []).map((chk: any) => ({
      ruleId: chk.ruleId,
      field: chk.field,
      status: chk.status,
      severity: chk.severity ?? undefined,
      validationType: chk.validationType ?? undefined,
      evidence: chk.evidence ?? undefined,
      explanation: chk.explanation,
      confidence: chk.confidence ?? undefined,
      evidenceImageId: chk.evidenceImageId ?? undefined,
      boundingBox: chk.boundingBox ? JSON.parse(chk.boundingBox) : undefined,
      polygon: chk.polygonJson ? JSON.parse(chk.polygonJson) : undefined,
      sourceDocument: chk.sourceDocument ?? undefined,
      sourceUrl: chk.sourceUrl ?? undefined,
      sourceSection: chk.sourceSection ?? undefined,
      officerVerification: chk.officerVerification ?? undefined,
      officerNote: chk.officerNote ?? undefined,
    })),
  };
}

/**
 * Append-only inspection state transition. The state machine is explicit:
 * processing → pass | fail | review | invalid_evidence | incomplete.
 */
export async function recordStatusChange(
  inspectionId: string,
  fromStatus: string | null,
  toStatus: string,
  changedById?: string | null,
  reason?: string
): Promise<void> {
  try {
    await prisma.inspectionStatusHistory.create({
      data: {
        inspectionId,
        fromStatus,
        toStatus,
        changedById: changedById ?? null,
        reason: reason ?? null,
      },
    });
  } catch (err) {
    console.warn("[Store] status history write skipped:", err instanceof Error ? err.message : String(err));
  }
}

export async function saveInspection(inspection: Inspection): Promise<Inspection> {
  const {
    id,
    createdAt,
    productId,
    productName,
    status,
    processingStatus,
    score,
    rawOcrText,
    extractionSource,
    notes,
    sourceDocumentIds,
    processing,
    images,
    declarations,
    checks,
  } = inspection;
  const verdict = (inspection as Inspection).verdict ?? null;
  const timeline = (inspection as Inspection).timeline ?? null;
  const source = (inspection as Inspection).source ?? null;
  const ecommerceUrl = (inspection as Inspection).ecommerceUrl ?? null;
  const ecommerceProduct = (inspection as Inspection).ecommerceProduct ?? null;
  const physicalMeasurements = (inspection as Inspection).physicalMeasurements ?? null;
  const processingPayload = processing || timeline ? JSON.stringify({ ...(processing ?? {}), ...(timeline ? { timeline } : {}) }) : null;

  // Resolve valid organization ID (supports code like "ORG-LM-DELHI" or UUID id)
  let orgId = inspection.organizationId;
  if (orgId) {
    const orgById = await prisma.organization.findUnique({ where: { id: orgId } });
    if (!orgById) {
      const orgByCode = await prisma.organization.findUnique({ where: { code: orgId } });
      if (orgByCode) {
        orgId = orgByCode.id;
      } else {
        orgId = await getDefaultOrganizationId();
      }
    }
  } else {
    orgId = await getDefaultOrganizationId();
  }

  // Verify userId exists in User table to avoid foreign key violations
  let validUserId: string | null = inspection.userId ?? null;
  if (validUserId) {
    const userExists = await prisma.user.findUnique({ where: { id: validUserId } });
    if (!userExists) {
      validUserId = null;
    }
  }

  await prisma.inspectionRecord.upsert({
    where: { id },
    create: {
      id,
      organizationId: orgId,
      userId: validUserId,
      createdAt,
      productId: productId ?? null,
      productName: productName ?? null,
      status,
      verdict,
      processingStatus: processingStatus || "COMPLETED",
      score: score ?? null,
      rawOcrText: rawOcrText ?? null,
      extractionSource: extractionSource ?? null,
      source: source ?? null,
      ecommerceUrl: ecommerceUrl ?? null,
      ecommerceJson: ecommerceProduct ? JSON.stringify(ecommerceProduct) : null,
      physicalMeasurementsJson: physicalMeasurements ? JSON.stringify(physicalMeasurements) : null,
      notesJson: JSON.stringify(notes ?? []),
      sourceDocIdsJson: sourceDocumentIds ? JSON.stringify(sourceDocumentIds) : null,
      processingJson: processingPayload,
    },
    update: {
      organizationId: orgId,
      userId: validUserId,
      productId: productId ?? null,
      productName: productName ?? null,
      status,
      verdict,
      processingStatus: processingStatus || "COMPLETED",
      score: score ?? null,
      rawOcrText: rawOcrText ?? null,
      extractionSource: extractionSource ?? null,
      source: source ?? null,
      ecommerceUrl: ecommerceUrl ?? null,
      ecommerceJson: ecommerceProduct ? JSON.stringify(ecommerceProduct) : null,
      physicalMeasurementsJson: physicalMeasurements ? JSON.stringify(physicalMeasurements) : null,
      notesJson: JSON.stringify(notes ?? []),
      sourceDocIdsJson: sourceDocumentIds ? JSON.stringify(sourceDocumentIds) : null,
      processingJson: processingPayload,
    },
  });

  // Evidence rows are UPSERTED — never deleted/recreated — because
  // DetectionRecord and OcrRecord rows reference them (ON DELETE CASCADE).
  // A delete+recreate cycle here would silently destroy the visual/OCR
  // audit trail produced by the worker mid-pipeline.
  const keepImageIds = new Set((images ?? []).map((img) => img.id));
  await prisma.evidenceImageRecord.deleteMany({
    where: { inspectionId: id, id: { notIn: [...keepImageIds, "__none__"] } },
  });
  await prisma.declarationRecord.deleteMany({ where: { inspectionId: id } });
  await prisma.complianceCheckRecord.deleteMany({ where: { inspectionId: id } });

  if (images?.length) {
    for (const img of images) {
      const row = {
        inspectionId: id,
        storageKey: (img as EvidenceImage).storageKey ?? null,
        uri: img.uri || `/api/scan/image/${img.id}`,
        filename: img.filename ?? null,
        side: img.side ?? null,
        width: img.width ?? 1280,
        height: img.height ?? 720,
        checksum: (img as EvidenceImage).checksum ?? null,
        quality: img.quality ?? null,
        qualitySignal: img.qualitySignal ? JSON.stringify(img.qualitySignal) : null,
        processingStatus: (img as EvidenceImage).processingStatus ?? "COMPLETED",
      };
      await prisma.evidenceImageRecord.upsert({
        where: { id: img.id },
        create: { id: img.id, ...row },
        update: row,
      });
    }
  }

  if (declarations?.length) {
    await prisma.declarationRecord.createMany({
      data: declarations.map((dec) => ({
        inspectionId: id,
        field: dec.field,
        value: dec.value ?? null,
        rawValue: dec.rawValue ?? null,
        status: dec.status,
        confidence: dec.confidence ?? null,
        evidenceImageId: dec.evidenceImageId ?? null,
        evidenceImgIds: dec.evidenceImageIds ? JSON.stringify(dec.evidenceImageIds) : null,
        candidates: dec.candidates ? JSON.stringify(dec.candidates) : null,
        evidenceJson: dec.evidence ? JSON.stringify(dec.evidence) : null,
        boundingBox: dec.boundingBox ? JSON.stringify(dec.boundingBox) : null,
        polygonJson: dec.polygon ? JSON.stringify(dec.polygon) : null,
        sourceSide: dec.sourceSide ?? null,
        conflict: dec.conflict ?? null,
        consumerCareJson: dec.consumerCareDetails ? JSON.stringify(dec.consumerCareDetails) : null,
        legalRulesJson: dec.legalRules ? JSON.stringify(dec.legalRules) : null,
      })),
    });
  }

  if (checks?.length) {
    await prisma.complianceCheckRecord.createMany({
      data: checks.map((chk) => ({
        inspectionId: id,
        ruleId: chk.ruleId,
        field: chk.field,
        status: chk.status,
        severity: chk.severity ?? "major",
        validationType: (chk as ComplianceCheck & { validationType?: string }).validationType ?? null,
        evidence: chk.evidence ?? null,
        explanation: chk.explanation,
        confidence: chk.confidence ?? null,
        evidenceImageId: chk.evidenceImageId ?? null,
        boundingBox: chk.boundingBox ? JSON.stringify(chk.boundingBox) : null,
        polygonJson: chk.polygon ? JSON.stringify(chk.polygon) : null,
        sourceDocument: chk.sourceDocument ?? null,
        sourceUrl: chk.sourceUrl ?? null,
        sourceSection: chk.sourceSection ?? null,
        officerVerification: chk.officerVerification ?? null,
        officerNote: chk.officerNote ?? null,
      })),
    });
  }

  if (physicalMeasurements?.length) {
    await prisma.physicalMeasurementRecord.deleteMany({ where: { inspectionId: id } });
    await prisma.physicalMeasurementRecord.createMany({
      data: physicalMeasurements.map((m) => ({
        inspectionId: id,
        field: m.field,
        declaredValue: m.declaredValue,
        measuredValue: m.measuredValue ?? "",
        unit: m.unit,
        permissibleError: m.permissibleError ?? null,
        withinTolerance: m.withinTolerance ?? null,
        measuredBy: m.measuredBy ?? null,
        instrumentId: m.instrumentId ?? null,
      })),
    });
  }

  return inspection;
}

export async function getInspection(id: string, orgId?: string): Promise<Inspection | null> {
  const whereClause: Record<string, unknown> = { id };
  if (orgId) {
    whereClause.organizationId = orgId;
  }

  const record = await prisma.inspectionRecord.findFirst({
    where: whereClause,
    include: {
      images: { include: { detections: true } },
      declarations: true,
      checks: true,
    },
  });

  if (!record) return null;
  return mapRecordToInspection(record as unknown as Record<string, unknown>);
}

export async function listInspections(options?: {
  orgId?: string;
  status?: string;
  limit?: number;
  offset?: number;
}): Promise<{ inspections: Inspection[]; total: number }> {
  const where: Record<string, unknown> = {};
  if (options?.orgId) {
    where.organizationId = options.orgId;
  }
  if (options?.status && options.status !== "all") {
    where.status = options.status;
  }

  const [records, total] = await Promise.all([
    prisma.inspectionRecord.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: {
        images: { include: { detections: true } },
        declarations: true,
        checks: true,
      },
      take: options?.limit ?? 50,
      skip: options?.offset ?? 0,
    }),
    prisma.inspectionRecord.count({ where }),
  ]);

  return {
    inspections: records.map((r) => mapRecordToInspection(r as unknown as Record<string, unknown>)),
    total,
  };
}

export async function countInspections(organizationId?: string): Promise<number> {
  const where: Record<string, unknown> = {};
  if (organizationId) where.organizationId = organizationId;
  return prisma.inspectionRecord.count({ where });
}

export async function updateDeclarationOverride(
  inspectionId: string,
  field: string,
  newValue: string,
  reviewerId: string,
  officerOrgId: string,
  rationale?: string
): Promise<Inspection | null> {
  const inspection = await getInspection(inspectionId, officerOrgId);
  if (!inspection) return null;

  const targetDecl = inspection.declarations.find((d) => d.field === field);
  const originalValue = targetDecl?.value || "NOT_DETECTED";

  const declarationRecord = await prisma.declarationRecord.findFirst({ where: { inspectionId, field } });
  const declarationId = declarationRecord?.id ?? `${inspectionId}-${field}`;
  if (declarationRecord) {
    await prisma.declarationRecord.update({
      where: { id: declarationRecord.id },
      data: { value: newValue, status: "VERIFIED", confidence: 1.0, conflict: false },
    });
  } else {
    await prisma.declarationRecord.create({
      data: { id: declarationId, inspectionId, field, value: newValue, status: "VERIFIED", confidence: 1.0, conflict: false },
    });
  }
  await prisma.verificationRecord.create({
    data: {
      declarationId,
      inspectionId,
      officerId: reviewerId,
      originalValue: originalValue === "NOT_DETECTED" ? null : originalValue,
      correctedValue: newValue,
      action: "CORRECTED",
      rationale: rationale || "Officer verification override",
    },
  });

  // Re-evaluate compliance rule for this field
  const updatedDecl = {
    ...targetDecl,
    field: field as DeclarationField,
    value: newValue,
    status: "VERIFIED" as const,
    confidence: 1.0,
  };

  const updatedDeclarations = inspection.declarations.map((d) =>
    d.field === field ? updatedDecl : d
  );

  const { evaluateCompliance, overallStatus, complianceScore, inspectionVerdict, verdictToStatus } = await import("@/domain/rules");
  const newChecks = evaluateCompliance(updatedDeclarations, targetDecl?.evidenceImageId ?? inspection.images.find((image) => image.packageDetected)?.id ?? "manual-review", { extractionSource: "local_offline_ocr" });
  const newVerdict = inspectionVerdict({ packageDetected: true, processingComplete: true, checks: newChecks });
  const newStatus = verdictToStatus(newVerdict);
  void overallStatus;
  const newScore = complianceScore(newChecks);

  const prevStatus = inspection.status;
  await prisma.inspectionRecord.update({
    where: { id: inspectionId },
    data: {
      status: newStatus,
      verdict: newVerdict,
      score: newScore,
    },
  });
  await recordStatusChange(inspectionId, prevStatus, newStatus, reviewerId, `Manual override of ${field}`);

  // Update compliance checks in DB
  await prisma.complianceCheckRecord.deleteMany({ where: { inspectionId } });
  await prisma.complianceCheckRecord.createMany({
    data: newChecks.map((chk) => ({
      inspectionId,
      ruleId: chk.ruleId,
      field: chk.field,
      status: chk.status,
      severity: chk.severity ?? "major",
      validationType: (chk as ComplianceCheck & { validationType?: string }).validationType ?? null,
      evidence: chk.evidence ?? null,
      explanation: chk.explanation,
      confidence: chk.confidence ?? null,
      evidenceImageId: chk.evidenceImageId ?? null,
      boundingBox: chk.boundingBox ? JSON.stringify(chk.boundingBox) : null,
      polygonJson: chk.polygon ? JSON.stringify(chk.polygon) : null,
      sourceDocument: chk.sourceDocument ?? null,
      sourceUrl: chk.sourceUrl ?? null,
      sourceSection: chk.sourceSection ?? null,
      officerVerification: chk.officerVerification ?? null,
      officerNote: chk.officerNote ?? null,
    })),
  });

  // Record audit log
  const { logAuditEvent } = await import("@/services/audit");
  await logAuditEvent({
    organizationId: officerOrgId,
    userId: reviewerId,
    action: "MANUAL_OVERRIDE",
    entityType: "INSPECTION",
    entityId: inspectionId,
    details: {
      field,
      originalValue,
      correctedValue: newValue,
      rationale: rationale || "Officer verification override",
      newStatus,
      newScore,
    },
  });

  return getInspection(inspectionId, officerOrgId);
}

export const IMAGE_STORE_DIR = path.join(process.cwd(), ".scan-store", "images");

export async function submitPhysicalMeasurements(
  inspectionId: string,
  measurements: PhysicalMeasurement[],
  officerId: string,
  officerOrgId: string,
  notes?: string,
): Promise<Inspection | null> {
  const inspection = await getInspection(inspectionId, officerOrgId);
  if (!inspection) return null;

  await prisma.inspectionRecord.update({
    where: { id: inspectionId },
    data: { physicalMeasurementsJson: measurements.length ? JSON.stringify(measurements) : null },
  });
  await prisma.physicalMeasurementRecord.deleteMany({ where: { inspectionId } });
  if (measurements.length) {
    await prisma.physicalMeasurementRecord.createMany({
      data: measurements.map((m) => ({
        inspectionId,
        field: m.field ?? "net_quantity",
        declaredValue: m.declaredValue,
        measuredValue: m.measuredValue ?? "",
        unit: m.unit,
        permissibleError: m.permissibleError ?? "±2%",
        withinTolerance: m.withinTolerance ?? null,
        measuredBy: m.measuredBy || officerId,
        measuredAt: new Date(),
        instrumentId: m.instrumentId ?? null,
        notes: notes ?? null,
      })),
    });
  }

  const {
    evaluateCompliance,
    overallStatus,
    complianceScore,
    inspectionVerdict,
    verdictToStatus,
  } = await import("@/domain/rules");
  const newChecks = evaluateCompliance(inspection.declarations, inspection.images.find((image) => image.packageDetected)?.id ?? "manual-review", {
    extractionSource: inspection.extractionSource ?? "manual_review",
    measuredQuantities: measurements,
  });
  const newVerdict = inspectionVerdict({ packageDetected: true, processingComplete: true, checks: newChecks });
  const newStatus = verdictToStatus(newVerdict);
  void overallStatus;
  const newScore = complianceScore(newChecks);

  const prevStatus = inspection.status;
  await prisma.inspectionRecord.update({
    where: { id: inspectionId },
    data: { status: newStatus, verdict: newVerdict, score: newScore },
  });
  await recordStatusChange(inspectionId, prevStatus, newStatus, officerId, `Officer physical measurement submission`);

  await prisma.complianceCheckRecord.deleteMany({ where: { inspectionId } });
  await prisma.complianceCheckRecord.createMany({
    data: newChecks.map((chk) => ({
      inspectionId,
      ruleId: chk.ruleId,
      field: chk.field,
      status: chk.status,
      severity: chk.severity ?? "major",
      validationType: (chk as ComplianceCheck & { validationType?: string }).validationType ?? null,
      evidence: chk.evidence ?? null,
      explanation: chk.explanation,
      confidence: chk.confidence ?? null,
      evidenceImageId: chk.evidenceImageId ?? null,
      boundingBox: chk.boundingBox ? JSON.stringify(chk.boundingBox) : null,
      polygonJson: chk.polygon ? JSON.stringify(chk.polygon) : null,
      sourceDocument: chk.sourceDocument ?? null,
      sourceUrl: chk.sourceUrl ?? null,
      sourceSection: chk.sourceSection ?? null,
      officerVerification: chk.officerVerification ?? null,
      officerNote: chk.officerNote ?? null,
    })),
  });

  const { logAuditEvent } = await import("@/services/audit");
  await logAuditEvent({
    organizationId: officerOrgId,
    userId: officerId,
    action: "PHYSICAL_MEASUREMENT",
    entityType: "INSPECTION",
    entityId: inspectionId,
    details: { measurements, newStatus, newScore },
  });

  return getInspection(inspectionId, officerOrgId);
}

export async function clearInspectionStore(): Promise<void> {
  try {
    await prisma.ocrRecord.deleteMany();
    await prisma.detectionRecord.deleteMany();
    await prisma.inspectionStatusHistory.deleteMany();
    await prisma.physicalMeasurementRecord.deleteMany();
    await prisma.evidenceImageRecord.deleteMany();
    await prisma.declarationRecord.deleteMany();
    await prisma.complianceCheckRecord.deleteMany();
    await prisma.reportRecord.deleteMany();
    await prisma.inspectionRecord.deleteMany();

    const dir = path.join(process.cwd(), ".scan-store", "images");
    if (fs.existsSync(dir)) {
      const files = fs.readdirSync(dir);
      for (const f of files) {
        try {
          fs.unlinkSync(path.join(dir, f));
        } catch {
          // Ignore individual unlink failures
        }
      }
    }
  } catch (err) {
    console.error("[Store] Error clearing inspection store:", err);
    throw err;
  }
}

export function saveEvidenceImageFile(id: string, buffer: Buffer): string {
  try {
    const dir = path.join(process.cwd(), ".scan-store", "images");
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const cleanId = id.replace(/[^a-zA-Z0-9_-]/g, "_");
    const filePath = path.join(dir, `${cleanId}.jpg`);
    fs.writeFileSync(filePath, buffer);
    return `/api/scan/image/${cleanId}`;
  } catch (err) {
    console.error(`[Store] Failed to save evidence image file ${id}:`, err);
    return `/api/scan/image/${id}`;
  }
}

export function getEvidenceImageFile(id: string): Buffer | null {
  try {
    const dir = path.join(process.cwd(), ".scan-store", "images");
    const cleanId = id.replace(/[^a-zA-Z0-9_-]/g, "_");
    const filePath = path.join(dir, `${cleanId}.jpg`);
    if (fs.existsSync(filePath)) {
      return fs.readFileSync(filePath);
    }
    return null;
  } catch (err) {
    console.error(`[Store] Failed to read evidence image file ${id}:`, err);
    return null;
  }
}

export function deleteEvidenceImageFile(id: string): boolean {
  try {
    const dir = path.join(process.cwd(), ".scan-store", "images");
    const cleanId = id.replace(/[^a-zA-Z0-9_-]/g, "_");
    const filePath = path.join(dir, `${cleanId}.jpg`);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return true;
    }
    return false;
  } catch (err) {
    console.error(`[Store] Failed to delete evidence image file ${id}:`, err);
    return false;
  }
}

export async function deleteInspection(id: string): Promise<boolean> {
  try {
    const record = await prisma.inspectionRecord.findUnique({
      where: { id },
      include: { images: true },
    });
    if (!record) return true;
    if (record.images) {
      for (const img of record.images) {
        deleteEvidenceImageFile(img.id);
      }
    }
    await prisma.ocrRecord.deleteMany({ where: { evidenceImage: { inspectionId: id } } });
    await prisma.detectionRecord.deleteMany({ where: { evidenceImage: { inspectionId: id } } });
    await prisma.inspectionStatusHistory.deleteMany({ where: { inspectionId: id } });
    await prisma.physicalMeasurementRecord.deleteMany({ where: { inspectionId: id } });
    await prisma.evidenceImageRecord.deleteMany({ where: { inspectionId: id } });
    await prisma.declarationRecord.deleteMany({ where: { inspectionId: id } });
    await prisma.complianceCheckRecord.deleteMany({ where: { inspectionId: id } });
    await prisma.reportRecord.deleteMany({ where: { inspectionId: id } });
    await prisma.inspectionRecord.deleteMany({ where: { id } });
    return true;
  } catch (err) {
    console.error(`[Store] Failed to delete inspection ${id}:`, err);
    return false;
  }
}

