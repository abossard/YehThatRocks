import { getTopVideos } from "@/lib/catalog-data";
import { videos as seedVideos, type VideoRecord } from "@/lib/catalog";

const TOP_VIDEOS_CACHE_TTL_MS = 60_000;

let cachedTopVideos: VideoRecord[] | null = null;
let cachedTopVideosExpiresAt = 0;
let topVideosRefreshPromise: Promise<VideoRecord[]> | null = null;

function getRefreshPromise(count: number) {
  if (!topVideosRefreshPromise) {
    topVideosRefreshPromise = getTopVideos(Math.max(count, 100))
      .then((videos) => {
        cachedTopVideos = videos;
        cachedTopVideosExpiresAt = Date.now() + TOP_VIDEOS_CACHE_TTL_MS;
        return videos;
      })
      .finally(() => {
        topVideosRefreshPromise = null;
      });
  }

  return topVideosRefreshPromise;
}

export function getCachedTopVideos(count: number) {
  const now = Date.now();
  if (!cachedTopVideos || cachedTopVideosExpiresAt <= now || cachedTopVideos.length < count) {
    return null;
  }

  return cachedTopVideos.slice(0, count);
}

export async function getTopVideosFast(count: number, waitMs: number) {
  const cached = getCachedTopVideos(count);
  if (cached) {
    return cached;
  }

  try {
    const topVideosPromise = getRefreshPromise(count);
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Timeout")), waitMs),
    );
    const videos = await Promise.race([topVideosPromise, timeoutPromise]);
    return videos.slice(0, count);
  } catch {
    return cachedTopVideos?.slice(0, count) ?? seedVideos.slice(0, count);
  }
}

export function warmTopVideos(count: number) {
  void getRefreshPromise(Math.max(count, 100));
}

export async function getRandomTopVideo(options?: { excludeVideoId?: string; relatedCount?: number; waitMs?: number }) {
  const excludeVideoId = options?.excludeVideoId?.trim() || undefined;
  const relatedCount = Math.max(0, Math.min(options?.relatedCount ?? 24, 99));
  const waitMs = Math.max(1, options?.waitMs ?? 350);

  let pool = getCachedTopVideos(100);
  if (!pool) {
    // Return quickly from seed while warming the canonical top pool in background.
    warmTopVideos(100);
    pool = await getTopVideosFast(100, Math.min(waitMs, 120));
  }

  const eligible =
    excludeVideoId && pool.length > 1
      ? pool.filter((video) => video.id !== excludeVideoId)
      : pool;

  const selected = eligible[Math.floor(Math.random() * eligible.length)] ?? pool[0] ?? seedVideos[0];
  const relatedVideos = pool.filter((video) => video.id !== selected.id).slice(0, relatedCount);

  return { selected, relatedVideos };
}
