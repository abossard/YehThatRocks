import { NextRequest, NextResponse } from "next/server";

import { getRequestMetadata, recordAuthAudit } from "@/lib/auth-audit";
import { requireApiAuth } from "@/lib/auth-request";
import { hashPassword, verifyPassword } from "@/lib/auth-password";
import { revokeUserRefreshSessions } from "@/lib/auth-sessions";
import { verifySameOrigin } from "@/lib/csrf";
import { prisma } from "@/lib/db";
import { parseRequestJson } from "@/lib/request-json";
import { z } from "zod";

const changePasswordSchema = z.object({
  currentPassword: z.string().min(8).max(128),
  newPassword: z.string().min(8).max(128),
});

export async function POST(request: NextRequest) {
  const requestMeta = getRequestMetadata(request.headers);
  const authResult = await requireApiAuth(request);

  if (!authResult.ok) {
    return authResult.response;
  }

  const csrfError = verifySameOrigin(request);

  if (csrfError) {
    return csrfError;
  }

  const bodyResult = await parseRequestJson(request);

  if (!bodyResult.ok) {
    return bodyResult.response;
  }

  const parsed = changePasswordSchema.safeParse(bodyResult.data);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const user = await prisma.user.findUnique({
    where: { id: authResult.auth.userId },
    select: {
      id: true,
      email: true,
      passwordHash: true,
    },
  });

  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const storedHash = user.passwordHash;

  if (!storedHash) {
    return NextResponse.json({ error: "Password login is not enabled for this account" }, { status: 400 });
  }

  const isValid = await verifyPassword(parsed.data.currentPassword, storedHash);

  if (!isValid) {
    await recordAuthAudit({
      action: "reset-password",
      success: false,
      userId: user.id,
      email: user.email,
      detail: "Change-password current password mismatch",
      ...requestMeta,
    });
    return NextResponse.json({ error: "Current password is incorrect" }, { status: 401 });
  }

  const passwordHash = await hashPassword(parsed.data.newPassword);

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash },
  });

  await revokeUserRefreshSessions(user.id);

  await recordAuthAudit({
    action: "reset-password",
    success: true,
    userId: user.id,
    email: user.email,
    detail: "In-session password change successful",
    ...requestMeta,
  });

  return NextResponse.json({ ok: true });
}