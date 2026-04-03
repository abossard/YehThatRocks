import { NextRequest, NextResponse } from "next/server";

import { requireApiAuth } from "@/lib/auth-request";
import { prisma } from "@/lib/db";

type PrismaWithVerifiedUser = typeof prisma & {
  user: {
    findUnique: (args: {
      where: { id: number };
      select: { id: true; email: true; emailVerifiedAt: true; screenName: true; avatarUrl: true };
    }) => Promise<{
      id: number;
      email: string | null;
      emailVerifiedAt: Date | null;
      screenName: string | null;
      avatarUrl: string | null;
    } | null>;
  };
};

export async function GET(request: NextRequest) {
  const authResult = await requireApiAuth(request);

  if (!authResult.ok) {
    return authResult.response;
  }

  const user = await (prisma as PrismaWithVerifiedUser).user.findUnique({
    where: {
      id: authResult.auth.userId,
    },
    select: {
      id: true,
      email: true,
      emailVerifiedAt: true,
      screenName: true,
      avatarUrl: true,
    },
  });

  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  return NextResponse.json({ user });
}
