import { NextRequest, NextResponse } from "next/server";

import { readAuthCookies } from "@/lib/auth-cookies";
import { verifyToken } from "@/lib/auth-jwt";

export type AuthContext = {
  userId: number;
  email: string;
};

export async function requireApiAuth(request: NextRequest): Promise<
  | { ok: true; auth: AuthContext }
  | { ok: false; response: NextResponse }
> {
  const proxyVerified = request.headers.get("x-auth-verified") === "1";
  const proxiedUserId = request.headers.get("x-auth-user-id");
  const proxiedEmail = request.headers.get("x-auth-user-email");

  if (proxyVerified && proxiedUserId && proxiedEmail) {
    const userId = Number(proxiedUserId);

    if (Number.isInteger(userId) && userId > 0) {
      return {
        ok: true,
        auth: {
          userId,
          email: proxiedEmail,
        },
      };
    }
  }

  const { accessToken } = readAuthCookies(request);

  if (!accessToken) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  try {
    const payload = await verifyToken(accessToken, "access");

    return {
      ok: true,
      auth: {
        userId: payload.uid,
        email: payload.email,
      },
    };
  } catch {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
}
