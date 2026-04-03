import { NextRequest, NextResponse } from "next/server";

import { createPlaylistSchema } from "@/lib/api-schemas";
import { requireApiAuth } from "@/lib/auth-request";
import { createPlaylist, getPlaylists } from "@/lib/catalog-data";
import { verifySameOrigin } from "@/lib/csrf";
import { parseRequestJson } from "@/lib/request-json";

export async function GET(request: NextRequest) {
  const authResult = await requireApiAuth(request);

  if (!authResult.ok) {
    return authResult.response;
  }

  const playlists = await getPlaylists(authResult.auth.userId);
  return NextResponse.json({ playlists });
}

export async function POST(request: NextRequest) {
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

  const parsed = createPlaylistSchema.safeParse(bodyResult.data);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const playlist = await createPlaylist(parsed.data.name, parsed.data.videoIds, authResult.auth.userId);
  return NextResponse.json(playlist, { status: 201 });
}

