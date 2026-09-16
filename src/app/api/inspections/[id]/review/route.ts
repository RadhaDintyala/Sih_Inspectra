import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getInspection, updateDeclarationOverride } from "@/services/store";
import { getSessionFromRequest } from "@/services/auth";

const reviewSchema = z.object({
  field: z.string().min(1),
  correctedValue: z.string().min(1),
  rationale: z.string().optional(),
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

    const body = await request.json();
    const parsed = reviewSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request payload.", details: parsed.error.issues }, { status: 400 });
    }

    const { field, correctedValue, rationale } = parsed.data;

    // Check inspection existence and tenant boundary
    const inspection = await getInspection(id);
    if (!inspection) {
      return NextResponse.json({ error: `Inspection "${id}" not found.` }, { status: 404 });
    }

    if (session.role?.toUpperCase() !== "ADMIN" && inspection.organizationId && inspection.organizationId !== session.organizationId) {
      return NextResponse.json({ error: "Forbidden: Cannot review inspection from another organization." }, { status: 403 });
    }

    const updated = await updateDeclarationOverride(
      id,
      field,
      correctedValue,
      session.id,
      session.organizationId,
      rationale
    );

    return NextResponse.json({
      success: true,
      message: `Field ${field} updated and re-validated.`,
      inspection: updated,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
