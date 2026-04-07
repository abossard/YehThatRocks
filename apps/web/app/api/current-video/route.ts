import { NextRequest, NextResponse } from "next/server";

import { getCurrentVideo, getRelatedVideos, getTopVideos, getVideoPlaybackDecision, pruneVideoAndAssociationsByVideoId } from "@/lib/catalog-data";

const CURRENT_VIDEO_DEBUG_ENABLED = process.env.NODE_ENV === "development" && process.env.DEBUG_CATALOG === "1";
const CURRENT_VIDEO_CACHE_TTL_MS = 20_000;
const CURRENT_VIDEO_FAILURE_COOLDOWN_MS = 8_000;
const CURRENT_VIDEO_PENDING_CACHE_TTL_MS = 2_000;
const CURRENT_VIDEO_RESOLVER_TIMEOUT_MS = 2_500;
const CURRENT_VIDEO_MAX_CONCURRENT_RESOLVERS = 1;

type CurrentVideoPayload = {
  currentVideo: Awaited<ReturnType<typeof getCurrentVideo>>;
  relatedVideos: Awaited<ReturnType<typeof getRelatedVideos>>;
};

type PendingPayload = {
  pending: true;
  denied?: { videoId: string; reason: string; message: string };
};

type CurrentVideoResolvePayload = CurrentVideoPayload | PendingPayload;

const currentVideoCache = new Map<string, { expiresAt: number; payload: CurrentVideoPayload }>();
const currentVideoPendingCache = new Map<string, { expiresAt: number; payload: PendingPayload }>();
const currentVideoInflight = new Map<string, Promise<CurrentVideoResolvePayload>>();
let currentVideoResolverBlockedUntil = 0;

function shuffleVideos<T>(rows: T[]) {
  const shuffled = [...rows];

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    const current = shuffled[index];
    shuffled[index] = shuffled[randomIndex];
    shuffled[randomIndex] = current;
  }

  return shuffled;
}

function uniqueVideosById<T extends { id: string }>(rows: T[]) {
  const seen = new Set<string>();
  const unique: T[] = [];

  for (const row of rows) {
    if (seen.has(row.id)) {
      continue;
    }

    seen.add(row.id);
    unique.push(row);
  }

  return unique;
}

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

  const cachedPending = currentVideoPendingCache.get(cacheKey);
  if (cachedPending && cachedPending.expiresAt > now) {
    logCurrentVideoRoute("request:pending-cache-hit", { requestedVideoId: v });
    return NextResponse.json(cachedPending.payload);
  }

  if (currentVideoResolverBlockedUntil > now) {
    logCurrentVideoRoute("request:cooldown", {
      requestedVideoId: v,
      blockedUntil: currentVideoResolverBlockedUntil,
    });
    const pendingPayload: PendingPayload = { pending: true };
    currentVideoPendingCache.set(cacheKey, {
      expiresAt: now + CURRENT_VIDEO_PENDING_CACHE_TTL_MS,
      payload: pendingPayload,
    });
    return NextResponse.json(pendingPayload);
  }

  const cached = currentVideoCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    logCurrentVideoRoute("request:cache-hit", { requestedVideoId: v });
    return NextResponse.json(cached.payload);
  }

  logCurrentVideoRoute("request:start", { requestedVideoId: v });

  const inFlight = currentVideoInflight.get(cacheKey);
  if (inFlight) {
    logCurrentVideoRoute("request:inflight-reuse", { requestedVideoId: v });
    const reusedPayload = await inFlight;
    return NextResponse.json(reusedPayload);
  }

  if (currentVideoInflight.size >= CURRENT_VIDEO_MAX_CONCURRENT_RESOLVERS) {
    logCurrentVideoRoute("request:concurrency-shed", {
      requestedVideoId: v,
      inflight: currentVideoInflight.size,
      limit: CURRENT_VIDEO_MAX_CONCURRENT_RESOLVERS,
    });
    const pendingPayload: PendingPayload = { pending: true };
    currentVideoPendingCache.set(cacheKey, {
      expiresAt: now + CURRENT_VIDEO_PENDING_CACHE_TTL_MS,
      payload: pendingPayload,
    });
    return NextResponse.json(pendingPayload);
  }

  const resolvePayloadPromise = (async () => {
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
        logCurrentVideoRoute("request:denied", {
          requestedVideoId: v,
          reason: decision.reason,
        });

        return {
          pending: true as const,
          denied: {
            videoId: v,
            reason: decision.reason,
            message: decision.message ?? "Sorry, that video cannot be played on YehThatRocks.",
          },
        };
      }
    }

    const currentVideo = await getCurrentVideo(v, { skipPlaybackDecision: Boolean(v) });
    if (!currentVideo?.id) {
      logCurrentVideoRoute("request:pending", {
        requestedVideoId: v,
      });

      return { pending: true as const };
    }

    const relatedVideos = await getRelatedVideos(currentVideo.id);
    const targetRelatedCount = 10;
    let paddedRelatedVideos = relatedVideos;

    if (relatedVideos.length < targetRelatedCount) {
      const topVideos = await getTopVideos(30);
      const blockedIds = new Set([currentVideo.id, ...relatedVideos.map((video) => video.id)]);
      const fillerPool = uniqueVideosById(topVideos.filter((video) => !blockedIds.has(video.id)));
      const filler = shuffleVideos(fillerPool).slice(0, targetRelatedCount - relatedVideos.length);
      paddedRelatedVideos = [...relatedVideos, ...filler];
    }

    const normalizedPayload: CurrentVideoPayload = { currentVideo, relatedVideos: paddedRelatedVideos };

    currentVideoCache.set(cacheKey, {
      expiresAt: Date.now() + CURRENT_VIDEO_CACHE_TTL_MS,
      payload: normalizedPayload,
    });

    currentVideoResolverBlockedUntil = 0;

    logCurrentVideoRoute("request:success", {
      requestedVideoId: v,
      resolvedVideoId: currentVideo.id,
      relatedCount: paddedRelatedVideos.length,
    });

    return normalizedPayload;
  })();

  const boundedResolvePromise = Promise.race<CurrentVideoResolvePayload>([
    resolvePayloadPromise,
    new Promise<PendingPayload>((resolve) => {
      setTimeout(() => {
        resolve({ pending: true });
      }, CURRENT_VIDEO_RESOLVER_TIMEOUT_MS);
    }),
  ]);

  currentVideoInflight.set(cacheKey, boundedResolvePromise);

  try {
    const payload = await boundedResolvePromise;
    if ("pending" in payload && payload.pending) {
      currentVideoPendingCache.set(cacheKey, {
        expiresAt: Date.now() + CURRENT_VIDEO_PENDING_CACHE_TTL_MS,
        payload,
      });
    }
    return NextResponse.json(payload);
  } catch (error) {
    currentVideoResolverBlockedUntil = Date.now() + CURRENT_VIDEO_FAILURE_COOLDOWN_MS;

    logCurrentVideoRoute("request:resolver-error", {
      requestedVideoId: v,
      error: error instanceof Error ? error.message : String(error),
      cooldownMs: CURRENT_VIDEO_FAILURE_COOLDOWN_MS,
    });

    const pendingPayload: PendingPayload = { pending: true };
    currentVideoPendingCache.set(cacheKey, {
      expiresAt: Date.now() + CURRENT_VIDEO_PENDING_CACHE_TTL_MS,
      payload: pendingPayload,
    });
    return NextResponse.json(pendingPayload);
  } finally {
    currentVideoInflight.delete(cacheKey);
  }
}
