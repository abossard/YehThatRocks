import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireApiAuth } from "@/lib/auth-request";
import { verifySameOrigin } from "@/lib/csrf";
import { prisma } from "@/lib/db";
import { parseRequestJson } from "@/lib/request-json";

const profileSchema = z.object({
  screenName: z.string().trim().min(2).max(80),
  avatarUrl: z.union([
    z.literal(""),
    z.string().trim().url().max(500),
  ]),
  bio: z.string().trim().max(1200),
  location: z.string().trim().max(120),
});

type PrismaWithProfileUser = typeof prisma & {
  user: {
    findUnique: (args: {
      where: { id: number };
      select: {
        id: true;
        email: true;
        emailVerifiedAt: true;
        screenName: true;
        avatarUrl: true;
        bio: true;
        location: true;
      };
    }) => Promise<{
      id: number;
      email: string | null;
      emailVerifiedAt: Date | null;
      screenName: string | null;
      avatarUrl: string | null;
      bio: string | null;
      location: string | null;
    } | null>;
    update: (args: {
      where: { id: number };
      data: {
        screenName: string;
        avatarUrl: string | null;
        bio: string | null;
        location: string | null;
      };
      select: {
        id: true;
        email: true;
        emailVerifiedAt: true;
        screenName: true;
        avatarUrl: true;
        bio: true;
        location: true;
      };
    }) => Promise<{
      id: number;
      email: string | null;
      emailVerifiedAt: Date | null;
      screenName: string | null;
      avatarUrl: string | null;
      bio: string | null;
      location: string | null;
    }>;
  };
};

export async function GET(request: NextRequest) {
  const authResult = await requireApiAuth(request);

  if (!authResult.ok) {
    return authResult.response;
  }

  const user = await (prisma as PrismaWithProfileUser).user.findUnique({
    where: { id: authResult.auth.userId },
    select: {
      id: true,
      email: true,
      emailVerifiedAt: true,
      screenName: true,
      avatarUrl: true,
      bio: true,
      location: true,
    },
  });

  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  return NextResponse.json({
    user: {
      id: user.id,
      email: user.email,
      emailVerifiedAt: user.emailVerifiedAt,
      screenName: user.screenName,
      avatarUrl: user.avatarUrl,
      bio: user.bio,
      location: user.location,
    },
  });
}

export async function PATCH(request: NextRequest) {
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

  const parsed = profileSchema.safeParse(bodyResult.data);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const avatarUrl = parsed.data.avatarUrl.trim();

  const refreshedUser = await (prisma as PrismaWithProfileUser).user.update({
    where: { id: authResult.auth.userId },
    data: {
      screenName: parsed.data.screenName,
      avatarUrl: avatarUrl.length > 0 ? avatarUrl : null,
      bio: parsed.data.bio.length > 0 ? parsed.data.bio : null,
      location: parsed.data.location.length > 0 ? parsed.data.location : null,
    },
    select: {
      id: true,
      email: true,
      emailVerifiedAt: true,
      screenName: true,
      avatarUrl: true,
      bio: true,
      location: true,
    },
  });

  return NextResponse.json({
    ok: true,
    user: {
      id: refreshedUser.id,
      email: refreshedUser.email,
      emailVerifiedAt: refreshedUser.emailVerifiedAt,
      screenName: refreshedUser.screenName,
      avatarUrl: refreshedUser.avatarUrl,
      bio: refreshedUser.bio,
      location: refreshedUser.location,
    },
  });
}
