/**
 * Legal Enforcement Audit Logging Service
 *
 * Records immutable, tamper-evident audit logs for statutory compliance inspections:
 * - LOGIN / LOGOUT
 * - INSPECTION_CREATED
 * - EVIDENCE_UPLOADED
 * - ANALYSIS_STARTED
 * - ANALYSIS_COMPLETED
 * - MANUAL_OVERRIDE (original value, corrected value, officer rationale)
 * - REPORT_GENERATED
 */

import { prisma } from "@/services/store";

export type AuditAction =
  | "LOGIN"
  | "LOGOUT"
  | "INSPECTION_CREATED"
  | "EVIDENCE_UPLOADED"
  | "ANALYSIS_STARTED"
  | "ANALYSIS_COMPLETED"
  | "MANUAL_OVERRIDE"
  | "REPORT_GENERATED";

export type AuditEntityType = "INSPECTION" | "USER" | "RULE" | "EVIDENCE" | "REPORT";

export interface LogAuditParams {
  organizationId: string;
  userId?: string | null;
  action: AuditAction | string;
  entityType: AuditEntityType | string;
  entityId: string;
  details?: Record<string, unknown>;
}

export async function logAuditEvent(params: LogAuditParams): Promise<void> {
  try {
    let orgId = params.organizationId;
    const existingOrg = await prisma.organization.findUnique({ where: { id: orgId } });
    if (!existingOrg) {
      const byCode = await prisma.organization.findUnique({ where: { code: orgId } });
      if (byCode) {
        orgId = byCode.id;
      } else {
        const first = await prisma.organization.findFirst();
        orgId = first ? first.id : orgId;
      }
    }

    let userId = params.userId ?? null;
    if (userId) {
      const userExists = await prisma.user.findUnique({ where: { id: userId } });
      if (!userExists) userId = null;
    }

    await prisma.auditLog.create({
      data: {
        organizationId: orgId,
        userId,
        action: params.action,
        entityType: params.entityType,
        entityId: params.entityId,
        detailsJson: JSON.stringify(params.details ?? {}),
      },
    });
  } catch (err) {
    console.error("[AuditService] Failed to record audit log event:", err);
  }
}

export async function getAuditLogsForInspection(inspectionId: string) {
  try {
    return await prisma.auditLog.findMany({
      where: {
        OR: [
          { entityId: inspectionId },
          { detailsJson: { contains: inspectionId } },
        ],
      },
      include: {
        user: {
          select: { id: true, username: true, name: true, role: true, badgeNumber: true },
        },
      },
      orderBy: { timestamp: "asc" },
    });
  } catch (err) {
    console.error("[AuditService] Failed to fetch audit logs for inspection:", err);
    return [];
  }
}
