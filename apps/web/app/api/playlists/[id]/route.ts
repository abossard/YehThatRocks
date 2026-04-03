import { NextRequest, NextResponse } from "next/server";

import { requireApiAuth } from "@/lib/auth-request";
import { getPlaylistById } from "@/lib/catalog-data";

type PlaylistRouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: NextRequest, context: PlaylistRouteContext) {
  const authResult = await requireApiAuth(_request);

  if (!authResult.ok) {
    return authResult.response;
  }

  const { id } = await context.params;
  const playlist = await getPlaylistById(id, authResult.auth.userId);

  if (!playlist) {
    return NextResponse.json({ error: "Playlist not found" }, { status: 404 });
  }

  return NextResponse.json(playlist);
}
