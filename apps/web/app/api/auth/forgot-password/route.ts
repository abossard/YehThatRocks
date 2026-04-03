import { NextRequest, NextResponse } from "next/server";

import { forgotPasswordSchema } from "@/lib/api-schemas";
import { getRequestMetadata, recordAuthAudit } from "@/lib/auth-audit";
import { sendPasswordResetEmail } from "@/lib/auth-email";
import { createPasswordResetToken } from "@/lib/auth-token-records";
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

  const bodyResult = await parseRequestJson(request);

  if (!bodyResult.ok) {
    return bodyResult.response;
  }

  const parsed = forgotPasswordSchema.safeParse(bodyResult.data);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const email = parsed.data.email.toLowerCase().trim();
  const rateLimited = rateLimitOrResponse(request, `auth:forgot-password:${email}`, 6, 30 * 60 * 1000);

  if (rateLimited) {
    return rateLimited;
  }

  const user = await prisma.user.findFirst({
    where: { email },
    select: { id: true, email: true },
  });

  if (user?.email) {
    const token = await createPasswordResetToken(user.id);
    await sendPasswordResetEmail(user.email, token);
    await recordAuthAudit({ action: "forgot-password", success: true, email: user.email, userId: user.id, detail: "Password reset email issued", ...requestMeta });
  }

  return NextResponse.json({ ok: true });
}
