import { NextRequest, NextResponse } from "next/server";

import { getArtistsByLetter } from "@/lib/catalog-data";

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 60;

function parsePositiveInt(value: string | null, fallback: number) {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }

  return parsed;
}

export async function GET(request: NextRequest) {
  const letterParam = (request.nextUrl.searchParams.get("letter") ?? "").trim().toUpperCase();

  if (!/^[A-Z]$/.test(letterParam)) {
    return NextResponse.json({ error: "Invalid letter" }, { status: 400 });
  }

  const offset = parsePositiveInt(request.nextUrl.searchParams.get("offset"), 0);
  const requestedLimit = parsePositiveInt(request.nextUrl.searchParams.get("limit"), DEFAULT_LIMIT);
  const limit = Math.max(1, Math.min(requestedLimit, MAX_LIMIT));

  const rows = await getArtistsByLetter(letterParam, limit + 1, offset);
  const hasMore = rows.length > limit;
  const artists = hasMore ? rows.slice(0, limit) : rows;

  return NextResponse.json({
    letter: letterParam,
    offset,
    limit,
    hasMore,
    artists,
  });
}
