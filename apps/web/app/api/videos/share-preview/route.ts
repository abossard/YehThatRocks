import { NextRequest, NextResponse } from "next/server";

import { getVideoForSharing, normalizeYouTubeVideoId } from "@/lib/catalog-data";

export async function GET(request: NextRequest) {
  const rawVideoId = request.nextUrl.searchParams.get("v") ?? "";
  const videoId = normalizeYouTubeVideoId(rawVideoId);

  if (!videoId) {
    return NextResponse.json({ error: "Invalid video id" }, { status: 400 });
  }

  const video = await getVideoForSharing(videoId);

  if (!video) {
    return NextResponse.json({ error: "Video not found" }, { status: 404 });
  }

  return NextResponse.json({
    video: {
      id: video.id,
      title: video.title,
      channelTitle: video.channelTitle,
    },
  });
}
