import { getVideoForSharing, normalizeYouTubeVideoId } from "@/lib/catalog-data";

export const SHARE_SITE_NAME = "YehThatRocks";
export const SHARE_SITE_ORIGIN = "https://yehthatrocks.com";
export const SHARE_DEFAULT_TITLE = "YehThatRocks | The World's LOUDEST Website";
export const SHARE_DEFAULT_DESCRIPTION =
  "Community-driven rock and metal streaming, discovery, chat, and catalogue depth rebuilt for the modern web.";

export type ShareMetadataPayload = {
  normalizedVideoId: string;
  safeVideoTitle: string;
  shareTitle: string;
  shareDescription: string;
  shareUrl: string;
  playUrl: string;
  primaryImageUrl: string;
  secondaryImageUrl: string;
};

function normalizeOrigin(origin?: string) {
  const rawOrigin = origin?.trim() || process.env.NEXT_PUBLIC_SITE_ORIGIN?.trim() || SHARE_SITE_ORIGIN;
  return rawOrigin.replace(/\/$/, "");
}

export function buildCanonicalShareUrl(videoId: string, titleHint?: string, origin?: string) {
  const siteOrigin = normalizeOrigin(origin);
  const base = `${siteOrigin}/s/${encodeURIComponent(videoId)}`;
  const normalizedHint = titleHint?.trim();

  if (!normalizedHint) {
    return base;
  }

  const params = new URLSearchParams({ st: normalizedHint });
  return `${base}?${params.toString()}`;
}

type OEmbedPayload = {
  title?: string;
  thumbnail_url?: string;
};

async function fetchYouTubeOEmbed(videoId: string): Promise<OEmbedPayload | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2000);

  try {
    const watchUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
    const endpoint = `https://www.youtube.com/oembed?url=${encodeURIComponent(watchUrl)}&format=json`;
    const response = await fetch(endpoint, {
      signal: controller.signal,
      headers: {
        "user-agent": "YehThatRocksShareBot/1.0",
      },
      cache: "force-cache",
    });

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json().catch(() => null)) as OEmbedPayload | null;

    if (!payload) {
      return null;
    }

    return payload;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function resolveShareMetadata(videoId?: string, fallbackTitle?: string): Promise<ShareMetadataPayload | null> {
  return resolveShareMetadataForOrigin(videoId, fallbackTitle);
}

export async function resolveShareMetadataForOrigin(
  videoId?: string,
  fallbackTitle?: string,
  origin?: string,
): Promise<ShareMetadataPayload | null> {
  const normalizedVideoId = normalizeYouTubeVideoId(videoId);

  if (!normalizedVideoId) {
    return null;
  }

  const selectedVideo = await getVideoForSharing(normalizedVideoId);
  const oEmbed = selectedVideo?.title?.trim() ? null : await fetchYouTubeOEmbed(normalizedVideoId);
  const resolvedTitle = selectedVideo?.title?.trim() || oEmbed?.title?.trim() || fallbackTitle?.trim() || "Watch this video";
  const safeVideoTitle = resolvedTitle;
  const shareTitle = `${safeVideoTitle} | ${SHARE_SITE_NAME}`;
  const shareDescription =
    safeVideoTitle === "Watch this video"
      ? SHARE_DEFAULT_DESCRIPTION
      : `Watch ${safeVideoTitle} on ${SHARE_SITE_NAME}.`;
  const shareUrl = buildCanonicalShareUrl(normalizedVideoId, undefined, origin);
  const siteOrigin = normalizeOrigin(origin);
  const playUrl = `${siteOrigin}/?v=${encodeURIComponent(normalizedVideoId)}&resume=1`;

  // Use hqdefault as primary image because maxresdefault is frequently missing on YouTube videos.
  const primaryImageUrl = oEmbed?.thumbnail_url?.startsWith("https://")
    ? oEmbed.thumbnail_url
    : `https://i.ytimg.com/vi/${encodeURIComponent(normalizedVideoId)}/hqdefault.jpg`;
  const secondaryImageUrl = `https://i.ytimg.com/vi/${encodeURIComponent(normalizedVideoId)}/maxresdefault.jpg`;

  return {
    normalizedVideoId,
    safeVideoTitle,
    shareTitle,
    shareDescription,
    shareUrl,
    playUrl,
    primaryImageUrl,
    secondaryImageUrl,
  };
}
