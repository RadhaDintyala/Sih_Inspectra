/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Object Storage — evidence truth.
 *
 * Backend selection (first configured wins):
 *   1. S3-compatible (AWS S3 / MinIO) when S3_ENDPOINT + S3_BUCKET are set.
 *   2. Local disk vault (development / single-node fallback).
 *
 * Stores: original images (immutable), field crops, annotated evidence,
 * generated reports. PostgreSQL stores REFERENCES (keys + checksums) —
 * never large blobs.
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";

export interface StoredObjectMetadata {
  key: string;
  size: number;
  mimeType: string;
  checksum: string;
  createdAt: string;
  url: string;
  backend: "s3" | "local";
}

export interface ObjectStorageService {
  putObject(key: string, buffer: Buffer, mimeType: string, metadata?: Record<string, string>): Promise<StoredObjectMetadata>;
  getObject(key: string): Promise<Buffer | null>;
  deleteObject(key: string): Promise<void>;
  getUrl(key: string): string;
  exists(key: string): Promise<boolean>;
  backendName(): "s3" | "local";
  health(): Promise<{ ok: boolean; backend: string; detail?: string }>;
}

function s3Configured(): boolean {
  const bucket = process.env.S3_BUCKET?.trim();
  const endpoint = process.env.S3_ENDPOINT?.trim();
  const accessKey = process.env.S3_ACCESS_KEY?.trim();
  return Boolean(bucket && (endpoint || accessKey));
}

class S3ObjectStorageService implements ObjectStorageService {
  private client: any = null;
  private initError: string | null = null;

  private get bucket(): string {
    return process.env.S3_BUCKET?.trim() || "inspectra-evidence";
  }

  private async getClient(): Promise<any> {
    if (this.client) return this.client;
    if (this.initError) throw new Error(this.initError);
    try {
      const { S3Client } = await import("@aws-sdk/client-s3");
      const rawEndpoint = process.env.S3_ENDPOINT?.trim().replace(/\/+$/, "");
      const endpoint = rawEndpoint && rawEndpoint.length > 0 ? rawEndpoint : undefined;
      const region = process.env.S3_REGION?.trim() || "us-east-1";
      const accessKeyId = (process.env.S3_ACCESS_KEY || "minioadmin").trim();
      const secretAccessKey = (process.env.S3_SECRET_KEY || "minioadmin").trim();

      const envForcePathStyle = process.env.S3_FORCE_PATH_STYLE?.trim();
      let forcePathStyle: boolean;
      if (envForcePathStyle === "true") {
        forcePathStyle = true;
      } else if (envForcePathStyle === "false") {
        forcePathStyle = false;
      } else {
        // Custom S3 endpoints (such as Supabase S3 at https://<ref>.supabase.co/storage/v1/s3 or local MinIO)
        // require forcePathStyle: true. Using virtual-host style (forcePathStyle: false) prepends the bucket name
        // to the endpoint host (e.g. inspectra-storage.<ref>.supabase.co), causing SSL SNI certificate mismatches
        // and triggering EPROTO TLS handshake failures (SSL alert number 40).
        forcePathStyle = Boolean(endpoint);
      }

      const clientConfig: any = {
        region,
        credentials: {
          accessKeyId,
          secretAccessKey,
        },
        forcePathStyle,
        requestChecksumCalculation: "WHEN_REQUIRED",
        responseChecksumValidation: "WHEN_REQUIRED",
      };

      if (endpoint) {
        clientConfig.endpoint = endpoint;
      }

      const client = new S3Client(clientConfig);

      const isSupabase = Boolean(endpoint && endpoint.includes("supabase.co"));
      // Ensure bucket exists for local MinIO; skip bucket creation commands for Supabase/AWS S3 pre-created buckets.
      if (!isSupabase) {
        try {
          const { HeadBucketCommand, CreateBucketCommand } = await import("@aws-sdk/client-s3");
          try {
            await client.send(new HeadBucketCommand({ Bucket: this.bucket }));
          } catch {
            try {
              await client.send(new CreateBucketCommand({ Bucket: this.bucket }));
            } catch {
              // Ignore bucket creation failures
            }
          }
        } catch {
          // Ignore initialization bucket check errors
        }
      }

      this.client = client;
      return client;
    } catch (err) {
      this.initError = err instanceof Error ? err.message : String(err);
      throw err;
    }
  }

  async putObject(key: string, buffer: Buffer, mimeType: string): Promise<StoredObjectMetadata> {
    const rawEndpoint = process.env.S3_ENDPOINT?.trim().replace(/\/+$/, "");
    let hostOnly = "default-aws-s3";
    let port = "443";
    let protocol = "https:";
    if (rawEndpoint) {
      try {
        const parsedUrl = new URL(rawEndpoint);
        hostOnly = parsedUrl.hostname;
        port = parsedUrl.port || (parsedUrl.protocol === "http:" ? "80" : "443");
        protocol = parsedUrl.protocol;
      } catch {
        hostOnly = rawEndpoint;
      }
    }
    console.log(`[DIAGNOSTIC] service=Storage operation=PutObject hostname=${hostOnly} port=${port} protocol=${protocol} key=${key}`);
    try {
      const client = await this.getClient();
      const { PutObjectCommand } = await import("@aws-sdk/client-s3");
      await client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: buffer, ContentType: mimeType }));
      const checksum = crypto.createHash("sha256").update(buffer).digest("hex");
      return { key, size: buffer.length, mimeType, checksum, createdAt: new Date().toISOString(), url: this.getUrl(key), backend: "s3" };
    } catch (err: any) {
      console.error(`[DIAGNOSTIC_ERROR] service=Storage operation=PutObject hostname=${hostOnly} port=${port} protocol=${protocol} errorName=${err?.name} errorCode=${err?.code || err?.$metadata?.httpStatusCode} errorMessage=${err?.message} stack=${err?.stack} cause=${err?.cause ? (err.cause.stack || err.cause.message || String(err.cause)) : undefined}`);
      throw err;
    }
  }

  async getObject(key: string): Promise<Buffer | null> {
    try {
      const client = await this.getClient();
      const { GetObjectCommand } = await import("@aws-sdk/client-s3");
      const res = await client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      const body = res.Body;
      if (!body) return null;
      if (Buffer.isBuffer(body)) return body;
      if (body instanceof Uint8Array) return Buffer.from(body);
      if (typeof (body as any).transformToByteArray === "function") {
        const bytes = await (body as any).transformToByteArray();
        return Buffer.from(bytes);
      }
      // Streaming body → collect.
      const chunks: Buffer[] = [];
      for await (const chunk of body as AsyncIterable<Uint8Array>) chunks.push(Buffer.from(chunk));
      return Buffer.concat(chunks);
    } catch {
      return null;
    }
  }

  async deleteObject(key: string): Promise<void> {
    const client = await this.getClient();
    const { DeleteObjectCommand } = await import("@aws-sdk/client-s3");
    await client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async exists(key: string): Promise<boolean> {
    try {
      const client = await this.getClient();
      const { HeadObjectCommand } = await import("@aws-sdk/client-s3");
      await client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch {
      return false;
    }
  }

  getUrl(key: string): string {
    return `/api/scan/image?key=${encodeURIComponent(key)}`;
  }

  backendName(): "s3" | "local" {
    return "s3";
  }

  async health(): Promise<{ ok: boolean; backend: string; detail?: string }> {
    try {
      await this.getClient();
      return { ok: true, backend: "s3" };
    } catch (err) {
      return { ok: false, backend: "s3", detail: err instanceof Error ? err.message : String(err) };
    }
  }
}

class LocalDiskObjectStorageService implements ObjectStorageService {
  private baseDir: string;

  constructor() {
    this.baseDir = process.env.OBJECT_STORAGE_DIR || path.join(process.cwd(), ".scan-store", "vault");
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
  }

  private resolvePath(key: string): string {
    const safeKey = key.replace(/\.\./g, "").replace(/^\/+/, "");
    return path.join(this.baseDir, safeKey);
  }

  async putObject(key: string, buffer: Buffer, mimeType: string): Promise<StoredObjectMetadata> {
    const filePath = this.resolvePath(key);
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, buffer);
    const checksum = crypto.createHash("sha256").update(buffer).digest("hex");
    return { key, size: buffer.length, mimeType, checksum, createdAt: new Date().toISOString(), url: this.getUrl(key), backend: "local" };
  }

  async getObject(key: string): Promise<Buffer | null> {
    const filePath = this.resolvePath(key);
    if (!fs.existsSync(filePath)) return null;
    return fs.readFileSync(filePath);
  }

  async deleteObject(key: string): Promise<void> {
    const filePath = this.resolvePath(key);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }

  async exists(key: string): Promise<boolean> {
    return fs.existsSync(this.resolvePath(key));
  }

  getUrl(key: string): string {
    return `/api/scan/image?key=${encodeURIComponent(key)}`;
  }

  backendName(): "s3" | "local" {
    return "local";
  }

  async health(): Promise<{ ok: boolean; backend: string; detail?: string }> {
    try {
      if (!fs.existsSync(this.baseDir)) fs.mkdirSync(this.baseDir, { recursive: true });
      fs.accessSync(this.baseDir, fs.constants.W_OK);
      return { ok: true, backend: "local" };
    } catch (err) {
      return { ok: false, backend: "local", detail: err instanceof Error ? err.message : String(err) };
    }
  }
}

function createStorage(): ObjectStorageService {
  if (s3Configured()) return new S3ObjectStorageService();
  return new LocalDiskObjectStorageService();
}

export const storage: ObjectStorageService = createStorage();
