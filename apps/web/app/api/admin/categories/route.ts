import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireAdminApiAuth } from "@/lib/admin-auth";
import { prisma } from "@/lib/db";
import { verifySameOrigin } from "@/lib/csrf";
import { parseRequestJson } from "@/lib/request-json";

const updateSchema = z.object({
  id: z.number().int().positive(),
  genre: z.string().trim().min(1).max(255).optional(),
  thumbnailVideoId: z.string().trim().max(32).nullable().optional(),
});

export async function GET(request: NextRequest) {
  const auth = await requireAdminApiAuth(request);

  if (!auth.ok) {
    return auth.response;
  }

  const categories = await prisma.genreCard.findMany({
    orderBy: { genre: "asc" },
    take: 200,
    select: {
      id: true,
      genre: true,
      thumbnailVideoId: true,
      updatedAt: true,
    },
  });

  return NextResponse.json({ categories });
}

export async function PATCH(request: NextRequest) {
  const auth = await requireAdminApiAuth(request);

  if (!auth.ok) {
    return auth.response;
  }

  const csrf = verifySameOrigin(request);
  if (csrf) {
    return csrf;
  }

  const body = await parseRequestJson(request);
  if (!body.ok) {
    return body.response;
  }

  const parsed = updateSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const updated = await prisma.genreCard.update({
    where: { id: parsed.data.id },
    data: {
      ...(parsed.data.genre !== undefined ? { genre: parsed.data.genre } : {}),
      ...(parsed.data.thumbnailVideoId !== undefined
        ? { thumbnailVideoId: parsed.data.thumbnailVideoId || null }
        : {}),
    },
    select: {
      id: true,
      genre: true,
      thumbnailVideoId: true,
      updatedAt: true,
    },
  });

  return NextResponse.json({ ok: true, category: updated });
}
