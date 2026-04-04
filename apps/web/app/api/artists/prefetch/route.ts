import { NextRequest, NextResponse } from "next/server";

import { getArtistBySlug, getVideosByArtist } from "@/lib/catalog-data";

export async function GET(request: NextRequest) {
  const slug = request.nextUrl.searchParams.get("slug")?.trim() ?? "";

  if (!slug) {
    return NextResponse.json({ ok: false, reason: "missing-slug" }, { status: 400 });
  }

  try {
    const artist = await getArtistBySlug(slug);

    if (!artist) {
      return NextResponse.json({ ok: false, reason: "not-found" }, { status: 404 });
    }

    await getVideosByArtist(artist.name);

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false, reason: "prefetch-failed" }, { status: 500 });
  }
}
