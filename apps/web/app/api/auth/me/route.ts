import { NextRequest, NextResponse } from "next/server";

import { requireApiAuth } from "@/lib/auth-request";

export async function GET(request: NextRequest) {
  const authResult = await requireApiAuth(request);

  if (!authResult.ok) {
    return authResult.response;
  }

  return NextResponse.json({
    user: {
      id: authResult.auth.userId,
      email: authResult.auth.email,
      emailVerifiedAt: null,
      screenName: null,
      avatarUrl: null,
    },
  });
}
