import { NextRequest, NextResponse } from "next/server";
import { storage } from "@/services/storage";
import { getEvidenceImageFile } from "@/services/store";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const key = searchParams.get("key");
  const id = searchParams.get("id");

  let buffer: Buffer | null = null;
  let mimeType = "image/jpeg";

  if (key) {
    buffer = await storage.getObject(key);
    if (key.endsWith(".png")) mimeType = "image/png";
    if (key.endsWith(".webp")) mimeType = "image/webp";
  } else if (id) {
    buffer = getEvidenceImageFile(id);
    if (!buffer) {
      buffer = await storage.getObject(`inspections/evidence/${id}.jpg`);
    }
  }

  if (!buffer) {
    return NextResponse.json({ error: "Image not found." }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": mimeType,
      "Content-Length": String(buffer.length),
      "Cache-Control": "public, max-age=86400",
    },
  });
}
