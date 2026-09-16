import { describe, it, expect } from "vitest";
import { compressAndDownscaleImage } from "@/services/image-compression";

describe("compressAndDownscaleImage", () => {
  it("returns a valid File object from a Blob input", async () => {
    const dummyBlob = new Blob(["fake-image-bytes"], { type: "image/jpeg" });
    const result = await compressAndDownscaleImage(dummyBlob, "test.jpg", 1600, 0.85);

    expect(result).toBeDefined();
    expect(result.name).toBe("test.jpg");
    expect(result.type).toBe("image/jpeg");
  });

  it("handles File objects gracefully", async () => {
    const dummyFile = new File(["fake-image-bytes"], "upload.png", { type: "image/png" });
    const result = await compressAndDownscaleImage(dummyFile, "upload.png", 1600, 0.85);

    expect(result).toBeDefined();
    expect(result.name).toBe("upload.jpg");
    expect(result.type).toBe("image/jpeg");
  });
});
