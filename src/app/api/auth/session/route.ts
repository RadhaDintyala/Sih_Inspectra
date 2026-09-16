import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/services/auth";

export async function GET(request: NextRequest) {
  const user = await getSessionFromRequest(request);

  if (!user) {
    return NextResponse.json({
      authenticated: false,
      user: null,
    });
  }

  return NextResponse.json({
    authenticated: true,
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
}
