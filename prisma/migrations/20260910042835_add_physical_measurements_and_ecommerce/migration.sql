-- AlterTable
ALTER TABLE "ComplianceCheckRecord" ADD COLUMN     "officerNote" TEXT,
ADD COLUMN     "officerVerification" TEXT,
ADD COLUMN     "polygonJson" TEXT,
ADD COLUMN     "validationType" TEXT;

-- AlterTable
ALTER TABLE "ComplianceRule" ADD COLUMN     "effectiveDate" TEXT,
ADD COLUMN     "ruleNumber" INTEGER,
ADD COLUMN     "subRule" TEXT,
ADD COLUMN     "validationType" TEXT;

-- AlterTable
ALTER TABLE "DeclarationRecord" ADD COLUMN     "legalRulesJson" TEXT,
ADD COLUMN     "polygonJson" TEXT;

-- AlterTable
ALTER TABLE "InspectionRecord" ADD COLUMN     "ecommerceJson" TEXT,
ADD COLUMN     "ecommerceUrl" TEXT,
ADD COLUMN     "manufacturerName" TEXT,
ADD COLUMN     "packageCategory" TEXT,
ADD COLUMN     "physicalMeasurementsJson" TEXT,
ADD COLUMN     "source" TEXT;

-- CreateTable
CREATE TABLE "PhysicalMeasurementRecord" (
    "id" TEXT NOT NULL,
    "inspectionId" TEXT NOT NULL,
    "field" TEXT NOT NULL DEFAULT 'net_quantity',
    "declaredValue" TEXT NOT NULL,
    "measuredValue" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "permissibleError" TEXT,
    "withinTolerance" BOOLEAN,
    "measuredBy" TEXT,
    "measuredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "instrumentId" TEXT,
    "notes" TEXT,

    CONSTRAINT "PhysicalMeasurementRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PhysicalMeasurementRecord_inspectionId_idx" ON "PhysicalMeasurementRecord"("inspectionId");

-- AddForeignKey
ALTER TABLE "PhysicalMeasurementRecord" ADD CONSTRAINT "PhysicalMeasurementRecord_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "InspectionRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;
