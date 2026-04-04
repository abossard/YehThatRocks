import { NextRequest, NextResponse } from "next/server";

import { getCurrentVideo, getRelatedVideos, getVideoPlaybackDecision, pruneVideoAndAssociationsByVideoId } from "@/lib/catalog-data";

const CURRENT_VIDEO_DEBUG_ENABLED = process.env.NODE_ENV === "development" && process.env.DEBUG_CATALOG === "1";
const CURRENT_VIDEO_CACHE_TTL_MS = 20_000;

type CurrentVideoPayload = {
  currentVideo: Awaited<ReturnType<typeof getCurrentVideo>>;
  relatedVideos: Awaited<ReturnType<typeof getRelatedVideos>>;
};

const currentVideoCache = new Map<string, { expiresAt: number; payload: CurrentVideoPayload }>();

function logCurrentVideoRoute(event: string, detail?: Record<string, unknown>) {
  if (!CURRENT_VIDEO_DEBUG_ENABLED) {
    return;
  }

  const payload = detail ? ` ${JSON.stringify(detail)}` : "";
  console.log(`[current-video-route] ${event}${payload}`);
}

export async function GET(request: NextRequest) {
  const v = request.nextUrl.searchParams.get("v") ?? undefined;
  const cacheKey = v ?? "__default__";
  const now = Date.now();

  const cached = currentVideoCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    logCurrentVideoRoute("request:cache-hit", { requestedVideoId: v });
    return NextResponse.json(cached.payload);
  }

  logCurrentVideoRoute("request:start", { requestedVideoId: v });

  try {
    if (v) {
      const decision = await getVideoPlaybackDecision(v);
      logCurrentVideoRoute("request:decision", {
        requestedVideoId: v,
        allowed: decision.allowed,
        reason: decision.reason,
      });

      if (!decision.allowed) {
        if (decision.reason === "unavailable") {
          await pruneVideoAndAssociationsByVideoId(v, "api-current-video-denied-unavailable").catch(() => undefined);
        }
        const currentVideo = await getCurrentVideo(undefined);
        const relatedVideos = await getRelatedVideos(currentVideo.id);

        logCurrentVideoRoute("request:denied", {
          requestedVideoId: v,
          fallbackVideoId: currentVideo.id,
        });

        return NextResponse.json({
          currentVideo,
          relatedVideos,
          denied: {
            videoId: v,
            reason: decision.reason,
            message: decision.message ?? "Sorry, that video cannot be played on YehThatRocks.",
          },
        });
      }
    }

    const currentVideo = await getCurrentVideo(v);
    const relatedVideos = await getRelatedVideos(currentVideo.id);
    const payload: CurrentVideoPayload = { currentVideo, relatedVideos };

    currentVideoCache.set(cacheKey, {
      expiresAt: now + CURRENT_VIDEO_CACHE_TTL_MS,
      payload,
    });

    logCurrentVideoRoute("request:success", {
      requestedVideoId: v,
      resolvedVideoId: currentVideo.id,
      relatedCount: relatedVideos.length,
    });

    return NextResponse.json(payload);
  } catch (error) {
    logCurrentVideoRoute("request:resolver-error", {
      requestedVideoId: v,
      error: error instanceof Error ? error.message : String(error),
    });

    return NextResponse.json(
      {
        error: "resolver-error",
      },
      {
        status: 503,
      },
    );
  }
}
