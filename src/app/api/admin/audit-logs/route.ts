import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/services/auth";
import { getAllAuditLogs } from "@/services/audit";

export async function GET(request: NextRequest) {
  try {
    const session = await getSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized: Active session required." }, { status: 401 });
    }

    const roleUpper = (session.role || "").toUpperCase();
    if (roleUpper !== "ADMIN") {
      return NextResponse.json({ error: "Forbidden: Admin access required for audit logs." }, { status: 403 });
    }

    const logs = await getAllAuditLogs(150);

    const formattedLogs = logs.map((log) => ({
      id: log.id,
      action: log.action,
      entityType: log.entityType,
      entityId: log.entityId,
      details: log.detailsJson ? JSON.parse(log.detailsJson) : {},
      timestamp: log.timestamp.toISOString(),
      user: log.user ? {
        id: log.user.id,
        name: log.user.name,
        username: log.user.username,
        role: log.user.role,
        badgeNumber: log.user.badgeNumber,
      } : null,
      organization: log.organization ? {
        id: log.organization.id,
        code: log.organization.code,
        name: log.organization.name,
      } : null,
    }));

    return NextResponse.json({
      success: true,
      logs: formattedLogs,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
