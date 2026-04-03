import { NextRequest, NextResponse } from "next/server";

import { addPlaylistItemSchema } from "@/lib/api-schemas";
import { requireApiAuth } from "@/lib/auth-request";
import { addPlaylistItem } from "@/lib/catalog-data";
import { verifySameOrigin } from "@/lib/csrf";
import { parseRequestJson } from "@/lib/request-json";

type PlaylistItemsRouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: NextRequest, context: PlaylistItemsRouteContext) {
  const authResult = await requireApiAuth(request);

  if (!authResult.ok) {
    return authResult.response;
  }

  const csrfError = verifySameOrigin(request);

  if (csrfError) {
    return csrfError;
  }

  const { id } = await context.params;
  const bodyResult = await parseRequestJson(request);

  if (!bodyResult.ok) {
    return bodyResult.response;
  }

  const parsed = addPlaylistItemSchema.safeParse(bodyResult.data);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const playlist = await addPlaylistItem(id, parsed.data.videoId, authResult.auth.userId);

  if (!playlist) {
    return NextResponse.json({ error: "Playlist or video not found" }, { status: 404 });
  }

  return NextResponse.json(playlist, { status: 201 });
}
