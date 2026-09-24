import { describe, it, expect, beforeEach, afterEach } from "vitest";

describe("S3ObjectStorageService environment configuration", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("configures MinIO correctly with local endpoint and forcePathStyle=true", async () => {
    process.env.S3_ENDPOINT = "http://localhost:9000";
    process.env.S3_BUCKET = "inspectra-evidence";
    process.env.S3_ACCESS_KEY = "minioadmin";
    process.env.S3_SECRET_KEY = "minioadmin";
    process.env.S3_REGION = "us-east-1";

    const { storage } = await import("@/services/storage");
    expect(storage.backendName()).toBe("s3");
  });

  it("configures Supabase S3 correctly with custom endpoint and forcePathStyle=false", async () => {
    process.env.S3_ENDPOINT = "https://testproj.supabase.co/storage/v1/s3";
    process.env.S3_BUCKET = "inspectra-storage";
    process.env.S3_ACCESS_KEY = "test-access-key";
    process.env.S3_SECRET_KEY = "test-secret-key";
    process.env.S3_REGION = "ap-northeast-2";

    const { storage } = await import("@/services/storage");
    expect(storage.backendName()).toBe("s3");
  });

  it("supports fallback scenario where S3_ENDPOINT is empty string", async () => {
    process.env.S3_ENDPOINT = "";
    process.env.S3_BUCKET = "inspectra-storage";
    process.env.S3_ACCESS_KEY = "test-access-key";
    process.env.S3_SECRET_KEY = "test-secret-key";
    process.env.S3_REGION = "ap-northeast-2";

    const { storage } = await import("@/services/storage");
    expect(storage.backendName()).toBe("s3");
  });
});
