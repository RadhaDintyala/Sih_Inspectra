/**
 * POST /api/scan — inspection ingestion endpoint.
 *
 * Official pipeline only: package gate → YOLO → regional OCR → validators →
 * compliance engine. No generative AI anywhere on this path.
 *
 * Production flow (async, worker-decoupled):
 *   validate → stage → enqueue → 202 Accepted + status URL
 *
 * Synchronous flow (tests / explicit opt-in via ?sync=true):
 *   validate → run pipeline inline → 200 with inspection
 *
 * GET /api/scan — paginated inspection list for the caller's organization.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { inspectionQueue, startInlineWorkerPump, type StagedImageDescriptor } from "@/services/queue";
import { requireAuth } from "@/services/auth";
import {
  getDefaultOrganizationId,
  listInspections,
  saveInspection,
  recordStatusChange,
} from "@/services/store";
import { logAuditEvent } from "@/services/audit";
import type { PipelineInputImage } from "@/services/pipeline-worker";

import { randomBytes } from "crypto";

function generateId(): string {
  const year = new Date().getFullYear();
  const hex = randomBytes(4).toString("hex").toUpperCase();
  return `INSP-${year}-${hex}`;
}

function hasValidImageSignature(buffer: Buffer): boolean {
  if (buffer.length < 4) return false;
  return (
    (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) ||
    (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) ||
    (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) ||
    (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer.subarray(8, 12).toString() === "WEBP")
  );
}

function hasEnoughImageData(buffer: Buffer): boolean {
  return buffer.length >= 1024;
}

function toSummary(inspection: {
  id: string;
  status: string;
  score?: number | null;
  productName?: string;
  checks: Array<{ status: string }>;
}) {
  return {
    id: inspection.id,
    status: inspection.status,
    score: inspection.score ?? null,
    product: inspection.productName,
    pass: inspection.checks.filter((c) => c.status === "pass").length,
    fail: inspection.checks.filter((c) => c.status === "fail").length,
    review: inspection.checks.filter((c) => c.status === "review").length,
    totalRules: inspection.checks.length,
  };
}

export async function POST(request: NextRequest) {
  try {
    // Authentication is required to create inspections; the organization is
    // taken from the verified session — never from client input.
    const auth = await requireAuth(request);
    if ("errorResponse" in auth) {
      // Fall back to the default org only outside production auth tests.
      if (process.env.TEST_MODE !== "true") return auth.errorResponse;
    }
    const session = "errorResponse" in auth ? null : auth.user;
    const orgId = session?.organizationId || (await getDefaultOrganizationId());
    const userId = session?.id;

    const contentType = request.headers.get("content-type") ?? "";
    const inputImages: PipelineInputImage[] = [];
    let packageCategory: string | undefined;
    let source: "camera" | "upload" | "live_feed" | "ecommerce" = "camera";
    let ecommerceUrl: string | undefined;
    let ecommerceProduct: import("@/domain/inspection").EcommerceProductData | undefined;
    let physicalMeasurements: import("@/domain/inspection").PhysicalMeasurement[] | undefined;
    let physicalScale: { pixelsPerMm: number; scaleReference: string } | undefined;

    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      const mode = form.get("mode")?.toString();
      if (mode === "ecommerce") {
        source = "ecommerce";
        ecommerceUrl = form.get("ecommerceUrl")?.toString();
        const title = form.get("title")?.toString();
        const price = form.get("price")?.toString();
        const mrp = form.get("mrp")?.toString();
        const manufacturer = form.get("manufacturer")?.toString();
        const countryOfOrigin = form.get("countryOfOrigin")?.toString();
        const netQuantity = form.get("netQuantity")?.toString();
        if (title || price || mrp || manufacturer || countryOfOrigin || netQuantity) {
          ecommerceProduct = {
            url: ecommerceUrl,
            title,
            description: form.get("description")?.toString() || undefined,
            price,
            mrp,
            manufacturer,
            countryOfOrigin,
            netQuantity,
          };
        }
      }
      const physJson = form.get("physicalMeasurements")?.toString();
      if (physJson) {
        try { physicalMeasurements = JSON.parse(physJson); } catch { /* invalid JSON ignored */ }
      }
      const scaleJson = form.get("physicalScale")?.toString();
      if (scaleJson) {
        try {
          const parsed = JSON.parse(scaleJson);
          if (parsed && typeof parsed.pixelsPerMm === "number" && parsed.pixelsPerMm > 0) {
            physicalScale = { pixelsPerMm: parsed.pixelsPerMm, scaleReference: parsed.scaleReference ?? "officer-entered" };
          }
        } catch { /* invalid JSON ignored */ }
      }
      const files = form.getAll("image").filter((value): value is File => typeof value !== "string");
      if (!files.length) {
        return NextResponse.json(
          { error: "No image file provided. Send multipart/form-data with one or more 'image' fields." },
          { status: 400 }
        );
      }

      packageCategory = form.get("packageCategory")?.toString();
      const sides = form.getAll("side").map((value) => value.toString());

      for (const [index, file] of files.entries()) {
        if (file.size === 0) {
          return NextResponse.json({ error: "IMAGE_EMPTY", message: `Image ${index + 1} is empty.` }, { status: 400 });
        }
        if (file.size > 25 * 1024 * 1024) {
          return NextResponse.json({ error: "IMAGE_TOO_LARGE", message: `Image ${index + 1} exceeds the 25 MB limit.` }, { status: 413 });
        }

        const buffer = Buffer.from(await file.arrayBuffer());
        if (!hasValidImageSignature(buffer)) {
          return NextResponse.json(
            { error: "IMAGE_CORRUPTED", message: `Image ${index + 1} does not contain a supported image signature.` },
            { status: 422 }
          );
        }
        if (!hasEnoughImageData(buffer)) {
          return NextResponse.json(
            { error: "IMAGE_QUALITY_INSUFFICIENT", message: `Image ${index + 1} has insufficient image data.` },
            { status: 422 }
          );
        }

        const sideStr = sides[index] || (index === 0 ? "front" : index === 1 ? "back" : "side");
        const side = (["front", "back", "side", "top", "unknown"].includes(sideStr) ? sideStr : "unknown") as StagedImageDescriptor["side"];

        inputImages.push({
          buffer,
          filename: file.name || `capture-${index + 1}.jpg`,
          mimeType: file.type || "image/jpeg",
          side,
        });
      }
    } else if (contentType.includes("application/json")) {
      const body = (await request.json()) as { imageUri?: string; imageUris?: string[]; packageCategory?: string; ecommerceUrl?: string; ecommerceProduct?: import("@/domain/inspection").EcommerceProductData; physicalMeasurements?: import("@/domain/inspection").PhysicalMeasurement[]; physicalScale?: { pixelsPerMm: number; scaleReference: string }; mode?: string };
      const parsed = z
        .object({
          imageUri: z.string().url().optional(),
          imageUris: z.array(z.string().url()).optional(),
          packageCategory: z.string().optional(),
          ecommerceUrl: z.string().optional(),
          mode: z.string().optional(),
        })
        .refine((value) => Boolean(value.imageUri || value.imageUris?.length))
        .safeParse(body);

      if (!parsed.success) {
        return NextResponse.json({ error: "JSON body must include imageUri or imageUris." }, { status: 400 });
      }

      packageCategory = parsed.data.packageCategory;
      if (parsed.data.mode === "ecommerce" || body.ecommerceUrl) {
        source = "ecommerce";
        ecommerceUrl = body.ecommerceUrl ?? parsed.data.ecommerceUrl;
        ecommerceProduct = body.ecommerceProduct;
      }
      physicalMeasurements = body.physicalMeasurements;
      physicalScale = body.physicalScale;
      const uris = parsed.data.imageUris ?? (parsed.data.imageUri ? [parsed.data.imageUri] : []);

      for (const [index, uri] of uris.entries()) {
        const res = await fetch(uri, { signal: AbortSignal.timeout(15_000) });
        if (!res.ok) {
          return NextResponse.json({ error: `Could not fetch remote image ${index + 1} (HTTP ${res.status}).` }, { status: 400 });
        }
        const buffer = Buffer.from(await res.arrayBuffer());
        if (!hasValidImageSignature(buffer)) {
          return NextResponse.json({ error: "IMAGE_CORRUPTED", message: `Remote image ${index + 1} is corrupted.` }, { status: 422 });
        }
        inputImages.push({
          buffer,
          filename: `remote-${index + 1}.jpg`,
          mimeType: res.headers.get("content-type") || "image/jpeg",
          side: index === 0 ? "front" : "unknown",
        });
      }
    } else {
      return NextResponse.json(
        { error: "Unsupported content type. Use multipart/form-data with 'image' fields." },
        { status: 415 }
      );
    }

    const inspectionId = generateId();
    const syncRequested =
      process.env.TEST_MODE === "true" || request.nextUrl.searchParams.get("sync") === "true";

    console.log(`[DIAGNOSTIC] step=1_PARSE_INPUT inspectionId=${inspectionId} inputImages=${inputImages.length} orgId=${orgId} mode=${syncRequested ? "sync" : "async"}`);

    if (syncRequested) {
      console.log(`[DIAGNOSTIC] step=2_EXECUTE_SYNC service=PipelineWorker inspectionId=${inspectionId}`);
      const inspection = await inspectionQueue.executeSync({
        inspectionId,
        organizationId: orgId,
        userId,
        packageCategory,
        source,
        ecommerceUrl,
        ecommerceProduct,
        physicalMeasurements,
        physicalScale,
        images: inputImages,
      });
      return NextResponse.json(
        {
          inspection,
          extractionSource: inspection.extractionSource,
          score: inspection.score ?? null,
          verdict: inspection.verdict ?? null,
          summary: toSummary(inspection),
        },
        { status: 200 }
      );
    }

    const initialInspection = {
      id: inspectionId,
      organizationId: orgId,
      userId,
      createdAt: new Date().toISOString(),
      status: "processing" as const,
      processingStatus: "QUEUED" as const,
      images: [],
      declarations: [],
      checks: [],
      notes: [`Evidence received (${inputImages.length} frame(s)). Queued for analysis.`],
      extractionSource: "YOLO + Regional OCR",
    };
    console.log(`[DIAGNOSTIC] step=2_DB_SAVE_INITIAL service=Database inspectionId=${inspectionId}`);
    await saveInspection(initialInspection);
    await recordStatusChange(inspectionId, null, "processing", userId, "Inspection queued");
    await logAuditEvent({
      organizationId: orgId,
      userId,
      action: "INSPECTION_CREATED",
      entityType: "INSPECTION",
      entityId: inspectionId,
      details: { imageCount: inputImages.length, packageCategory, mode: "async" },
    });

    const staged: StagedImageDescriptor[] = inputImages.map((img) => ({
      key: "",
      filename: img.filename,
      mimeType: img.mimeType || "image/jpeg",
      side: (img.side ?? "unknown") as StagedImageDescriptor["side"],
      sourceCamera: img.sourceCamera,
    }));
    console.log(`[DIAGNOSTIC] step=3_ENQUEUE_STAGED service=Queue_Storage inspectionId=${inspectionId} stagedCount=${staged.length}`);
    const record = await inspectionQueue.enqueueStaged(
      { inspectionId, organizationId: orgId, userId, packageCategory, source, ecommerceUrl, ecommerceProduct, physicalMeasurements, physicalScale, staged },
      inputImages.map((img) => img.buffer)
    );
    startInlineWorkerPump();
    return NextResponse.json(
      {
        inspectionId,
        inspection: { ...initialInspection, organizationId: orgId },
        jobId: record.jobId,
        status: "QUEUED",
        statusUrl: `/api/scan/${inspectionId}`,
        pollIntervalMs: 2000,
      },
      { status: 202 }
    );
  } catch (err: any) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[DIAGNOSTIC_ERROR] service=ScanAPI operation=POST_api_scan errorName=${err?.name} errorCode=${err?.code} errorMessage=${msg} stack=${err?.stack} cause=${err?.cause ? (err.cause.stack || err.cause.message || String(err.cause)) : undefined}`);
    return NextResponse.json({ error: "EXTRACTION_FAILED", message: msg }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if ("errorResponse" in auth) return auth.errorResponse;
    const session = auth.user;
    const searchParams = request.nextUrl.searchParams;
    const status = searchParams.get("status") || undefined;
    const limit = searchParams.get("limit") ? parseInt(searchParams.get("limit")!, 10) : 50;
    const offset = searchParams.get("offset") ? parseInt(searchParams.get("offset")!, 10) : 0;

    // Tenant isolation: non-admin callers only ever see their own org.
    const orgId = session?.role?.toUpperCase() === "ADMIN" ? undefined : session?.organizationId;

    const { inspections, total } = await listInspections({ orgId, status, limit, offset });
    return NextResponse.json({ inspections, count: inspections.length, total });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
