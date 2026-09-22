import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, SESSION_COOKIE_NAME } from "@/lib/session";

const PUBLIC_API_PATHS = [
  "/api/auth/login",
  "/api/auth/logout",
  "/api/auth/session",
  "/api/health",
  "/api/ready",
];

function applySecurityHeaders(response: NextResponse): NextResponse {
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("Permissions-Policy", "camera=(self), microphone=()");
  response.headers.set(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' blob: data:; media-src 'self' blob:; connect-src 'self';"
  );
  return response;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const method = request.method;

  // Bypass static files and Next.js internals
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/static") ||
    pathname === "/favicon.ico"
  ) {
    return NextResponse.next();
  }

  const sessionToken = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const sessionPayload = sessionToken ? await verifySessionToken(sessionToken) : null;

  // 1. API Route Protection
  if (pathname.startsWith("/api/")) {
    const isPublicApi = PUBLIC_API_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
    
    if (!isPublicApi) {
      if (!sessionPayload) {
        return applySecurityHeaders(
          NextResponse.json(
            { error: "Unauthorized: Active session required.", statusCode: 401 },
            { status: 401 }
          )
        );
      }

      // Role-based restrictions for admin-only API actions
      const isAdminOnlyAction =
        (pathname === "/api/inspections" && method === "DELETE") ||
        (pathname.startsWith("/api/scan/") && method === "DELETE") ||
        (pathname.startsWith("/api/rules") && method !== "GET");

      if (isAdminOnlyAction) {
        const userRole = (sessionPayload.role || "").toUpperCase();
        if (userRole !== "ADMIN") {
          return applySecurityHeaders(
            NextResponse.json(
              { error: "Forbidden: Administrative credentials required for this action.", statusCode: 403 },
              { status: 403 }
            )
          );
        }
      }
    }

    const response = NextResponse.next();
    return applySecurityHeaders(response);
  }

  // 2. Page Requests: Delegate authentication state to page.tsx & RoleContext
  const response = NextResponse.next();
  return applySecurityHeaders(response);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};


