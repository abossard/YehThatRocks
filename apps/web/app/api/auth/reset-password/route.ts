import { NextRequest, NextResponse } from "next/server";

import { resetPasswordSchema } from "@/lib/api-schemas";
import { getRequestMetadata, recordAuthAudit } from "@/lib/auth-audit";
import { clearAuthCookies } from "@/lib/auth-cookies";
import { hashPassword } from "@/lib/auth-password";
import { revokeUserRefreshSessions } from "@/lib/auth-sessions";
import { consumePasswordResetToken } from "@/lib/auth-token-records";
import { verifySameOrigin } from "@/lib/csrf";
import { prisma } from "@/lib/db";
import { parseRequestJson } from "@/lib/request-json";

export async function POST(request: NextRequest) {
  const requestMeta = getRequestMetadata(request.headers);
  const csrfError = verifySameOrigin(request);

  if (csrfError) {
    return csrfError;
  }

  const bodyResult = await parseRequestJson(request);

  if (!bodyResult.ok) {
    return bodyResult.response;
  }

  const parsed = resetPasswordSchema.safeParse(bodyResult.data);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const userId = await consumePasswordResetToken(parsed.data.token);

  if (!userId) {
    await recordAuthAudit({ action: "reset-password", success: false, detail: "Invalid password reset token", ...requestMeta });
    return NextResponse.json({ error: "Invalid or expired reset token" }, { status: 400 });
  }

  const passwordHash = await hashPassword(parsed.data.password);

  await prisma.user.update({
    where: { id: userId },
    data: {
      passwordHash,
      password: null,
    },
  });

  await revokeUserRefreshSessions(userId);

  const response = NextResponse.json({ ok: true });
  clearAuthCookies(response);
  await recordAuthAudit({ action: "reset-password", success: true, userId, detail: "Password reset completed", ...requestMeta });
  return response;
}
