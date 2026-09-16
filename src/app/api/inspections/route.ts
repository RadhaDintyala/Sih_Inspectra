import { NextRequest, NextResponse } from "next/server";
import { listInspections, clearInspectionStore, countInspections } from "@/services/store";
import { getSessionFromRequest, requireAdminRole } from "@/services/auth";
import type { InspectionStatus } from "@/domain/inspection";

const VALID_STATUSES: InspectionStatus[] = ["processing", "pass", "fail", "review"];

export async function GET(request: NextRequest) {
  try {
    const session = await getSessionFromRequest(request);
    const { searchParams } = request.nextUrl;
    const statusParam = searchParams.get("status");
    const q = searchParams.get("q")?.trim().toLowerCase() ?? "";
    const limit = searchParams.get("limit") ? parseInt(searchParams.get("limit")!, 10) : 100;
    const offset = searchParams.get("offset") ? parseInt(searchParams.get("offset")!, 10) : 0;

    // Enforce tenant boundary: non-admins only see their organization's records
    const orgId = session?.role?.toUpperCase() === "ADMIN" ? undefined : session?.organizationId;

    const { inspections: allInspections, total } = await listInspections({
      orgId,
      status: statusParam || undefined,
      limit,
      offset,
    });

    let filtered = allInspections;
    if (q) {
      filtered = filtered.filter((i) => {
        const declarationValues = i.declarations.map((d) => d.value ?? "").join(" ");
        const haystack = [i.id, i.productName ?? "", declarationValues].join(" ").toLowerCase();
        return haystack.includes(q);
      });
    }

    return NextResponse.json({
      inspections: filtered,
      count: filtered.length,
      totalStored: total,
      storageEngine: "PostgreSQL/Relational",
      organizationId: orgId || "ALL_ORGS",
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const forbiddenResponse = await requireAdminRole(request);
  if (forbiddenResponse) return forbiddenResponse;

  try {
    await clearInspectionStore();
    return NextResponse.json({ success: true, message: "Inspection store purged successfully." });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
