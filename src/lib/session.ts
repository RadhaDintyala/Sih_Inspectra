export type UserRole = "ADMIN" | "ENFORCEMENT_OFFICER" | "REVIEWER" | "officer" | "admin" | "reviewer";

export interface SessionUser {
  id: string;
  organizationId: string;
  organizationName?: string;
  organizationCode?: string;
  username: string;
  role: UserRole;
  name: string;
  badgeNumber?: string | null;
}

export interface SessionPayload extends SessionUser {
  iat: number;
  exp: number;
}

export const SESSION_COOKIE_NAME = "inspectra_session";
const SESSION_SECRET = process.env.SESSION_SECRET || "inspectra-dev-secret-key-salt-2026";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days

function base64UrlEncode(str: string): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(str)
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  }
  const encoder = new TextEncoder();
  const bytes = encoder.encode(str);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64UrlDecode(str: string): string {
  let base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4) base64 += "=";
  if (typeof Buffer !== "undefined") {
    return Buffer.from(base64, "base64").toString("utf-8");
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

export async function signHmacSha256(data: string, secret: string = SESSION_SECRET): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(data));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function verifyHmacSha256(data: string, signature: string, secret: string = SESSION_SECRET): Promise<boolean> {
  try {
    const expected = await signHmacSha256(data, secret);
    if (signature.length !== expected.length) return false;
    let mismatch = 0;
    for (let i = 0; i < signature.length; i++) {
      mismatch |= signature.charCodeAt(i) ^ expected.charCodeAt(i);
    }
    return mismatch === 0;
  } catch {
    return false;
  }
}

export async function createSessionToken(user: SessionUser): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload: SessionPayload = {
    ...user,
    iat: now,
    exp: now + SESSION_MAX_AGE_SECONDS,
  };

  const payloadB64 = base64UrlEncode(JSON.stringify(payload));
  const signature = await signHmacSha256(payloadB64);
  return `${payloadB64}.${signature}`;
}

export async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  if (!token || !token.includes(".")) return null;
  const [payloadB64, signature] = token.split(".");
  if (!payloadB64 || !signature) return null;

  const valid = await verifyHmacSha256(payloadB64, signature);
  if (!valid) return null;

  try {
    const payload = JSON.parse(base64UrlDecode(payloadB64)) as SessionPayload;
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}
