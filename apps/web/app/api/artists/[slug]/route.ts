import { NextRequest, NextResponse } from "next/server";

import { getArtistBySlug, getArtists, getTopVideos } from "@/lib/catalog-data";

type ArtistRouteContext = {
  params: Promise<{ slug: string }>;
};

export async function GET(_request: NextRequest, context: ArtistRouteContext) {
  const { slug } = await context.params;
  const artist = await getArtistBySlug(slug);

  if (!artist) {
    return NextResponse.json({ error: "Artist not found" }, { status: 404 });
  }

  const topVideos = await getTopVideos();
  const matchingVideos = topVideos.filter((video) => {
    return video.channelTitle.toLowerCase().includes(artist.name.toLowerCase());
  });
  const relatedArtists = (await getArtists()).filter((entry) => entry.slug !== artist.slug).slice(0, 4);

  return NextResponse.json({
    artist,
    videos: matchingVideos,
    relatedArtists
  });
}
