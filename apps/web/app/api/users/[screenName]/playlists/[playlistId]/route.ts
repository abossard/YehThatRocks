import { NextRequest, NextResponse } from "next/server";

import { getPublicUserProfile, getPlaylistById } from "@/lib/catalog-data";

type PlaylistRouteContext = {
  params: Promise<{ screenName: string; playlistId: string }>;
};

function toJsonSafeValue(value: unknown): unknown {
  if (typeof value === "bigint") {
    const asNumber = Number(value);
    return Number.isSafeInteger(asNumber) ? asNumber : value.toString();
  }

  if (Array.isArray(value)) {
    return value.map((entry) => toJsonSafeValue(entry));
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
      key,
      toJsonSafeValue(entry),
    ]);
    return Object.fromEntries(entries);
  }

  return value;
}

export async function GET(_request: NextRequest, context: PlaylistRouteContext) {
  const { screenName, playlistId } = await context.params;
  const decodedScreenName = decodeURIComponent(screenName);
  const { user } = await getPublicUserProfile(decodedScreenName);

  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const playlist = await getPlaylistById(playlistId, user.id);

  if (!playlist) {
    return NextResponse.json({ error: "Playlist not found" }, { status: 404 });
  }

  return NextResponse.json(toJsonSafeValue(playlist));
}
