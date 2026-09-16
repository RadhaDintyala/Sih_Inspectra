/**
 * Inspectra analysis worker entry point.
 *
 *   npm run worker
 *
 * Long-running, horizontally scalable: run N replicas against the same Redis
 * and Postgres. Each replica BRPOPs staged job descriptors and runs the
 * official pipeline (gate → YOLO → regional OCR → validators → compliance).
 *
 * A failed image/job never crashes the worker: errors are recorded on the
 * job hash and the loop continues. Recoverable jobs stay visible as FAILED
 * with their error for operators.
 */

import { processStagedDescriptor, INSPECTION_QUEUE_KEY } from "@/services/queue";
import { redisLink } from "@/services/redis-link";

const POLL_TIMEOUT_SEC = 10;

async function main(): Promise<void> {
  console.log("[Worker] Inspectra analysis worker starting…");
  const alive = await redisLink.ping(3000);
  if (!alive) {
    console.error("[Worker] Redis unreachable at REDIS_URL — worker requires Redis. Exiting.");
    process.exit(1);
  }
  console.log("[Worker] Redis reachable. Waiting for jobs…");
  for (;;) {
    try {
      const raw = await redisLink.brpop(INSPECTION_QUEUE_KEY, POLL_TIMEOUT_SEC);
      if (raw) await processStagedDescriptor(raw);
    } catch (err) {
      console.error("[Worker] poll error (continuing):", err instanceof Error ? err.message : String(err));
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

main().catch((err) => {
  console.error("[Worker] fatal:", err);
  process.exit(1);
});
