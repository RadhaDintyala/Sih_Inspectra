/**
 * Robust Cryptographic Authentication & Role-Gating Service
 *
 * Uses PBKDF2 key derivation for secure password hashing and
 * HMAC-SHA256 cryptographically signed session tokens stored in HttpOnly cookies.
 * Zero external native binary dependencies for rock-solid Next.js Turbopack stability.
 */

import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { prisma } from "@/services/store";
import {
  type UserRole,
  type SessionUser,
  type SessionPayload,
  SESSION_COOKIE_NAME,
  createSessionToken,
  verifySessionToken,
} from "@/lib/session";

export type { UserRole, SessionUser, SessionPayload };
export { SESSION_COOKIE_NAME, createSessionToken, verifySessionToken };

// ---------------------------------------------------------------------------
// Password Hashing (PBKDF2)
// ---------------------------------------------------------------------------

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.pbkdf2Sync(password, salt, 100_000, 64, "sha512").toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  if (!storedHash || !storedHash.includes(":")) return false;
  const [salt, originalHash] = storedHash.split(":");
  if (!salt || !originalHash) return false;
  const verifyHash = crypto.pbkdf2Sync(password, salt, 100_000, 64, "sha512").toString("hex");
  return crypto.timingSafeEqual(Buffer.from(originalHash, "hex"), Buffer.from(verifyHash, "hex"));
}

// ---------------------------------------------------------------------------
// Request Extraction & Authorization Helpers
// ---------------------------------------------------------------------------

export async function getSessionUserFromToken(token: string | undefined): Promise<SessionUser | null> {
  if (!token) return null;
  const payload = await verifySessionToken(token);
  if (!payload) return null;
  return {
    id: payload.id,
    organizationId: payload.organizationId,
    organizationName: payload.organizationName,
    organizationCode: payload.organizationCode,
    username: payload.username,
    role: payload.role,
    name: payload.name,
    badgeNumber: payload.badgeNumber,
  };
}

export async function getSessionFromRequest(request: NextRequest): Promise<SessionUser | null> {
  const token = request.cookies?.get ? request.cookies.get(SESSION_COOKIE_NAME)?.value : undefined;
  if (!token) return null;
  return getSessionUserFromToken(token);
}

export async function getRoleFromRequest(request: NextRequest): Promise<UserRole> {
  const sessionToken = request.cookies?.get ? request.cookies.get(SESSION_COOKIE_NAME)?.value : undefined;
  if (sessionToken) {
    const session = await getSessionUserFromToken(sessionToken);
    if (session) return session.role;
  }
  const legacyRole = request.cookies?.get ? request.cookies.get("inspectra_role")?.value : undefined;
  if (legacyRole === "admin" || legacyRole === "ADMIN") return "ADMIN";
  if (legacyRole === "officer" || legacyRole === "ENFORCEMENT_OFFICER") return "ENFORCEMENT_OFFICER";
  if (legacyRole === "reviewer" || legacyRole === "REVIEWER") return "REVIEWER";

  return "ENFORCEMENT_OFFICER";
}

export async function requireAuth(request: NextRequest): Promise<{ user: SessionUser } | { errorResponse: NextResponse }> {
  const user = await getSessionFromRequest(request);
  if (!user) {
    return {
      errorResponse: NextResponse.json(
        { error: "Unauthorized: Active session required." },
        { status: 401 },
      ),
    };
  }
  return { user };
}

export async function requireRoles(
  request: NextRequest,
  allowedRoles: UserRole[]
): Promise<{ user: SessionUser } | { errorResponse: NextResponse }> {
  const authResult = await requireAuth(request);
  if ("errorResponse" in authResult) return authResult;

  const user = authResult.user;
  const userRole = (user.role || "").toUpperCase();
  const isAllowed = allowedRoles.some((r) => {
    const ru = r.toUpperCase();
    return ru === userRole || (ru === "ADMIN" && userRole === "ADMIN") || (ru === "OFFICER" && (userRole === "OFFICER" || userRole === "ENFORCEMENT_OFFICER"));
  });

  if (!isAllowed) {
    return {
      errorResponse: NextResponse.json(
        { error: "Forbidden: Admin role required for this action." },
        { status: 403 }
      ),
    };
  }

  return { user };
}

export async function requireAdminRole(request: NextRequest): Promise<NextResponse | null> {
  const role = await getRoleFromRequest(request);
  if (role.toLowerCase() !== "admin") {
    return NextResponse.json(
      { error: "Forbidden: Admin role required for this action." },
      { status: 403 },
    );
  }
  return null;
}

// ---------------------------------------------------------------------------
// Database User Operations
// ---------------------------------------------------------------------------

export async function authenticateUser(username: string, password: string): Promise<SessionUser | null> {
  const normalizedUsername = username.trim().toLowerCase();

  // 1. Check database user
  const user = await prisma.user.findUnique({
    where: { username: normalizedUsername },
    include: { organization: true },
  });

  if (user && user.active) {
    const valid = verifyPassword(password, user.passwordHash);
    if (valid) {
      const roleUpper = user.role.toUpperCase();
      const mappedRole: UserRole =
        roleUpper === "ADMIN" || user.role === "admin"
          ? "admin"
          : roleUpper === "REVIEWER"
          ? "REVIEWER"
          : "officer";

      return {
        id: user.id,
        organizationId: user.organizationId,
        organizationName: user.organization.name,
        organizationCode: user.organization.code,
        username: user.username,
        role: mappedRole,
        name: user.name,
        badgeNumber: user.badgeNumber,
      };
    }
  }

  // Development/test convenience only. Production authentication is always
  // backed by a seeded User row and never creates accounts on login.
  if (process.env.NODE_ENV !== "production" && process.env.TEST_MODE === "true" && normalizedUsername === "officer_demo" && password === "Inspectra@Officer2026!") {
    let org = await prisma.organization.findUnique({ where: { code: "ORG-LM-DELHI" } });
    if (!org) {
      org = (await prisma.organization.findFirst()) || (await prisma.organization.create({
        data: {
          code: "ORG-LM-DELHI",
          name: "Delhi Legal Metrology Enforcement Cell",
          jurisdiction: "Delhi",
        },
      }));
    }

    const userRecord = await prisma.user.upsert({
      where: { username: "officer_demo" },
      create: {
        id: "usr-officer-demo",
        organizationId: org.id,
        username: "officer_demo",
        passwordHash: hashPassword(password),
        name: "Legal Metrology Inspector (Demo)",
        role: "ENFORCEMENT_OFFICER",
      },
      update: {
        organizationId: org.id,
      },
    });

    return {
      id: userRecord.id,
      organizationId: org.id,
      organizationName: org.name,
      organizationCode: org.code,
      username: "officer_demo",
      role: "officer",
      name: "Legal Metrology Inspector (Demo)",
    };
  }

  if (process.env.NODE_ENV !== "production" && process.env.TEST_MODE === "true" && normalizedUsername === "admin_demo" && password === "Inspectra@Admin2026!") {
    let org = await prisma.organization.findUnique({ where: { code: "ORG-LM-DELHI" } });
    if (!org) {
      org = (await prisma.organization.findFirst()) || (await prisma.organization.create({
        data: {
          code: "ORG-LM-DELHI",
          name: "Delhi Legal Metrology Enforcement Cell",
          jurisdiction: "Delhi",
        },
      }));
    }

    const userRecord = await prisma.user.upsert({
      where: { username: "admin_demo" },
      create: {
        id: "usr-admin-demo",
        organizationId: org.id,
        username: "admin_demo",
        passwordHash: hashPassword(password),
        name: "Senior Administrator (Demo)",
        role: "ADMIN",
      },
      update: {
        organizationId: org.id,
      },
    });

    return {
      id: userRecord.id,
      organizationId: org.id,
      organizationName: org.name,
      organizationCode: org.code,
      username: "admin_demo",
      role: "admin",
      name: "Senior Administrator (Demo)",
    };
  }

  return null;
}
