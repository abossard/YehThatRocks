import { NextRequest, NextResponse } from "next/server";

import { verifyEmailSchema } from "@/lib/api-schemas";
import { getRequestMetadata, recordAuthAudit } from "@/lib/auth-audit";
import { consumeEmailVerificationToken } from "@/lib/auth-token-records";

export async function GET(request: NextRequest) {
  const requestMeta = getRequestMetadata(request.headers);
  const token = request.nextUrl.searchParams.get("token");
  const parsed = verifyEmailSchema.safeParse({ token });

  if (!parsed.success) {
    return NextResponse.redirect(new URL("/verify-email?status=invalid", request.url));
  }

  const userId = await consumeEmailVerificationToken(parsed.data.token);

  if (!userId) {
    await recordAuthAudit({ action: "verify-email", success: false, detail: "Invalid verification token", ...requestMeta });
    return NextResponse.redirect(new URL("/verify-email?status=invalid", request.url));
  }

  await recordAuthAudit({ action: "verify-email", success: true, userId, detail: "Email verified", ...requestMeta });
  return NextResponse.redirect(new URL("/verify-email?status=success", request.url));
}
