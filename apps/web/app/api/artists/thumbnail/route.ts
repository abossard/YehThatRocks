import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { refreshArtistThumbnailForName } from "@/lib/catalog-data";
import { parseRequestJson } from "@/lib/request-json";

const refreshArtistThumbnailSchema = z.object({
  artistName: z.string().trim().min(1).max(255),
  badVideoId: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_-]{11}$/)
    .optional(),
});

export async function POST(request: NextRequest) {
  const bodyResult = await parseRequestJson<unknown>(request);
  if (!bodyResult.ok) {
    return bodyResult.response;
  }

  const parsed = refreshArtistThumbnailSchema.safeParse(bodyResult.data);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const thumbnailVideoId = await refreshArtistThumbnailForName(
    parsed.data.artistName,
    parsed.data.badVideoId,
  );

  return NextResponse.json({
    ok: true,
    thumbnailVideoId,
  });
}
