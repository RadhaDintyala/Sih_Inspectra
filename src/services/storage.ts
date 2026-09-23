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
  return Boolean(process.env.S3_ENDPOINT && process.env.S3_BUCKET);
}

class S3ObjectStorageService implements ObjectStorageService {
  private client: any = null;
  private bucket: string;
  private endpoint: string;
  private initError: string | null = null;

  constructor() {
    this.bucket = process.env.S3_BUCKET || "inspectra-evidence";
    this.endpoint = process.env.S3_ENDPOINT || "http://localhost:9000";
  }

  private async getClient(): Promise<any> {
    if (this.client) return this.client;
    if (this.initError) throw new Error(this.initError);
    try {
      const { S3Client } = await import("@aws-sdk/client-s3");
      const client = new S3Client({
        endpoint: this.endpoint,
        region: process.env.S3_REGION || "us-east-1",
        credentials: {
          accessKeyId: process.env.S3_ACCESS_KEY || "minioadmin",
          secretAccessKey: process.env.S3_SECRET_KEY || "minioadmin",
        },
        forcePathStyle: true,
      });
      // Ensure bucket exists (idempotent).
      const { HeadBucketCommand, CreateBucketCommand } = await import("@aws-sdk/client-s3");
      try {
        await client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      } catch {
        await client.send(new CreateBucketCommand({ Bucket: this.bucket }));
      }
      this.client = client;
      return client;
    } catch (err) {
      this.initError = err instanceof Error ? err.message : String(err);
      throw err;
    }
  }

  async putObject(key: string, buffer: Buffer, mimeType: string): Promise<StoredObjectMetadata> {
    const client = await this.getClient();
    const { PutObjectCommand } = await import("@aws-sdk/client-s3");
    await client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: buffer, ContentType: mimeType }));
    const checksum = crypto.createHash("sha256").update(buffer).digest("hex");
    return { key, size: buffer.length, mimeType, checksum, createdAt: new Date().toISOString(), url: this.getUrl(key), backend: "s3" };
  }

  async getObject(key: string): Promise<Buffer | null> {
    try {
      const client = await this.getClient();
      const { GetObjectCommand } = await import("@aws-sdk/client-s3");
      const res = await client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      const body = res.Body;
      if (!body) return null;
      if (Buffer.isBuffer(body)) return body;
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
