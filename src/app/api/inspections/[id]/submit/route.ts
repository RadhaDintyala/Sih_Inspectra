import { NextRequest, NextResponse } from "next/server";
import { getInspection, recordStatusChange, saveInspection } from "@/services/store";
import { getSessionFromRequest } from "@/services/auth";
import { logAuditEvent } from "@/services/audit";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = await getSessionFromRequest(request);

    if (!session) {
      return NextResponse.json({ error: "Unauthorized: Active session required." }, { status: 401 });
    }

    const inspection = await getInspection(id);
    if (!inspection) {
      return NextResponse.json({ error: `Inspection "${id}" not found.` }, { status: 404 });
    }

    const prevStatus = inspection.status;
    const updatedInspection = {
      ...inspection,
      status: "review" as const,
      processingStatus: "REVIEW_REQUIRED" as const,
      updatedAt: new Date().toISOString(),
    };

    await saveInspection(updatedInspection);
    await recordStatusChange(id, prevStatus, "review", session.id, "Submitted by officer for reviewer verification");

    await logAuditEvent({
      organizationId: session.organizationId,
      userId: session.id,
      action: "INSPECTION_SUBMITTED",
      entityType: "INSPECTION",
      entityId: id,
      details: {
        submittedBy: session.username,
        badgeNumber: session.badgeNumber,
        previousStatus: prevStatus,
        newStatus: "review",
      },
    });

    const refreshed = await getInspection(id);

    return NextResponse.json({
      success: true,
      message: `Inspection "${id}" successfully submitted for reviewer evaluation.`,
      inspection: refreshed,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
