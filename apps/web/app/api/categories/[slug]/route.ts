import { NextRequest, NextResponse } from "next/server";

import { getArtistsByGenre, getGenreBySlug, getVideosByGenre } from "@/lib/catalog-data";

type CategoryRouteContext = {
  params: Promise<{ slug: string }>;
};

export async function GET(_request: NextRequest, context: CategoryRouteContext) {
  const { slug } = await context.params;
  const genre = await getGenreBySlug(slug);

  if (!genre) {
    return NextResponse.json({ error: "Category not found" }, { status: 404 });
  }

  const [videos, artists] = await Promise.all([getVideosByGenre(genre), getArtistsByGenre(genre)]);

  return NextResponse.json({
    genre,
    videos,
    artists
  });
}
