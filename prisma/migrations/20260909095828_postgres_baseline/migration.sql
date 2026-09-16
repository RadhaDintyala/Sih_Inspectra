-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "jurisdiction" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "badgeNumber" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InspectionRecord" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT,
    "createdAt" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "productId" TEXT,
    "productName" TEXT,
    "status" TEXT NOT NULL,
    "processingStatus" TEXT NOT NULL DEFAULT 'COMPLETED',
    "score" INTEGER,
    "rawOcrText" TEXT,
    "extractionSource" TEXT,
    "notesJson" TEXT NOT NULL DEFAULT '[]',
    "sourceDocIdsJson" TEXT,
    "processingJson" TEXT,

    CONSTRAINT "InspectionRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvidenceImageRecord" (
    "id" TEXT NOT NULL,
    "inspectionId" TEXT NOT NULL,
    "storageKey" TEXT,
    "uri" TEXT NOT NULL,
    "filename" TEXT,
    "mimeType" TEXT,
    "side" TEXT,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "checksum" TEXT,
    "quality" TEXT,
    "qualitySignal" TEXT,
    "processingStatus" TEXT NOT NULL DEFAULT 'COMPLETED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvidenceImageRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DetectionRecord" (
    "id" TEXT NOT NULL,
    "evidenceImageId" TEXT NOT NULL,
    "modelVersion" TEXT NOT NULL DEFAULT 'yolo-v8-packaging-v1.0',
    "detector" TEXT NOT NULL DEFAULT 'ocr-layout',
    "className" TEXT NOT NULL,
    "bboxJson" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DetectionRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OcrRecord" (
    "id" TEXT NOT NULL,
    "evidenceImageId" TEXT NOT NULL,
    "detectionId" TEXT,
    "engine" TEXT NOT NULL DEFAULT 'Tesseract-WASM',
    "modelVersion" TEXT NOT NULL DEFAULT 'eng-v1',
    "rawText" TEXT NOT NULL,
    "normalizedText" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL,
    "processingPass" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OcrRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeclarationRecord" (
    "id" TEXT NOT NULL,
    "inspectionId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "value" TEXT,
    "rawValue" TEXT,
    "normalizedValue" TEXT,
    "status" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION,
    "evidenceImageId" TEXT,
    "evidenceImgIds" TEXT,
    "candidates" TEXT,
    "evidenceJson" TEXT,
    "boundingBox" TEXT,
    "sourceSide" TEXT,
    "conflict" BOOLEAN,
    "consumerCareJson" TEXT,

    CONSTRAINT "DeclarationRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComplianceCheckRecord" (
    "id" TEXT NOT NULL,
    "inspectionId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'major',
    "evidence" TEXT,
    "explanation" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION,
    "evidenceImageId" TEXT,
    "boundingBox" TEXT,
    "sourceDocument" TEXT,
    "sourceUrl" TEXT,
    "sourceSection" TEXT,

    CONSTRAINT "ComplianceCheckRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComplianceRule" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "requirement" TEXT NOT NULL,
    "referenceSection" TEXT NOT NULL,
    "sourceDocument" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "version" TEXT NOT NULL DEFAULT '2011.1',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComplianceRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportRecord" (
    "id" TEXT NOT NULL,
    "inspectionId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "generatedById" TEXT,
    "reportDataJson" TEXT NOT NULL,
    "pdfStorageKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "detailsJson" TEXT NOT NULL DEFAULT '{}',
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InspectionStatusHistory" (
    "id" TEXT NOT NULL,
    "inspectionId" TEXT NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT NOT NULL,
    "changedById" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InspectionStatusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Organization_code_key" ON "Organization"("code");

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE INDEX "User_organizationId_idx" ON "User"("organizationId");

-- CreateIndex
CREATE INDEX "InspectionRecord_organizationId_createdAt_idx" ON "InspectionRecord"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "InspectionRecord_organizationId_status_idx" ON "InspectionRecord"("organizationId", "status");

-- CreateIndex
CREATE INDEX "InspectionRecord_userId_idx" ON "InspectionRecord"("userId");

-- CreateIndex
CREATE INDEX "EvidenceImageRecord_inspectionId_idx" ON "EvidenceImageRecord"("inspectionId");

-- CreateIndex
CREATE INDEX "EvidenceImageRecord_processingStatus_idx" ON "EvidenceImageRecord"("processingStatus");

-- CreateIndex
CREATE INDEX "DetectionRecord_evidenceImageId_idx" ON "DetectionRecord"("evidenceImageId");

-- CreateIndex
CREATE INDEX "DetectionRecord_className_idx" ON "DetectionRecord"("className");

-- CreateIndex
CREATE INDEX "OcrRecord_evidenceImageId_idx" ON "OcrRecord"("evidenceImageId");

-- CreateIndex
CREATE INDEX "DeclarationRecord_inspectionId_idx" ON "DeclarationRecord"("inspectionId");

-- CreateIndex
CREATE INDEX "DeclarationRecord_field_idx" ON "DeclarationRecord"("field");

-- CreateIndex
CREATE INDEX "ComplianceCheckRecord_inspectionId_idx" ON "ComplianceCheckRecord"("inspectionId");

-- CreateIndex
CREATE INDEX "ComplianceCheckRecord_ruleId_status_idx" ON "ComplianceCheckRecord"("ruleId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ComplianceRule_ruleId_key" ON "ComplianceRule"("ruleId");

-- CreateIndex
CREATE INDEX "ReportRecord_inspectionId_idx" ON "ReportRecord"("inspectionId");

-- CreateIndex
CREATE INDEX "ReportRecord_organizationId_idx" ON "ReportRecord"("organizationId");

-- CreateIndex
CREATE INDEX "AuditLog_organizationId_timestamp_idx" ON "AuditLog"("organizationId", "timestamp");

-- CreateIndex
CREATE INDEX "AuditLog_entityId_idx" ON "AuditLog"("entityId");

-- CreateIndex
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");

-- CreateIndex
CREATE INDEX "InspectionStatusHistory_inspectionId_createdAt_idx" ON "InspectionStatusHistory"("inspectionId", "createdAt");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InspectionRecord" ADD CONSTRAINT "InspectionRecord_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InspectionRecord" ADD CONSTRAINT "InspectionRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceImageRecord" ADD CONSTRAINT "EvidenceImageRecord_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "InspectionRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DetectionRecord" ADD CONSTRAINT "DetectionRecord_evidenceImageId_fkey" FOREIGN KEY ("evidenceImageId") REFERENCES "EvidenceImageRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OcrRecord" ADD CONSTRAINT "OcrRecord_evidenceImageId_fkey" FOREIGN KEY ("evidenceImageId") REFERENCES "EvidenceImageRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OcrRecord" ADD CONSTRAINT "OcrRecord_detectionId_fkey" FOREIGN KEY ("detectionId") REFERENCES "DetectionRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeclarationRecord" ADD CONSTRAINT "DeclarationRecord_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "InspectionRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceCheckRecord" ADD CONSTRAINT "ComplianceCheckRecord_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "InspectionRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportRecord" ADD CONSTRAINT "ReportRecord_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "InspectionRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportRecord" ADD CONSTRAINT "ReportRecord_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportRecord" ADD CONSTRAINT "ReportRecord_generatedById_fkey" FOREIGN KEY ("generatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InspectionStatusHistory" ADD CONSTRAINT "InspectionStatusHistory_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "InspectionRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InspectionStatusHistory" ADD CONSTRAINT "InspectionStatusHistory_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
