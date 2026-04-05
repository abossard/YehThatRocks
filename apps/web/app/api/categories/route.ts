import { NextResponse } from "next/server";

import { getGenreCards } from "@/lib/catalog-data";

export async function GET() {
  const startedAt = Date.now();

  try {
    const categories = await getGenreCards();
    const durationMs = Date.now() - startedAt;

    return NextResponse.json(
      {
        categories,
        meta: {
          count: categories.length,
          durationMs,
        },
      },
      {
        headers: {
          "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
        },
      },
    );
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    const message = error instanceof Error ? error.message : "unknown error";

    return NextResponse.json(
      {
        categories: [],
        meta: {
          count: 0,
          durationMs,
          error: message,
        },
      },
      { status: 503 },
    );
  }
}
