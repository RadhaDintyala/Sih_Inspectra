CREATE TABLE "VerificationRecord" (
    "id" TEXT NOT NULL,
    "declarationId" TEXT NOT NULL,
    "inspectionId" TEXT NOT NULL,
    "officerId" TEXT NOT NULL,
    "originalValue" TEXT,
    "correctedValue" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VerificationRecord_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "VerificationRecord_inspectionId_createdAt_idx" ON "VerificationRecord"("inspectionId", "createdAt");
CREATE INDEX "VerificationRecord_declarationId_createdAt_idx" ON "VerificationRecord"("declarationId", "createdAt");

ALTER TABLE "VerificationRecord" ADD CONSTRAINT "VerificationRecord_declarationId_fkey" FOREIGN KEY ("declarationId") REFERENCES "DeclarationRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VerificationRecord" ADD CONSTRAINT "VerificationRecord_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "InspectionRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VerificationRecord" ADD CONSTRAINT "VerificationRecord_officerId_fkey" FOREIGN KEY ("officerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
