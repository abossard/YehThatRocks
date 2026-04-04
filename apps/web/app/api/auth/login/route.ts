import { NextRequest, NextResponse } from "next/server";

import { loginSchema } from "@/lib/api-schemas";
import { getRequestMetadata, recordAuthAudit } from "@/lib/auth-audit";
import { setAuthCookies } from "@/lib/auth-cookies";
import { signAccessToken, signRefreshToken } from "@/lib/auth-jwt";
import { verifyPassword } from "@/lib/auth-password";
import { createRefreshSession } from "@/lib/auth-sessions";
import { verifySameOrigin } from "@/lib/csrf";
import { prisma } from "@/lib/db";
import { rateLimitOrResponse } from "@/lib/rate-limit";
import { parseRequestJson } from "@/lib/request-json";

export async function POST(request: NextRequest) {
  const requestMeta = getRequestMetadata(request.headers);
  const csrfError = verifySameOrigin(request);

  if (csrfError) {
    return csrfError;
  }

  if (!process.env.DATABASE_URL) {
    return NextResponse.json(
      {
        error:
          process.env.NODE_ENV === "development"
            ? "DATABASE_URL is not configured"
            : "Service unavailable",
      },
      { status: 503 },
    );
  }

  try {
    const bodyResult = await parseRequestJson(request);

    if (!bodyResult.ok) {
      return bodyResult.response;
    }

    const parsed = loginSchema.safeParse(bodyResult.data);

    if (!parsed.success) {
      await recordAuthAudit({
        action: "login",
        success: false,
        detail: "Invalid login payload",
        ...requestMeta,
      });
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const email = parsed.data.email.toLowerCase().trim();
    const rateLimited = rateLimitOrResponse(request, `auth:login:${email}`, 10, 15 * 60 * 1000);

    if (rateLimited) {
      await recordAuthAudit({
        action: "login",
        success: false,
        email,
        detail: "Login rate limited",
        ...requestMeta,
      });
      return rateLimited;
    }

    const user = await prisma.user.findFirst({
      where: {
        email,
      },
      select: {
        id: true,
        email: true,
        screenName: true,
        passwordHash: true,
      },
    });

    if (!user) {
      await recordAuthAudit({
        action: "login",
        success: false,
        email,
        detail: "User not found",
        ...requestMeta,
      });
      return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
    }

    const storedHash = user.passwordHash;

    if (!storedHash) {
      await recordAuthAudit({
        action: "login",
        success: false,
        email,
        userId: user.id,
        detail: "Password login unavailable",
        ...requestMeta,
      });
      return NextResponse.json({ error: "Password login is not enabled for this account" }, { status: 401 });
    }

    const isValid = await verifyPassword(parsed.data.password, storedHash);

    if (!isValid) {
      await recordAuthAudit({
        action: "login",
        success: false,
        email,
        userId: user.id,
        detail: "Invalid password",
        ...requestMeta,
      });
      return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
    }

    const accessToken = await signAccessToken(user.id, user.email ?? email);
    const refreshToken = await signRefreshToken(user.id, user.email ?? email, parsed.data.remember);
    await createRefreshSession(user.id, refreshToken, parsed.data.remember);

    const response = NextResponse.json({
      ok: true,
      user: {
        id: user.id,
        email: user.email,
        screenName: user.screenName,
      },
    });

    setAuthCookies(response, accessToken, refreshToken, parsed.data.remember);
    await recordAuthAudit({
      action: "login",
      success: true,
      email: user.email,
      userId: user.id,
      detail: "Login successful",
      ...requestMeta,
    });
    return response;
  } catch (error) {
    console.error("[auth-login] unhandled login error", error);

    const message = error instanceof Error ? error.message : "Unknown login error";

    try {
      await recordAuthAudit({
        action: "login",
        success: false,
        detail: `Unhandled login error: ${message}`,
        ...requestMeta,
      });
    } catch (auditError) {
      console.error("[auth-login] failed to write auth audit", auditError);
    }

    return NextResponse.json(
      {
        error:
          process.env.NODE_ENV === "development"
            ? `Login failed: ${message}`
            : "Internal server error",
      },
      { status: 500 },
    );
  }
}
