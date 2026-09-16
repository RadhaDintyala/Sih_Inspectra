import { NextRequest, NextResponse } from "next/server";
import { getEvidenceImageFile } from "@/services/store";
import { storage } from "@/services/storage";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  if (!id || typeof id !== "string") {
    return NextResponse.json({ error: "Missing image ID." }, { status: 400 });
  }

  let imageBuffer = getEvidenceImageFile(id);

  if (!imageBuffer) {
    // Try object storage key patterns
    imageBuffer = await storage.getObject(id);
    if (!imageBuffer) {
      imageBuffer = await storage.getObject(`inspections/evidence/${id}.jpg`);
    }
  }

  if (!imageBuffer) {
    return NextResponse.json(
      { error: `Evidence image "${id}" not found.` },
      { status: 404 },
    );
  }

  return new NextResponse(new Uint8Array(imageBuffer), {
    status: 200,
    headers: {
      "Content-Type": "image/jpeg",
      "Content-Length": String(imageBuffer.length),
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
