import { NextRequest, NextResponse } from "next/server";

import { getRandomTopVideo } from "@/lib/top-videos-cache";

const TOP_RANDOM_WAIT_MS = 1_100;

export async function GET(request: NextRequest) {
  const exclude = request.nextUrl.searchParams.get("exclude") ?? undefined;
  const result = await getRandomTopVideo({
    excludeVideoId: exclude,
    relatedCount: 24,
    waitMs: TOP_RANDOM_WAIT_MS,
  });

  return NextResponse.json({
    video: result.selected,
    relatedVideos: result.relatedVideos,
  });
}
