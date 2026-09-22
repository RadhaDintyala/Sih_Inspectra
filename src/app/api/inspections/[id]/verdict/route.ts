import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getInspection, recordStatusChange, saveInspection } from "@/services/store";
import { getSessionFromRequest } from "@/services/auth";
import { logAuditEvent } from "@/services/audit";

const verdictSchema = z.object({
  decision: z.enum(["APPROVE", "REJECT"]),
  rationale: z.string().min(1, "Rationale/notes required for final verdict decision."),
});

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

    const roleUpper = (session.role || "").toUpperCase();
    if (roleUpper !== "ADMIN" && roleUpper !== "REVIEWER") {
      return NextResponse.json({ error: "Forbidden: Reviewer or Admin permissions required for final verdict decision." }, { status: 403 });
    }

    const body = await request.json();
    const parsed = verdictSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request payload.", details: parsed.error.issues }, { status: 400 });
    }

    const { decision, rationale } = parsed.data;

    const inspection = await getInspection(id);
    if (!inspection) {
      return NextResponse.json({ error: `Inspection "${id}" not found.` }, { status: 404 });
    }

    const prevStatus = inspection.status;
    const isApproved = decision === "APPROVE";
    const newStatus = isApproved ? "pass" : "fail";
    const newVerdict = isApproved ? "COMPLIANT" : "NON_COMPLIANT";

    const updatedInspection = {
      ...inspection,
      status: newStatus as any,
      verdict: newVerdict as any,
      notes: [...(inspection.notes || []), `[${new Date().toLocaleDateString("en-IN")}] Verdict ${decision} by Reviewer @${session.username}: ${rationale}`],
      updatedAt: new Date().toISOString(),
    };

    await saveInspection(updatedInspection);
    await recordStatusChange(id, prevStatus, newStatus, session.id, `Reviewer verdict decision (${decision}): ${rationale}`);

    await logAuditEvent({
      organizationId: session.organizationId,
      userId: session.id,
      action: isApproved ? "VERDICT_APPROVED" : "VERDICT_REJECTED",
      entityType: "INSPECTION",
      entityId: id,
      details: {
        decision,
        rationale,
        reviewerUsername: session.username,
        reviewerName: session.name,
        previousStatus: prevStatus,
        newStatus,
        newVerdict,
      },
    });

    const refreshed = await getInspection(id);

    return NextResponse.json({
      success: true,
      message: `Inspection "${id}" decision recorded as ${decision}.`,
      inspection: refreshed,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
