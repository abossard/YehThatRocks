import { NextRequest, NextResponse } from "next/server";

import { requireApiAuth } from "@/lib/auth-request";
import { getCurrentAuthenticatedUser } from "@/lib/server-auth";

const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || "simonjamesodell@live.co.uk").trim().toLowerCase();
const ADMIN_USER_ID = Number(process.env.ADMIN_USER_ID ?? "");
const ENFORCE_ADMIN_USER_ID = Number.isInteger(ADMIN_USER_ID) && ADMIN_USER_ID > 0;

export function isAdminIdentity(userId: number, email: string) {
  const normalizedEmail = email.trim().toLowerCase();
  if (normalizedEmail !== ADMIN_EMAIL) {
    return false;
  }

  if (!ENFORCE_ADMIN_USER_ID) {
    return true;
  }

  return userId === ADMIN_USER_ID;
}

export async function requireAdminApiAuth(request: NextRequest): Promise<
  | { ok: true; auth: { userId: number; email: string } }
  | { ok: false; response: NextResponse }
> {
  const authResult = await requireApiAuth(request);

  if (!authResult.ok) {
    return authResult;
  }

  if (!isAdminIdentity(authResult.auth.userId, authResult.auth.email)) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }

  return authResult;
}

export async function requireAdminUser() {
  const user = await getCurrentAuthenticatedUser();

  if (!user?.email || !isAdminIdentity(user.id, user.email)) {
    return null;
  }

  return user;
}
