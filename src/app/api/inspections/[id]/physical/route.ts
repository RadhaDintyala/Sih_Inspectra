import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getInspection, submitPhysicalMeasurements } from "@/services/store";
import { getSessionFromRequest } from "@/services/auth";
import type { PhysicalMeasurement } from "@/domain/inspection";

const measurementSchema = z.object({
  field: z.string().optional().default("net_quantity"),
  declaredValue: z.string().min(1),
  measuredValue: z.string().min(1),
  unit: z.string().min(1),
  permissibleError: z.string().optional(),
  withinTolerance: z.boolean().nullable().optional(),
  measuredBy: z.string().optional(),
  instrumentId: z.string().optional(),
});

const bodySchema = z.object({
  measurements: z.array(measurementSchema).min(1),
  notes: z.string().optional(),
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

    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request payload.", details: parsed.error.issues }, { status: 400 });
    }

    const inspection = await getInspection(id);
    if (!inspection) {
      return NextResponse.json({ error: `Inspection "${id}" not found.` }, { status: 404 });
    }
    if (session.role?.toUpperCase() !== "ADMIN" && inspection.organizationId && inspection.organizationId !== session.organizationId) {
      return NextResponse.json({ error: "Forbidden: Cannot update inspection from another organization." }, { status: 403 });
    }

    const measurements = parsed.data.measurements as PhysicalMeasurement[];
    const updated = await submitPhysicalMeasurements(id, measurements, session.id, session.organizationId, parsed.data.notes);

    return NextResponse.json({
      success: true,
      message: "Physical measurements recorded and validated against Rule 19/20.",
      inspection: updated,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}