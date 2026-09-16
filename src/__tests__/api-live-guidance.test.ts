import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { POST } from "@/app/api/scan/live-guidance/route";
import { NextRequest } from "next/server";

function guidanceRequest(imageBase64: string): NextRequest {
  return new NextRequest("http://localhost:3000/api/scan/live-guidance", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ imageBase64 }),
  });
}

describe("POST /api/scan/live-guidance (deterministic package gate)", () => {
  it("returns 400 when imageBase64 is missing", async () => {
    const request = new NextRequest("http://localhost:3000/api/scan/live-guidance", {
      method: "POST",
      body: JSON.stringify({}),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe("Missing imageBase64 parameter.");
  });

  it("confirms a package frame as ready without any generative AI", async () => {
    const svg =
      `<svg width="640" height="480"><rect width="640" height="480" fill="#f5f0e1"/>` +
      `<text x="50" y="150" font-size="72" font-family="sans-serif" font-weight="bold" fill="black">Good Day Biscuits</text>` +
      `<text x="50" y="260" font-size="48" font-family="sans-serif" fill="black">MRP Rs 35.00</text></svg>`;
    const buf = await sharp(Buffer.from(svg)).jpeg().toBuffer();
    const response = await POST(guidanceRequest(`data:image/jpeg;base64,${buf.toString("base64")}`));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.packageDetected).toBe(true);
    expect(["PACKAGE_DETECTED", "CAPTURE_READY"]).toContain(data.state);
    expect(typeof data.tip).toBe("string");
    expect(typeof data.packageConfidence).toBe("number");
    expect(data.quality).toBeDefined();
  });

  it("rejects a face-like frame with capture guidance", async () => {
    const svg =
      `<svg width="640" height="480"><rect width="640" height="480" fill="#b97a56"/>` +
      `<ellipse cx="320" cy="240" rx="130" ry="160" fill="#c68863"/>` +
      `<ellipse cx="275" cy="210" rx="16" ry="10" fill="#3a2415"/>` +
      `<ellipse cx="365" cy="210" rx="16" ry="10" fill="#3a2415"/></svg>`;
    const base = await sharp(Buffer.from(svg)).png().toBuffer();
    const { data, info } = await sharp(base).raw().toBuffer({ resolveWithObject: true });
    const out = Buffer.from(data);
    let seed = 7;
    const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    for (let i = 0; i < out.length; i += info.channels) {
      const nz = Math.floor((rand() - 0.5) * 14);
      for (let c = 0; c < 3; c++) out[i + c] = Math.max(0, Math.min(255, out[i + c] + nz));
    }
    const buf = await sharp(out, { raw: { width: info.width, height: info.height, channels: info.channels } }).jpeg().toBuffer();
    const response = await POST(guidanceRequest(`data:image/jpeg;base64,${buf.toString("base64")}`));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.packageDetected).toBe(false);
    expect(payload.state).not.toBe("CAPTURE_READY");
    expect(payload.tip).toMatch(/package/i);
  });

  it("returns 400/422 for malformed or tiny payloads, never mock data", async () => {
    const request = new NextRequest("http://localhost:3000/api/scan/live-guidance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "invalid-json",
    });

    const response = await POST(request);
    expect([400, 422]).toContain(response.status);
    if (response.status === 200) {
      const data = await response.json();
      expect(data).not.toHaveProperty("visibleDeclarations");
    }
  });
});
