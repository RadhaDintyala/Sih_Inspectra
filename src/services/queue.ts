/**
 * Inspection Job Queue — API/worker decoupling.
 *
 * Heavy CV/OCR NEVER runs in the request thread in production:
 *
 *   API → stage buffers in object storage → Redis list → Worker → DB
 *
 * - Redis reachable: descriptor is pushed to `inspectra:queue` and consumed
 *   by horizontally-scalable worker processes (`npm run worker`).
 * - Redis unreachable: falls back to the in-process pump (single-node mode).
 * - TEST_MODE: synchronous execution so integration tests exercise the real
 *   pipeline deterministically.
 */

import { processInspectionPipeline, type PipelineJob } from "@/services/pipeline-worker";
import type { Inspection } from "@/domain/inspection";
import { redisLink } from "@/services/redis-link";
import { storage } from "@/services/storage";

export type JobStatus = "QUEUED" | "PROCESSING" | "COMPLETED" | "FAILED";

export interface QueueJobRecord {
  jobId: string;
  inspectionId: string;
  status: JobStatus;
  queuedAt: number;
  startedAt?: number;
  completedAt?: number;
  error?: string;
  transport?: "redis" | "inline";
}

export interface StagedImageDescriptor {
  key: string;
  filename: string;
  mimeType: string;
  side: "front" | "back" | "side" | "top" | "unknown";
  sourceCamera?: string;
}

export interface StagedJobDescriptor {
  inspectionId: string;
  organizationId: string;
  userId?: string;
  packageCategory?: string;
  staged: StagedImageDescriptor[];
  source?: "camera" | "upload" | "live_feed" | "ecommerce";
  ecommerceUrl?: string;
  ecommerceProduct?: import("@/domain/inspection").EcommerceProductData;
  physicalMeasurements?: import("@/domain/inspection").PhysicalMeasurement[];
  physicalScale?: { pixelsPerMm: number; scaleReference: string };
}

export const INSPECTION_QUEUE_KEY = "inspectra:queue";
const jobKey = (inspectionId: string) => `inspectra:job:${inspectionId}`;

class InspectionQueue {
  private jobs = new Map<string, QueueJobRecord>();
  private activeWorkers = 0;
  private maxConcurrency = 4;
  private queue: PipelineJob[] = [];
  private redisAvailable: boolean | null = null;

  private async checkRedis(): Promise<boolean> {
    if (this.redisAvailable !== null) return this.redisAvailable;
    this.redisAvailable = await redisLink.ping(1500);
    // Re-probe periodically instead of caching a stale negative forever.
    if (!this.redisAvailable) setTimeout(() => { this.redisAvailable = null; }, 15000);
    return this.redisAvailable;
  }

  /** Stage raw buffers, then enqueue for async worker execution. */
  async enqueueStaged(descriptor: StagedJobDescriptor, buffers: Buffer[]): Promise<QueueJobRecord> {
    const jobId = `job-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const record: QueueJobRecord = {
      jobId,
      inspectionId: descriptor.inspectionId,
      status: "QUEUED",
      queuedAt: Date.now(),
    };
    this.jobs.set(descriptor.inspectionId, record);

    // Persist buffers to staging so any worker can rehydrate them.
    const staged = await Promise.all(
      descriptor.staged.map(async (s, i) => {
        const key = `staging/${descriptor.inspectionId}/${i}-${s.filename.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
        await storage.putObject(key, buffers[i], s.mimeType);
        return { ...s, key };
      })
    );
    const payload: StagedJobDescriptor = { ...descriptor, staged };

    if (await this.checkRedis()) {
      try {
        await redisLink.lpush(INSPECTION_QUEUE_KEY, JSON.stringify(payload));
        await redisLink.hset(jobKey(descriptor.inspectionId), {
          jobId,
          status: "QUEUED",
          queuedAt: String(record.queuedAt),
        });
        record.transport = "redis";
        return record;
      } catch (err) {
        console.warn("[Queue] Redis push failed, using inline pump:", err instanceof Error ? err.message : String(err));
        this.redisAvailable = null;
      }
    }

    // Inline fallback: pump in-process without blocking the request.
    record.transport = "inline";
    const inlineJob: PipelineJob = {
      inspectionId: descriptor.inspectionId,
      organizationId: descriptor.organizationId,
      userId: descriptor.userId,
      packageCategory: descriptor.packageCategory,
      source: descriptor.source,
      ecommerceUrl: descriptor.ecommerceUrl,
      ecommerceProduct: descriptor.ecommerceProduct,
      physicalMeasurements: descriptor.physicalMeasurements,
      physicalScale: descriptor.physicalScale,
      images: descriptor.staged.map((s, i) => ({
        buffer: buffers[i],
        filename: s.filename,
        mimeType: s.mimeType,
        side: s.side,
        sourceCamera: s.sourceCamera,
      })),
    };
    this.queue.push(inlineJob);
    setTimeout(() => this.processNext(), 10);
    return record;
  }

  /** Execute the pipeline immediately in the current process. */
  async executeSync(job: PipelineJob): Promise<Inspection> {
    const record: QueueJobRecord = {
      jobId: `sync-${Date.now()}`,
      inspectionId: job.inspectionId,
      status: "PROCESSING",
      queuedAt: Date.now(),
      startedAt: Date.now(),
      transport: "inline",
    };
    this.jobs.set(job.inspectionId, record);

    try {
      const result = await processInspectionPipeline(job);
      record.status = "COMPLETED";
      record.completedAt = Date.now();
      return result;
    } catch (err) {
      record.status = "FAILED";
      record.error = err instanceof Error ? err.message : String(err);
      throw err;
    }
  }

  /** Rehydrate a staged descriptor (worker-side) into a runnable job. */
  async rehydrate(descriptor: StagedJobDescriptor): Promise<PipelineJob> {
    const images = await Promise.all(
      descriptor.staged.map(async (s) => {
        const buf = await storage.getObject(s.key);
        if (!buf) throw new Error(`Staged evidence missing: ${s.key}`);
        return { buffer: buf, filename: s.filename, mimeType: s.mimeType, side: s.side, sourceCamera: s.sourceCamera };
      })
    );
    return {
      inspectionId: descriptor.inspectionId,
      organizationId: descriptor.organizationId,
      userId: descriptor.userId,
      packageCategory: descriptor.packageCategory,
      source: descriptor.source,
      ecommerceUrl: descriptor.ecommerceUrl,
      ecommerceProduct: descriptor.ecommerceProduct,
      physicalMeasurements: descriptor.physicalMeasurements,
      physicalScale: descriptor.physicalScale,
      images,
    };
  }

  async markJobStatus(inspectionId: string, status: JobStatus, error?: string): Promise<void> {
    const record = this.jobs.get(inspectionId);
    if (record) {
      record.status = status;
      if (status === "PROCESSING") record.startedAt = Date.now();
      if (status === "COMPLETED" || status === "FAILED") record.completedAt = Date.now();
      if (error) record.error = error;
    }
    try {
      await redisLink.hset(jobKey(inspectionId), {
        status,
        ...(status === "PROCESSING" ? { startedAt: String(Date.now()) } : {}),
        ...((status === "COMPLETED" || status === "FAILED") ? { completedAt: String(Date.now()) } : {}),
        ...(error ? { error } : {}),
      });
    } catch { /* Redis optional */ }
  }

  async getJob(inspectionId: string): Promise<QueueJobRecord | undefined> {
    const local = this.jobs.get(inspectionId);
    if (local) return local;
    try {
      const hash = await redisLink.hgetall(jobKey(inspectionId));
      if (hash && hash.status) {
        return {
          jobId: hash.jobId || `redis-${inspectionId}`,
          inspectionId,
          status: hash.status as JobStatus,
          queuedAt: Number(hash.queuedAt) || Date.now(),
          startedAt: hash.startedAt ? Number(hash.startedAt) : undefined,
          completedAt: hash.completedAt ? Number(hash.completedAt) : undefined,
          error: hash.error,
          transport: "redis",
        };
      }
    } catch { /* Redis optional */ }
    return undefined;
  }

  private async processNext() {
    if (this.activeWorkers >= this.maxConcurrency || this.queue.length === 0) return;
    const job = this.queue.shift();
    if (!job) return;

    this.activeWorkers++;
    const record = this.jobs.get(job.inspectionId);
    if (record) {
      record.status = "PROCESSING";
      record.startedAt = Date.now();
    }

    try {
      await processInspectionPipeline(job);
      if (record) {
        record.status = "COMPLETED";
        record.completedAt = Date.now();
      }
    } catch (err) {
      if (record) {
        record.status = "FAILED";
        record.error = err instanceof Error ? err.message : String(err);
      }
    } finally {
      this.activeWorkers--;
      this.processNext();
    }
  }
}

export const inspectionQueue = new InspectionQueue();

/**
 * Execute one staged descriptor end-to-end (shared by the standalone
 * worker fleet AND the dev-mode inline pump).
 */
export async function processStagedDescriptor(raw: string): Promise<void> {
  const descriptor = JSON.parse(raw) as StagedJobDescriptor;
  const { inspectionId } = descriptor;
  console.log(`[Worker] inspection=${inspectionId} stage=dequeue status=SUCCESS`);
  const t0 = Date.now();
  await inspectionQueue.markJobStatus(inspectionId, "PROCESSING");
  try {
    const job = await inspectionQueue.rehydrate(descriptor);
    const result = await inspectionQueue.executeSync(job);
    for (const s of descriptor.staged) {
      try {
        await storage.deleteObject(s.key);
      } catch {
        /* staging cleanup best-effort */
      }
    }
    await inspectionQueue.markJobStatus(inspectionId, "COMPLETED");
    console.log(
      `[Worker] inspection=${inspectionId} stage=pipeline duration=${((Date.now() - t0) / 1000).toFixed(2)}s status=SUCCESS verdict=${result.verdict ?? result.status}`
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[Worker] inspection=${inspectionId} stage=pipeline status=FAILED error=${msg}`);
    await inspectionQueue.markJobStatus(inspectionId, "FAILED", msg);
  }
}

let inlinePumpRunning = false;

/**
 * Dev-mode inline pump: consumes the Redis queue inside the API process so
 * a single `npm run dev` completes inspections with no separate worker.
 *
 * Disabled when ENABLE_INLINE_WORKER=false or in production (dedicated
 * `npm run worker` replicas own the queue there — two consumers would
 * double-process jobs).
 */
export function startInlineWorkerPump(): void {
  if (inlinePumpRunning) return;
  if (process.env.ENABLE_INLINE_WORKER === "false") return;
  if (process.env.NODE_ENV === "production") return;
  inlinePumpRunning = true;
  void (async () => {
    const reachable = await redisLink.ping(3000);
    if (!reachable) {
      inlinePumpRunning = false;
      return;
    }
    console.log("[Queue] inline worker pump active (dev mode: ENABLE_INLINE_WORKER=false to disable)");
    for (;;) {
      try {
        const raw = await redisLink.brpop(INSPECTION_QUEUE_KEY, 10);
        if (raw) await processStagedDescriptor(raw);
      } catch (err) {
        console.error("[Queue] inline pump error (continuing):", err instanceof Error ? err.message : String(err));
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  })();
}
