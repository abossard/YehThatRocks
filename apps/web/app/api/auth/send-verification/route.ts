import { NextRequest, NextResponse } from "next/server";

import { getRequestMetadata, recordAuthAudit } from "@/lib/auth-audit";
import { sendVerificationEmail } from "@/lib/auth-email";
import { requireApiAuth } from "@/lib/auth-request";
import { createEmailVerificationToken } from "@/lib/auth-token-records";
import { verifySameOrigin } from "@/lib/csrf";
import { prisma } from "@/lib/db";

type PrismaWithVerifiedUser = typeof prisma & {
  user: {
    findUnique: (args: {
      where: { id: number };
      select: { id: true; email: true; emailVerifiedAt: true };
    }) => Promise<{ id: number; email: string | null; emailVerifiedAt: Date | null } | null>;
  };
};

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

  const user = await (prisma as PrismaWithVerifiedUser).user.findUnique({
    where: { id: authResult.auth.userId },
    select: { id: true, email: true, emailVerifiedAt: true },
  });

  if (!user?.email) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  if (user.emailVerifiedAt) {
    return NextResponse.json({ ok: true, alreadyVerified: true });
  }

  const token = await createEmailVerificationToken(user.id);
  await sendVerificationEmail(user.email, token);
  await recordAuthAudit({ action: "verify-email", success: true, userId: user.id, email: user.email, detail: "Verification email sent", ...requestMeta });

  return NextResponse.json({ ok: true });
}
