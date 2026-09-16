/**
 * GET /api/health — liveness + dependency health.
 * GET /api/health?deep=true — also runs readiness checks (db/redis/storage).
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/services/store";
import { redisLink } from "@/services/redis-link";
import { storage } from "@/services/storage";
import { yoloService } from "@/services/yolo-service";

export async function GET(request: NextRequest) {
  const deep = request.nextUrl.searchParams.get("deep") === "true";

  const base = {
    status: "ok" as const,
    service: "inspectra-api",
    time: new Date().toISOString(),
  };
  if (!deep) return NextResponse.json(base);

  const [db, redis, objectStorage] = await Promise.all([
    (async () => {
      try {
        await prisma.$queryRaw`SELECT 1`;
        return { ok: true };
      } catch (err) {
        return { ok: false, detail: err instanceof Error ? err.message : String(err) };
      }
    })(),
    (async () => {
      const ok = await redisLink.ping(2000);
      return ok ? { ok: true } : { ok: false, detail: "Redis unreachable — queue runs inline" };
    })(),
    storage.health(),
  ]);

  const allOk = db.ok && objectStorage.ok;
  return NextResponse.json(
    {
      ...base,
      status: allOk ? "ok" : "degraded",
      dependencies: {
        database: { ...db, provider: "postgresql" },
        redis,
        objectStorage: { ...objectStorage, backend: storage.backendName() },
        yoloWeights: {
          available: yoloService.weightsAvailable(),
          detail: yoloService.weightsAvailable()
            ? "trained weights active"
            : "weights absent — measured OCR-layout proposals active",
        },
      },
    },
    { status: allOk ? 200 : 503 }
  );
}
