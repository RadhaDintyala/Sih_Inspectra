import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/services/store";
import { getSessionFromRequest } from "@/services/auth";

export async function GET(request: NextRequest) {
  try {
    const session = await getSessionFromRequest(request);
    const orgId = session?.role?.toUpperCase() === "ADMIN" ? undefined : session?.organizationId;

    const where: Record<string, unknown> = {};
    if (orgId) {
      where.organizationId = orgId;
    }

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayIso = todayStart.toISOString();

    const [
      total,
      passed,
      failed,
      review,
      processing,
      invalidEvidence,
      recent,
      todayCount,
    ] = await Promise.all([
      prisma.inspectionRecord.count({ where }),
      prisma.inspectionRecord.count({ where: { ...where, status: "pass" } }),
      prisma.inspectionRecord.count({ where: { ...where, status: "fail" } }),
      prisma.inspectionRecord.count({ where: { ...where, status: "review" } }),
      prisma.inspectionRecord.count({ where: { ...where, status: "processing" } }),
      prisma.inspectionRecord.count({ where: { ...where, status: "invalid_evidence" } }),
      prisma.inspectionRecord.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: 8,
        include: {
          images: { take: 1 },
          checks: true,
          declarations: true,
        },
      }),
      prisma.inspectionRecord.count({
        where: {
          ...where,
          createdAt: { gte: todayIso },
        },
      }),
    ]);

    return NextResponse.json({
      metrics: {
        total,
        today: todayCount,
        passed,
        failed,
        review,
        processing,
        invalidEvidence,
      },
      recentInspections: recent.map((r) => ({
        id: r.id,
        productName: r.productName || "Packaged Commodity",
        createdAt: r.createdAt,
        status: r.status,
        score: r.score,
        thumbnailUrl: r.images[0]?.uri || null,
        checksCount: r.checks.length,
      })),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
