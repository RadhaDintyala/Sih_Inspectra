/**
 * POST /api/scan/live-guidance
 *
 * Deterministic pre-capture guidance. No generative AI, no network calls, no
 * mock data: the frame is analysed with the same package-presence gate that
 * guards the official pipeline, so "Ready to capture" on screen means the
 * backend will accept the frame.
 *
 * States emitted: CAMERA_READY → PACKAGE_NOT_DETECTED → PACKAGE_DETECTED →
 * CAPTURE_READY (client maps these to its capture UI).
 */

import { NextRequest, NextResponse } from "next/server";
import { analyzePackagePresence } from "@/services/package-gate";

export interface LiveGuidanceResult {
  state: "PACKAGE_NOT_DETECTED" | "PACKAGE_DETECTED" | "CAPTURE_READY" | "QUALITY_INSUFFICIENT";
  packageDetected: boolean;
  packageConfidence: number;
  tip: string;
  quality: {
    blurry: boolean;
    tooDark: boolean;
    glare: boolean;
  };
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as { imageBase64?: string };
    const imageBase64 = body.imageBase64;

    if (!imageBase64 || typeof imageBase64 !== "string") {
      return NextResponse.json({ error: "Missing imageBase64 parameter." }, { status: 400 });
    }

    const base64Data = imageBase64.includes(",") ? imageBase64.split(",")[1] : imageBase64;
    let buffer: Buffer;
    try {
      buffer = Buffer.from(base64Data, "base64");
    } catch {
      return NextResponse.json({ error: "Invalid base64 image payload." }, { status: 400 });
    }
    if (buffer.length < 1024) {
      return NextResponse.json({ error: "Image payload too small for guidance." }, { status: 422 });
    }

    const gate = await analyzePackagePresence(buffer);

    const blurry = (gate.quality.blurVariance ?? 999) < 18;
    const tooDark = (gate.quality.meanLuma ?? 255) < 22;
    const glare = (gate.quality.glareRatio ?? 0) > 0.25;

    let state: LiveGuidanceResult["state"];
    if (gate.reason.startsWith("IMAGE_QUALITY") || gate.reason === "GATE_ERROR") {
      state = "QUALITY_INSUFFICIENT";
    } else if (gate.packageDetected && gate.confidence >= 0.6) {
      state = "CAPTURE_READY";
    } else if (gate.packageDetected) {
      state = "PACKAGE_DETECTED";
    } else {
      state = "PACKAGE_NOT_DETECTED";
    }

    const result: LiveGuidanceResult = {
      state,
      packageDetected: gate.packageDetected,
      packageConfidence: gate.confidence,
      tip: state === "CAPTURE_READY"
        ? "Package detected. Ready to capture."
        : gate.guidance,
      quality: { blurry, tooDark, glare },
    };
    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[live-guidance] gate failure:", msg);
    return NextResponse.json({ error: "GUIDANCE_FAILED", message: msg }, { status: 500 });
  }
}
