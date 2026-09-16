/**
 * GET /api/ready — Kubernetes-style readiness probe.
 * 200 only when the API can serve inspections (DB reachable).
 */

import { NextResponse } from "next/server";
import { prisma } from "@/services/store";

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ ready: true, time: new Date().toISOString() });
  } catch (err) {
    return NextResponse.json(
      { ready: false, detail: err instanceof Error ? err.message : String(err) },
      { status: 503 }
    );
  }
}
