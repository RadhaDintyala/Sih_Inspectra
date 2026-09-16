import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, SESSION_COOKIE_NAME } from "@/lib/session";

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const method = request.method;

  // Identify Admin-only API actions (destructive purge, inspection deletion, rule modification)
  const isAdminOnlyAction =
    (pathname === "/api/inspections" && method === "DELETE") ||
    (pathname.startsWith("/api/scan/") && method === "DELETE") ||
    (pathname.startsWith("/api/rules") && method !== "GET");

  if (isAdminOnlyAction) {
    const sessionToken = request.cookies.get(SESSION_COOKIE_NAME)?.value;
    if (!sessionToken) {
      return NextResponse.json(
        { error: "Unauthorized: Administrator authentication required." },
        { status: 401 },
      );
    }

    const payload = await verifySessionToken(sessionToken);
    if (!payload) {
      return NextResponse.json(
        { error: "Unauthorized: Invalid or expired session token." },
        { status: 401 },
      );
    }

    if (payload.role !== "admin") {
      return NextResponse.json(
        { error: "Forbidden: Administrative credentials required for this action." },
        { status: 403 },
      );
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/api/inspections/:path*",
    "/api/scan/:path*",
    "/api/rules/:path*",
  ],
};
