/**
 * /api/scan/[id]
 *
 * GET: Retrieves a stored inspection by ID (authenticated, tenant-isolated).
 *      Also the async polling endpoint: returns the queue job state alongside
 *      the inspection so clients can track QUEUED → PROCESSING → COMPLETED.
 * DELETE: Deletes an inspection record by ID (Admin only).
 */

import { NextRequest, NextResponse } from "next/server";
import { getInspection, deleteInspection } from "@/services/store";
import { requireAuth, requireAdminRole } from "@/services/auth";
import { inspectionQueue } from "@/services/queue";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth(request);
  if ("errorResponse" in auth) return auth.errorResponse;
  const session = auth.user;

  const { id } = await params;
  if (!id || typeof id !== "string") {
    return NextResponse.json({ error: "Missing inspection ID." }, { status: 400 });
  }

  const inspection = await getInspection(id);
  if (!inspection) {
    return NextResponse.json({ error: `Inspection "${id}" not found.` }, { status: 404 });
  }

  // Server-side tenant isolation: cross-organization access is 403.
  if (session.role?.toUpperCase() !== "ADMIN" && inspection.organizationId !== session.organizationId) {
    return NextResponse.json(
      { error: "Forbidden: You do not have permission to access inspections from another organization." },
      { status: 403 }
    );
  }

  const job = await inspectionQueue.getJob(id);
  return NextResponse.json({ inspection, job: job ?? null });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const forbiddenResponse = await requireAdminRole(request);
  if (forbiddenResponse) return forbiddenResponse;

  const { id } = await params;
  if (!id || typeof id !== "string") {
    return NextResponse.json({ error: "Missing inspection ID." }, { status: 400 });
  }

  const success = await deleteInspection(id);
  if (!success) {
    return NextResponse.json({ error: `Inspection "${id}" not found.` }, { status: 404 });
  }

  return NextResponse.json({ success: true, message: `Inspection "${id}" deleted.` });
}
