import { NextRequest, NextResponse } from "next/server";
import { getInspection, deleteInspection } from "@/services/store";
import { requireAuth, requireAdminRole } from "@/services/auth";
import { getAuditLogsForInspection } from "@/services/audit";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth(request);
    if ("errorResponse" in auth) return auth.errorResponse;
    const session = auth.user;

    const { id } = await params;
    const inspection = await getInspection(id);

    if (!inspection) {
      return NextResponse.json({ error: `Inspection "${id}" not found.` }, { status: 404 });
    }

    // Server-side tenant isolation: cross-organization access is 403.
    // Never rely on frontend filtering; never trust client-supplied org IDs.
    if (session.role?.toUpperCase() !== "ADMIN" && inspection.organizationId !== session.organizationId) {
      return NextResponse.json(
        { error: "Forbidden: You do not have permission to access inspections from another organization." },
        { status: 403 }
      );
    }

    const auditLogs = await getAuditLogsForInspection(id);

    return NextResponse.json({ inspection, auditLogs });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const forbidden = await requireAdminRole(request);
    if (forbidden) return forbidden;

    const { id } = await params;
    const existing = await getInspection(id);
    if (!existing) {
      return NextResponse.json({ error: `Inspection "${id}" not found.` }, { status: 404 });
    }

    await deleteInspection(id);
    return NextResponse.json({ success: true, message: `Inspection ${id} deleted.` });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
