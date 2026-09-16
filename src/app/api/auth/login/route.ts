import { NextRequest, NextResponse } from "next/server";
import { authenticateUser, createSessionToken, SESSION_COOKIE_NAME } from "@/services/auth";
import { logAuditEvent } from "@/services/audit";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { username, password } = body as { username?: string; password?: string };

    if (!username || !password) {
      return NextResponse.json(
        { error: "Username and password are required." },
        { status: 400 },
      );
    }

    const user = await authenticateUser(username, password);

    if (!user) {
      return NextResponse.json(
        { error: "Invalid credentials. Please check your username and password." },
        { status: 401 },
      );
    }

    const token = await createSessionToken(user);

    // Audit log
    await logAuditEvent({
      organizationId: user.organizationId,
      userId: user.id,
      action: "LOGIN",
      entityType: "USER",
      entityId: user.id,
      details: { username: user.username, role: user.role },
    });

    const response = NextResponse.json({
      success: true,
      user: {
        id: user.id,
        organizationId: user.organizationId,
        organizationName: user.organizationName,
        organizationCode: user.organizationCode,
        username: user.username,
        role: user.role,
        name: user.name,
        badgeNumber: user.badgeNumber,
      },
    });

    response.cookies.set({
      name: SESSION_COOKIE_NAME,
      value: token,
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 7, // 7 days
    });

    return response;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[Login API] Error:", msg);
    return NextResponse.json({ error: "Internal authentication error." }, { status: 500 });
  }
}
