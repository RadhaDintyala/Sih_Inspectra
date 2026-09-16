import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { POST as postLogin } from "@/app/api/auth/login/route";
import { GET as getSession } from "@/app/api/auth/session/route";
import { POST as postLogout } from "@/app/api/auth/logout/route";
import { DELETE as deleteInspections } from "@/app/api/inspections/route";
import { DELETE as deleteScanId } from "@/app/api/scan/[id]/route";
import {
  hashPassword,
  verifyPassword,
  createSessionToken,
  verifySessionToken,
  SESSION_COOKIE_NAME,
} from "@/services/auth";

describe("PBKDF2 Password Hashing & HMAC Session Token Security", () => {
  it("hashes password with salt and verifies successfully", () => {
    const password = "SuperSecretPassword123!";
    const storedHash = hashPassword(password);

    expect(storedHash).toContain(":");
    expect(verifyPassword(password, storedHash)).toBe(true);
    expect(verifyPassword("WrongPassword", storedHash)).toBe(false);
    expect(verifyPassword(password, "invalid_hash_string")).toBe(false);
  });

  it("creates and verifies tamper-proof HMAC-SHA256 session tokens", async () => {
    const user = {
      id: "usr-1",
      username: "officer_demo",
      role: "officer" as const,
      name: "Legal Metrology Inspector",
      organizationId: "ORG-LM-DELHI",
    };

    const token = await createSessionToken(user);
    expect(token).toContain(".");

    const payload = await verifySessionToken(token);
    expect(payload).not.toBeNull();
    expect(payload?.username).toBe("officer_demo");
    expect(payload?.role).toBe("officer");
    expect(payload?.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));

    // Tampered token test
    const [b64, sig] = token.split(".");
    const tamperedToken = `${b64}.${sig.slice(0, -4)}abcd`;
    expect(await verifySessionToken(tamperedToken)).toBeNull();
  });
});

describe("Credentialed Authentication Endpoints (Dual Portal)", () => {
  it("POST /api/auth/login succeeds with valid officer credentials and sets HttpOnly cookie", async () => {
    const request = new NextRequest("http://localhost:3000/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "officer_demo",
        password: "Inspectra@Officer2026!",
      }),
    });

    const response = await postLogin(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.user.username).toBe("officer_demo");
    expect(data.user.role).toBe("officer");

    const cookie = response.cookies.get(SESSION_COOKIE_NAME);
    expect(cookie).toBeDefined();
    expect(cookie?.httpOnly).toBe(true);
  });

  it("POST /api/auth/login succeeds with valid admin credentials", async () => {
    const request = new NextRequest("http://localhost:3000/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "admin_demo",
        password: "Inspectra@Admin2026!",
      }),
    });

    const response = await postLogin(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.user.username).toBe("admin_demo");
    expect(data.user.role).toBe("admin");
  });

  it("POST /api/auth/login rejects invalid passwords with 401", async () => {
    const request = new NextRequest("http://localhost:3000/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "officer_demo",
        password: "WrongPassword!",
      }),
    });

    const response = await postLogin(request);
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.error).toContain("Invalid credentials");
  });

  it("POST /api/auth/login rejects missing credentials with 400", async () => {
    const request = new NextRequest("http://localhost:3000/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "officer_demo",
      }),
    });

    const response = await postLogin(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toContain("Username and password are required");
  });

  it("GET /api/auth/session returns unauthenticated when no session cookie is present", async () => {
    const request = new NextRequest("http://localhost:3000/api/auth/session");
    const response = await getSession(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.authenticated).toBe(false);
    expect(data.user).toBeNull();
  });

  it("GET /api/auth/session returns authenticated session when valid token cookie is sent", async () => {
    const token = await createSessionToken({
      id: "usr-admin",
      username: "admin_demo",
      role: "admin",
      name: "Senior Enforcement Administrator",
      organizationId: "ORG-LM-DELHI",
    });

    const request = new NextRequest("http://localhost:3000/api/auth/session", {
      headers: { Cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });

    const response = await getSession(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.authenticated).toBe(true);
    expect(data.user.role).toBe("admin");
    expect(data.user.username).toBe("admin_demo");
  });

  it("POST /api/auth/logout clears session cookie with maxAge 0", async () => {
    const response = await postLogout();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    const cookie = response.cookies.get(SESSION_COOKIE_NAME);
    expect(cookie?.maxAge).toBe(0);
  });
});

describe("Server-Side Role Authorization & Route Gating", () => {
  it("DELETE /api/inspections rejects officer session requests with 403 Forbidden", async () => {
    const officerToken = await createSessionToken({
      id: "usr-officer",
      username: "officer_demo",
      role: "officer",
      name: "Field Officer",
      organizationId: "ORG-LM-DELHI",
    });

    const request = new NextRequest("http://localhost:3000/api/inspections", {
      method: "DELETE",
      headers: { Cookie: `${SESSION_COOKIE_NAME}=${officerToken}` },
    });

    const response = await deleteInspections(request);
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data.error).toContain("Forbidden: Admin role required");
  });

  it("DELETE /api/inspections allows admin session requests with 200 OK", async () => {
    const adminToken = await createSessionToken({
      id: "usr-admin",
      username: "admin_demo",
      role: "admin",
      name: "Admin",
      organizationId: "ORG-LM-DELHI",
    });

    const request = new NextRequest("http://localhost:3000/api/inspections", {
      method: "DELETE",
      headers: { Cookie: `${SESSION_COOKIE_NAME}=${adminToken}` },
    });

    const response = await deleteInspections(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
  });

  it("DELETE /api/scan/[id] rejects officer requests with 403 Forbidden", async () => {
    const officerToken = await createSessionToken({
      id: "usr-officer",
      username: "officer_demo",
      role: "officer",
      name: "Field Officer",
      organizationId: "ORG-LM-DELHI",
    });

    const request = new NextRequest("http://localhost:3000/api/scan/test-id", {
      method: "DELETE",
      headers: { Cookie: `${SESSION_COOKIE_NAME}=${officerToken}` },
    });

    const response = await deleteScanId(request, { params: Promise.resolve({ id: "test-id" }) });
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data.error).toContain("Forbidden: Admin role required");
  });
});
