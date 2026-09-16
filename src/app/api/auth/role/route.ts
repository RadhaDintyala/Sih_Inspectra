/**
 * /api/auth/role
 *
 * GET: Reads current role from HttpOnly cookie `inspectra_role`.
 * POST: Sets current role in HttpOnly cookie `inspectra_role`.
 */

import { NextRequest, NextResponse } from "next/server";

const COOKIE_NAME = "inspectra_role";

export async function GET(request: NextRequest) {
  const role = request.cookies.get(COOKIE_NAME)?.value;

  if (role === "admin" || role === "officer") {
    return NextResponse.json({ role });
  }

  return NextResponse.json({ role: "officer" });
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { role?: string };
    const role = body.role;

    if (role !== "admin" && role !== "officer") {
      return NextResponse.json(
        { error: "Invalid role. Must be 'admin' or 'officer'." },
        { status: 400 }
      );
    }

    const response = NextResponse.json({ role, success: true });
    response.cookies.set(COOKIE_NAME, role, {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
    });

    return response;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
