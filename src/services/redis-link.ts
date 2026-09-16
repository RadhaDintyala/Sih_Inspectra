/**
 * Minimal Redis link (RESP2 over TCP, no third-party client).
 *
 * Used for the inspection job queue transport and health checks. All
 * operations degrade to errors when Redis is unreachable — callers MUST fall
 * back to the in-process queue so inspections keep working offline.
 */

import net from "net";

function encodeCommand(args: Array<string | Buffer>): Buffer {
  const parts: Buffer[] = [Buffer.from(`*${args.length}\r\n`)];
  for (const arg of args) {
    const buf = Buffer.isBuffer(arg) ? arg : Buffer.from(arg);
    parts.push(Buffer.from(`$${buf.length}\r\n`), buf, Buffer.from("\r\n"));
  }
  return Buffer.concat(parts);
}

export interface RedisEndpoint {
  host: string;
  port: number;
}

export function parseRedisUrl(url: string): RedisEndpoint {
  try {
    const u = new URL(url);
    return { host: u.hostname || "127.0.0.1", port: Number(u.port) || 6379 };
  } catch {
    return { host: "127.0.0.1", port: 6379 };
  }
}

async function sendCommand(endpoint: RedisEndpoint, args: Array<string | Buffer>, timeoutMs: number): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const socket = net.createConnection({ host: endpoint.host, port: endpoint.port });
    const chunks: Buffer[] = [];
    let settled = false;
    const done = (fn: () => void) => {
      if (settled) return;
      settled = true;
      try { socket.destroy(); } catch { /* noop */ }
      fn();
    };
    const timer = setTimeout(() => done(() => reject(new Error("REDIS_TIMEOUT"))), timeoutMs);
    socket.on("connect", () => {
      socket.write(encodeCommand(args));
    });
    socket.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
      const buf = Buffer.concat(chunks);
      // Complete RESP frame heuristic: blocking commands (BRPOP) return one
      // array frame; clears on socket end. Resolve when the frame parses.
      if (isCompleteFrame(buf)) {
        clearTimeout(timer);
        done(() => resolve(buf));
      }
    });
    socket.on("error", (err) => {
      clearTimeout(timer);
      done(() => reject(err));
    });
    socket.on("end", () => {
      clearTimeout(timer);
      done(() => resolve(Buffer.concat(chunks)));
    });
  });
}

function isCompleteFrame(buf: Buffer): boolean {
  if (buf.length === 0) return false;
  const first = String.fromCharCode(buf[0]);
  if (first === "+" || first === "-" || first === ":") return buf.includes("\r\n");
  if (first === "$") {
    const headerEnd = buf.indexOf("\r\n");
    if (headerEnd < 0) return false;
    const len = parseInt(buf.subarray(1, headerEnd).toString(), 10);
    if (len === -1) return true;
    return buf.length >= headerEnd + 2 + len + 2;
  }
  if (first === "*") {
    const headerEnd = buf.indexOf("\r\n");
    if (headerEnd < 0) return false;
    const count = parseInt(buf.subarray(1, headerEnd).toString(), 10);
    if (count === -1 || count === 0) return true;
    // Walk sub-frames.
    let offset = headerEnd + 2;
    let seen = 0;
    while (seen < count) {
      if (offset >= buf.length) return false;
      const t = String.fromCharCode(buf[offset]);
      if (t === "$") {
        const e = buf.indexOf("\r\n", offset);
        if (e < 0) return false;
        const len = parseInt(buf.subarray(offset + 1, e).toString(), 10);
        if (len === -1) { offset = e + 2; seen++; continue; }
        if (buf.length < e + 2 + len + 2) return false;
        offset = e + 2 + len + 2;
        seen++;
      } else if (t === "+" || t === "-" || t === ":") {
        const e = buf.indexOf("\r\n", offset);
        if (e < 0) return false;
        offset = e + 2;
        seen++;
      } else {
        return false;
      }
    }
    return true;
  }
  return false;
}

/** Parse a RESP2 reply into JS values (null for nil). */
export function parseReply(buf: Buffer): unknown {
  const text = buf.toString("binary");
  let pos = 0;
  function readLine(): string {
    const end = text.indexOf("\r\n", pos);
    const line = text.slice(pos, end);
    pos = end + 2;
    return line;
  }
  function readValue(): unknown {
    const line = readLine();
    const type = line[0];
    const payload = line.slice(1);
    if (type === "+") return payload;
    if (type === "-") throw new Error(`REDIS_ERROR: ${payload}`);
    if (type === ":") return parseInt(payload, 10);
    if (type === "$") {
      const len = parseInt(payload, 10);
      if (len === -1) return null;
      const raw = Buffer.from(text.slice(pos, pos + len), "binary");
      pos += len + 2;
      return raw;
    }
    if (type === "*") {
      const count = parseInt(payload, 10);
      if (count === -1) return null;
      const arr: unknown[] = [];
      for (let i = 0; i < count; i++) arr.push(readValue());
      return arr;
    }
    throw new Error(`REDIS_PROTOCOL: unexpected prefix ${type}`);
  }
  return readValue();
}

export class RedisLink {
  private endpoint: RedisEndpoint;

  constructor(url?: string) {
    this.endpoint = parseRedisUrl(url || process.env.REDIS_URL || "redis://localhost:6379");
  }

  private async cmd(args: Array<string | Buffer>, timeoutMs = 3000): Promise<unknown> {
    const raw = await sendCommand(this.endpoint, args, timeoutMs);
    return parseReply(raw);
  }

  async ping(timeoutMs = 2000): Promise<boolean> {
    try {
      const res = await this.cmd(["PING"], timeoutMs);
      return res === "PONG";
    } catch {
      return false;
    }
  }

  async lpush(key: string, value: string): Promise<void> {
    await this.cmd(["LPUSH", key, value]);
  }

  async brpop(key: string, timeoutSec: number): Promise<string | null> {
    const res = await this.cmd(["BRPOP", key, String(timeoutSec)], (timeoutSec + 5) * 1000);
    if (!res) return null;
    const arr = res as unknown[];
    if (!Array.isArray(arr) || arr.length < 2) return null;
    const payload = arr[1];
    return Buffer.isBuffer(payload) ? payload.toString("utf8") : String(payload ?? "");
  }

  async hset(key: string, fields: Record<string, string>): Promise<void> {
    const args: Array<string | Buffer> = ["HSET", key];
    for (const [k, v] of Object.entries(fields)) args.push(k, v);
    await this.cmd(args);
  }

  async hgetall(key: string): Promise<Record<string, string>> {
    const res = await this.cmd(["HGETALL", key]);
    const out: Record<string, string> = {};
    if (!Array.isArray(res)) return out;
    for (let i = 0; i + 1 < res.length; i += 2) {
      const k = res[i];
      const v = res[i + 1];
      out[Buffer.isBuffer(k) ? k.toString() : String(k)] = Buffer.isBuffer(v) ? v.toString() : String(v ?? "");
    }
    return out;
  }

  async del(key: string): Promise<void> {
    await this.cmd(["DEL", key]);
  }
}

export const redisLink = new RedisLink();
