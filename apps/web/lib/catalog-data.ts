import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  aiTracks,
  artists as seedArtists,
  genres as seedGenres,
  getArtistBySlug as getSeedArtistBySlug,
  getRelatedVideos as getSeedRelatedVideos,
  getVideoById as getSeedVideoById,
  searchCatalog as searchSeedCatalog,
  videos as seedVideos,
  type AiTrackRecord,
  type ArtistRecord,
  type VideoRecord,
} from "@/lib/catalog";

export type DataSourceStatus = {
  mode: "seed" | "database" | "database-error";
  envConfigured: boolean;
  videoCount: number;
  artistCount: number;
  genreCount: number;
  detail: string;
};

export type PlaylistSummary = {
  id: string;
  name: string;
  itemCount: number;
  leadVideoId: string;
};

export type PlaylistDetail = {
  id: string;
  name: string;
  videos: VideoRecord[];
};

export type AiTrackDetail = AiTrackRecord & {
  description: string;
};

export type GenreCard = {
  genre: string;
  previewVideoId: string | null;
};

type PreviewStore = {
  favouriteIdsByUser: Map<number, Set<string>>;
  playlistsByUser: Map<number, PlaylistDetail[]>;
  aiTrackDetails: AiTrackDetail[];
};

type RankedVideoRow = {
  videoId: string;
  title: string;
  channelTitle: string | null;
  favourited: number;
  description: string | null;
};

type StoredVideoRow = RankedVideoRow & {
  id: number;
};

type YouTubeOEmbedResponse = {
  title?: string;
  author_name?: string;
  thumbnail_url?: string;
};

type VideoAvailabilityStatus = "available" | "unavailable" | "check-failed";

type VideoAvailability = {
  status: VideoAvailabilityStatus;
  reason: string;
};

type PersistableVideoRecord = VideoRecord & {
  thumbnail?: string;
};

type YouTubeRelatedSearchResponse = {
  items?: Array<{
    id?: {
      videoId?: string;
    };
    snippet?: {
      title?: string;
      channelTitle?: string;
      description?: string;
      thumbnails?: {
        high?: { url?: string };
        medium?: { url?: string };
        default?: { url?: string };
      };
    };
  }>;
};

const YOUTUBE_VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
const AGE_RESTRICTED_PATTERNS = [
  /Sign in to confirm your age/i,
  /age[-\s]?restricted/i,
  /playerAgeGateRenderer/i,
  /desktopLegacyAgeGateReason/i,
  /"isFamilySafe"\s*:\s*false/i,
  /"status"\s*:\s*"AGE_CHECK_REQUIRED"/i,
  /"status"\s*:\s*"LOGIN_REQUIRED"[\s\S]{0,240}"reason"\s*:\s*"[^"]*age/i,
];
const YOUTUBE_DATA_API_KEY = process.env.YOUTUBE_DATA_API_KEY?.trim() || undefined;

function debugCatalog(event: string, detail?: Record<string, unknown>) {
  if (process.env.NODE_ENV !== "development") {
    return;
  }

  const payload = detail ? ` ${JSON.stringify(detail)}` : "";
  console.log(`[catalog-data] ${event}${payload}`);
}

function containsAgeRestrictionMarker(html: string) {
  return AGE_RESTRICTED_PATTERNS.some((pattern) => pattern.test(html));
}

function truncate(value: string, maxLength: number) {
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

function getYouTubeThumbnailUrl(videoId: string) {
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

function dedupeRankedRows(rows: RankedVideoRow[]) {
  const byId = new Map<string, RankedVideoRow>();

  for (const row of rows) {
    if (!byId.has(row.videoId)) {
      byId.set(row.videoId, row);
    }
  }

  return [...byId.values()];
}

export function normalizeYouTubeVideoId(value?: string | null) {
  const trimmed = value?.trim();

  if (!trimmed) {
    return undefined;
  }

  if (YOUTUBE_VIDEO_ID_PATTERN.test(trimmed)) {
    return trimmed;
  }

  const candidates: string[] = [];

  try {
    const parsed = new URL(trimmed);
    const host = parsed.hostname.toLowerCase();

    if (host === "youtu.be" || host.endsWith(".youtu.be")) {
      const shortId = parsed.pathname.split("/").filter(Boolean)[0];
      if (shortId) {
        candidates.push(shortId);
      }
    }

    const searchId = parsed.searchParams.get("v");
    if (searchId) {
      candidates.push(searchId);
    }

    const segments = parsed.pathname.split("/").filter(Boolean);
    const embedLikeIndex = segments.findIndex((segment) => ["embed", "shorts", "live", "v"].includes(segment));
    if (embedLikeIndex >= 0 && segments[embedLikeIndex + 1]) {
      candidates.push(segments[embedLikeIndex + 1]);
    }
  } catch {
    const watchMatch = trimmed.match(/[?&]v=([A-Za-z0-9_-]{11})/);
    if (watchMatch?.[1]) {
      candidates.push(watchMatch[1]);
    }

    const shortMatch = trimmed.match(/youtu\.be\/([A-Za-z0-9_-]{11})/i);
    if (shortMatch?.[1]) {
      candidates.push(shortMatch[1]);
    }
  }

  return candidates.find((candidate) => YOUTUBE_VIDEO_ID_PATTERN.test(candidate));
}

const TOP_POOL_CACHE_TTL_MS = 5_000;
let topPoolCache:
  | {
      expiresAt: number;
      rows: RankedVideoRow[];
    }
  | undefined;

const PREVIEW_DEFAULT_USER_ID = 1;

const seedPlaylists: PlaylistDetail[] = [
  {
    id: "1",
    name: "Late Night Riffs",
    videos: [seedVideos[0], seedVideos[2], seedVideos[4]],
  },
  {
    id: "2",
    name: "Cathedral Echoes",
    videos: [seedVideos[3], seedVideos[0], seedVideos[1]],
  },
  {
    id: "3",
    name: "Gym Violence",
    videos: [seedVideos[4], seedVideos[2], seedVideos[1]],
  },
];

const seedAiTrackDetails: AiTrackDetail[] = aiTracks.map((track) => ({
  ...track,
  description: `A clearly labelled AI-generated ${track.genre.toLowerCase()} track presented as a distinct experience from YouTube videos.`,
}));

declare global {
  var __yehPreviewStore: PreviewStore | undefined;
}

function createPreviewStore(): PreviewStore {
  return {
    favouriteIdsByUser: new Map([
      [PREVIEW_DEFAULT_USER_ID, new Set(seedVideos.slice(0, 3).map((video) => video.id))],
    ]),
    playlistsByUser: new Map([
      [
        PREVIEW_DEFAULT_USER_ID,
        seedPlaylists.map((playlist) => ({
          ...playlist,
          videos: [...playlist.videos],
        })),
      ],
    ]),
    aiTrackDetails: seedAiTrackDetails.map((track) => ({ ...track })),
  };
}

function getPreviewStore(): PreviewStore {
  if (!globalThis.__yehPreviewStore) {
    globalThis.__yehPreviewStore = createPreviewStore();
  }

  return globalThis.__yehPreviewStore;
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function getGenreSlug(value: string) {
  return slugify(value);
}

export function hasDatabaseUrl() {
  return Boolean(process.env.DATABASE_URL);
}

async function getRankedTopPool(limit = 129): Promise<RankedVideoRow[]> {
  const now = Date.now();

  if (topPoolCache && topPoolCache.expiresAt > now && topPoolCache.rows.length >= limit) {
    return topPoolCache.rows.slice(0, limit);
  }

  const rows = await prisma.$queryRaw<RankedVideoRow[]>`
    SELECT
      v.videoId,
      v.title,
      NULL AS channelTitle,
      v.favourited,
      v.description
    FROM videos v
    LEFT JOIN related r ON r.videoId = v.videoId
    WHERE v.favourited = 1
      AND v.videoId REGEXP '^[A-Za-z0-9_-]{11}$'
      AND EXISTS (
        SELECT 1
        FROM site_videos sv
        INNER JOIN videos vv ON vv.id = sv.video_id
        WHERE vv.videoId = v.videoId
          AND sv.status = 'available'
      )
      AND NOT EXISTS (
        SELECT 1
        FROM site_videos sv
        INNER JOIN videos vv ON vv.id = sv.video_id
        WHERE vv.videoId = v.videoId
          AND (sv.status IS NULL OR sv.status <> 'available')
      )
    GROUP BY v.videoId, v.title, v.favourited, v.description
    ORDER BY v.favourited DESC, COUNT(r.id) DESC, MAX(v.views) DESC, v.videoId ASC
    LIMIT ${limit}
  `;

  const dedupedRows = dedupeRankedRows(rows);

  topPoolCache = {
    expiresAt: now + TOP_POOL_CACHE_TTL_MS,
    rows: dedupedRows,
  };

  return dedupedRows;
}

function mapVideo(video: {
  videoId: string;
  title: string;
  channelTitle: string | null;
  favourited: number;
  description: string | null;
}): VideoRecord {
  const inferredChannelTitle = video.title.includes(" - ")
    ? video.title.split(" - ", 1)[0].trim()
    : video.title.split("|", 1)[0].trim();

  return {
    id: video.videoId,
    title: video.title,
    channelTitle: video.channelTitle ?? (inferredChannelTitle || "Unknown Channel"),
    genre: "Rock / Metal",
    favourited: video.favourited,
    description: video.description ?? "Legacy video entry from the retained Yeh database.",
  };
}

function mapStoredVideoToPersistable(video: StoredVideoRow): PersistableVideoRecord {
  return {
    ...mapVideo(video),
  };
}

async function getStoredVideoById(videoId: string): Promise<StoredVideoRow | null> {
  const normalizedVideoId = normalizeYouTubeVideoId(videoId);

  if (!normalizedVideoId || !hasDatabaseUrl()) {
    return null;
  }

  const rows = await prisma.$queryRaw<StoredVideoRow[]>`
    SELECT
      id,
      videoId,
      title,
      NULL AS channelTitle,
      favourited,
      description
    FROM videos
    WHERE videoId = ${normalizedVideoId}
      AND videoId REGEXP '^[A-Za-z0-9_-]{11}$'
    ORDER BY updatedAt DESC, id DESC
    LIMIT 1
  `;

  debugCatalog("getStoredVideoById", {
    requestedVideoId: videoId,
    normalizedVideoId,
    found: rows.length > 0,
  });

  return rows[0] ?? null;
}

async function hasStoredRelatedCache(videoId: string) {
  const normalizedVideoId = normalizeYouTubeVideoId(videoId);

  if (!normalizedVideoId || !hasDatabaseUrl()) {
    return false;
  }

  const rows = await prisma.$queryRaw<Array<{ count: bigint | number }>>`
    SELECT COUNT(*) AS count
    FROM related
    WHERE videoId = ${normalizedVideoId}
  `;

  const countValue = rows[0]?.count;
  const count = typeof countValue === "bigint" ? Number(countValue) : Number(countValue ?? 0);
  return count > 0;
}

async function checkEmbedPlayability(videoId: string): Promise<VideoAvailability> {
  try {
    const response = await fetch(`https://www.youtube.com/embed/${encodeURIComponent(videoId)}?enablejsapi=1`, {
      headers: {
        "User-Agent": "YehThatRocks/1.0",
      },
    });

    if (!response.ok) {
      if ([401, 403, 404, 410].includes(response.status)) {
        return { status: "unavailable", reason: `embed:${response.status}` };
      }

      return { status: "check-failed", reason: `embed:${response.status}` };
    }

    const html = await response.text();

    if (containsAgeRestrictionMarker(html)) {
      return { status: "unavailable", reason: "embed:age-restricted" };
    }

    if (
      /"playabilityStatus"\s*:\s*\{\s*"status"\s*:\s*"(ERROR|UNPLAYABLE|LOGIN_REQUIRED|CONTENT_CHECK_REQUIRED|AGE_CHECK_REQUIRED)"/i.test(
        html,
      )
    ) {
      return { status: "unavailable", reason: "embed:playability-unavailable" };
    }

    if (/"playabilityStatus"\s*:\s*\{\s*"status"\s*:\s*"OK"/i.test(html)) {
      return { status: "available", reason: "embed:playability-ok" };
    }

    if (/video unavailable/i.test(html)) {
      return { status: "unavailable", reason: "embed:video-unavailable" };
    }

    return { status: "available", reason: "embed:accessible-no-markers" };
  } catch (error) {
    return {
      status: "check-failed",
      reason: `embed-network:${error instanceof Error ? error.message : "unknown"}`,
    };
  }
}

async function fetchOEmbedVideo(videoId: string): Promise<PersistableVideoRecord | null> {
  const normalizedVideoId = normalizeYouTubeVideoId(videoId);

  if (!normalizedVideoId) {
    return null;
  }

  try {
    const response = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${normalizedVideoId}`)}&format=json`,
      {
        headers: {
          "User-Agent": "YehThatRocks/1.0",
        },
      },
    );

    if (!response.ok) {
      debugCatalog("fetchOEmbedVideo:response-not-ok", {
        videoId: normalizedVideoId,
        status: response.status,
      });
      return null;
    }

    const data = (await response.json()) as YouTubeOEmbedResponse;
    const title = data.title?.trim();
    const channelTitle = data.author_name?.trim();

    if (!title) {
      debugCatalog("fetchOEmbedVideo:missing-title", {
        videoId: normalizedVideoId,
      });
      return null;
    }

    debugCatalog("fetchOEmbedVideo:success", {
      videoId: normalizedVideoId,
      title,
      channelTitle,
    });

    return {
      id: normalizedVideoId,
      title,
      channelTitle: channelTitle || "YouTube",
      genre: "Rock / Metal",
      favourited: 0,
      description: "Direct YouTube link loaded outside the local catalog.",
      thumbnail: data.thumbnail_url?.trim() || getYouTubeThumbnailUrl(normalizedVideoId),
    };
  } catch {
    debugCatalog("fetchOEmbedVideo:error", {
      videoId: normalizedVideoId,
    });
    return null;
  }
}

async function persistVideoAvailability(video: PersistableVideoRecord, availability: VideoAvailability) {
  const persistedTitle = truncate(video.title, 255);
  const persistedDescription = video.description;
  const persistedTimestamp = new Date();

  const existingVideo = await getStoredVideoById(video.id);

  if (existingVideo) {
    await prisma.$executeRaw`
      UPDATE videos
      SET
        title = ${persistedTitle},
        description = ${persistedDescription},
        updatedAt = ${persistedTimestamp}
      WHERE id = ${existingVideo.id}
    `;
  } else {
    await prisma.$executeRaw`
      INSERT INTO videos (videoId, title, favourited, description, createdAt, updatedAt)
      VALUES (
        ${video.id},
        ${persistedTitle},
        0,
        ${persistedDescription},
        ${persistedTimestamp},
        ${persistedTimestamp}
      )
    `;
  }

  debugCatalog("persistVideoAvailability:video-upserted", {
    videoId: video.id,
    hadExistingVideo: Boolean(existingVideo),
    availabilityStatus: availability.status,
    availabilityReason: availability.reason,
  });

  const persistedVideo = await getStoredVideoById(video.id);

  if (!persistedVideo) {
    throw new Error(`Failed to persist video ${video.id}`);
  }

  const existingSiteVideo = await prisma.siteVideo.findFirst({
    where: {
      videoId: persistedVideo.id,
    },
    select: {
      id: true,
    },
  });

  const titleWithReason = truncate(`${video.title} [${availability.reason}]`, 255);

  if (existingSiteVideo) {
    await prisma.siteVideo.update({
      where: {
        id: existingSiteVideo.id,
      },
      data: {
        title: titleWithReason,
        status: availability.status,
      },
    });
  } else {
    await prisma.siteVideo.create({
      data: {
        videoId: persistedVideo.id,
        title: titleWithReason,
        status: availability.status,
        createdAt: new Date(),
      },
    });
  }

  debugCatalog("persistVideoAvailability:site-video-updated", {
    videoId: video.id,
    hadExistingSiteVideo: Boolean(existingSiteVideo),
    status: availability.status,
  });

  return persistedVideo;
}

async function persistRelatedVideoCache(videoId: string, relatedIds: string[]) {
  const persistedRelatedIds = relatedIds.length > 0 ? relatedIds : [videoId];

  await prisma.relatedCache.deleteMany({
    where: {
      videoId,
    },
  });

  await prisma.relatedCache.createMany({
    data: persistedRelatedIds.map((relatedId) => ({
      videoId,
      related: relatedId,
      createdAt: new Date(),
      updatedAt: new Date(),
    })),
  });
}

async function fetchRelatedYouTubeVideos(videoId: string): Promise<PersistableVideoRecord[]> {
  if (!YOUTUBE_DATA_API_KEY) {
    debugCatalog("fetchRelatedYouTubeVideos:skipped-missing-api-key", { videoId });
    return [];
  }

  try {
    const url = new URL("https://www.googleapis.com/youtube/v3/search");
    url.searchParams.set("part", "snippet");
    url.searchParams.set("maxResults", "8");
    url.searchParams.set("relatedToVideoId", videoId);
    url.searchParams.set("type", "video");
    url.searchParams.set("key", YOUTUBE_DATA_API_KEY);

    const response = await fetch(url, {
      headers: {
        "User-Agent": "YehThatRocks/1.0",
      },
    });

    if (!response.ok) {
      debugCatalog("fetchRelatedYouTubeVideos:response-not-ok", {
        videoId,
        status: response.status,
      });
      return [];
    }

    const data = (await response.json()) as YouTubeRelatedSearchResponse;

    const mapped = (data.items ?? [])
      .map((item) => {
        const relatedId = normalizeYouTubeVideoId(item.id?.videoId);
        const title = item.snippet?.title?.trim();

        if (!relatedId || !title || relatedId === videoId) {
          return null;
        }

        return {
          id: relatedId,
          title,
          channelTitle: item.snippet?.channelTitle?.trim() || "YouTube",
          genre: "Rock / Metal",
          favourited: 0,
          description: item.snippet?.description?.trim() || "Related YouTube video discovered via YouTube Data API.",
          thumbnail:
            item.snippet?.thumbnails?.high?.url?.trim() ||
            item.snippet?.thumbnails?.medium?.url?.trim() ||
            item.snippet?.thumbnails?.default?.url?.trim() ||
            getYouTubeThumbnailUrl(relatedId),
        } satisfies PersistableVideoRecord;
      })
      .filter((item): item is PersistableVideoRecord => Boolean(item));

    debugCatalog("fetchRelatedYouTubeVideos:success", {
      videoId,
      relatedCount: mapped.length,
    });

    return mapped;
  } catch {
    debugCatalog("fetchRelatedYouTubeVideos:error", { videoId });
    return [];
  }
}

async function hydrateAndPersistVideo(
  videoId: string,
  providedVideo?: PersistableVideoRecord,
): Promise<PersistableVideoRecord | null> {
  if (!hasDatabaseUrl()) {
    return providedVideo ?? (await fetchOEmbedVideo(videoId));
  }

  const normalizedVideoId = normalizeYouTubeVideoId(videoId);

  if (!normalizedVideoId) {
    debugCatalog("hydrateAndPersistVideo:invalid-video-id", { videoId });
    return null;
  }

  const existingVideo = await getStoredVideoById(normalizedVideoId);

  if (existingVideo) {
    debugCatalog("hydrateAndPersistVideo:local-hit", { videoId: normalizedVideoId });
    return mapStoredVideoToPersistable(existingVideo);
  }

  debugCatalog("hydrateAndPersistVideo:local-miss", { videoId: normalizedVideoId });

  const video = providedVideo ?? (await fetchOEmbedVideo(normalizedVideoId));

  if (!video) {
    debugCatalog("hydrateAndPersistVideo:no-external-video", { videoId: normalizedVideoId });
    return null;
  }

  const availability = await checkEmbedPlayability(normalizedVideoId);
  debugCatalog("hydrateAndPersistVideo:availability", {
    videoId: normalizedVideoId,
    status: availability.status,
    reason: availability.reason,
  });
  await persistVideoAvailability(video, availability);

  if (availability.status !== "unavailable" && !(await hasStoredRelatedCache(normalizedVideoId))) {
    const relatedVideos = await fetchRelatedYouTubeVideos(normalizedVideoId);
    const availableRelatedIds: string[] = [];

    for (const relatedVideo of relatedVideos) {
      const relatedAvailability = await checkEmbedPlayability(relatedVideo.id);
      await persistVideoAvailability(relatedVideo, relatedAvailability);

      if (relatedAvailability.status === "available") {
        availableRelatedIds.push(relatedVideo.id);
      }
    }

    await persistRelatedVideoCache(normalizedVideoId, availableRelatedIds);
  }

  return video;
}

async function getExternalVideoById(videoId: string): Promise<VideoRecord | null> {
  const video = await hydrateAndPersistVideo(videoId);
  return video;
}

function mapArtist(artist: {
  name: string;
  country: string | null;
  genre1: string | null;
}): ArtistRecord {
  return {
    name: artist.name,
    slug: slugify(artist.name),
    country: artist.country ?? "Unknown",
    genre: artist.genre1 ?? "Rock / Metal",
  };
}

export async function getCurrentVideo(videoId?: string) {
  const normalizedVideoId = normalizeYouTubeVideoId(videoId);

  debugCatalog("getCurrentVideo:start", {
    inputVideoId: videoId,
    normalizedVideoId,
    hasDatabase: hasDatabaseUrl(),
  });

  if (!hasDatabaseUrl()) {
    return getSeedVideoById(normalizedVideoId);
  }

  try {
    if (normalizedVideoId) {
      const storedVideo = await getStoredVideoById(normalizedVideoId);

      if (storedVideo) {
        debugCatalog("getCurrentVideo:return-local-video", {
          videoId: normalizedVideoId,
        });
        return mapVideo(storedVideo);
      }
    }

    const videos = normalizedVideoId
      ? await prisma.$queryRaw<
          RankedVideoRow[]
        >`
          SELECT
            videoId,
            title,
            NULL AS channelTitle,
            favourited,
            description
          FROM videos
          WHERE videoId = ${normalizedVideoId}
            AND videoId REGEXP '^[A-Za-z0-9_-]{11}$'
            AND EXISTS (
              SELECT 1
              FROM site_videos sv
              INNER JOIN videos vv ON vv.id = sv.video_id
              WHERE vv.videoId = videos.videoId
                AND sv.status = 'available'
            )
            AND NOT EXISTS (
              SELECT 1
              FROM site_videos sv
              INNER JOIN videos vv ON vv.id = sv.video_id
              WHERE vv.videoId = videos.videoId
                AND (sv.status IS NULL OR sv.status <> 'available')
            )
          LIMIT 1
        `
      : await getRankedTopPool(1);

    const video = videos[0];

    if (video) {
      debugCatalog("getCurrentVideo:return-query-video", {
        videoId: video.videoId,
      });
      return mapVideo(video);
    }

    if (normalizedVideoId) {
      const externalVideo = await getExternalVideoById(normalizedVideoId);
      if (externalVideo) {
        debugCatalog("getCurrentVideo:return-external-video", {
          videoId: normalizedVideoId,
        });
        return externalVideo;
      }
    }

    debugCatalog("getCurrentVideo:return-seed-video", {
      videoId: normalizedVideoId,
      reason: "no-query-or-external-hit",
    });

    return getSeedVideoById(normalizedVideoId);
  } catch {
    if (normalizedVideoId) {
      const externalVideo = await getExternalVideoById(normalizedVideoId);
      if (externalVideo) {
        debugCatalog("getCurrentVideo:return-external-video-after-error", {
          videoId: normalizedVideoId,
        });
        return externalVideo;
      }
    }

    debugCatalog("getCurrentVideo:return-seed-video-after-error", {
      videoId: normalizedVideoId,
    });

    return getSeedVideoById(normalizedVideoId);
  }
}

export async function getRelatedVideos(videoId: string) {
  if (!hasDatabaseUrl()) {
    return getSeedRelatedVideos(videoId);
  }

  try {
    const mappedVideos = await prisma.$queryRaw<RankedVideoRow[]>`
      SELECT
        v.videoId,
        v.title,
        NULL AS channelTitle,
        v.favourited,
        v.description
      FROM related r
      INNER JOIN videos v ON v.videoId = r.related
      WHERE r.videoId = ${videoId}
        AND r.related <> ${videoId}
        AND v.videoId REGEXP '^[A-Za-z0-9_-]{11}$'
        AND EXISTS (
          SELECT 1
          FROM site_videos sv
          INNER JOIN videos vv ON vv.id = sv.video_id
          WHERE vv.videoId = v.videoId
            AND sv.status = 'available'
        )
        AND NOT EXISTS (
          SELECT 1
          FROM site_videos sv
          INNER JOIN videos vv ON vv.id = sv.video_id
          WHERE vv.videoId = v.videoId
            AND (sv.status IS NULL OR sv.status <> 'available')
        )
      GROUP BY v.videoId, v.title, v.favourited, v.description
      ORDER BY v.favourited DESC, MAX(v.views) DESC, v.videoId ASC
      LIMIT 6
    `;

    const mappedUnique = dedupeRankedRows(mappedVideos);
    const existingIds = mappedUnique.map((video) => video.videoId);
    const fallbackVideos = mappedUnique.length >= 6
      ? []
      : (await getRankedTopPool(129))
          .filter((row) => ![videoId, ...existingIds].includes(row.videoId))
          .slice(0, 6 - mappedUnique.length);

    const videos = dedupeRankedRows([...mappedUnique, ...fallbackVideos]).slice(0, 6);

    return videos.length > 0 ? videos.map(mapVideo) : getSeedRelatedVideos(videoId);
  } catch {
    return getSeedRelatedVideos(videoId);
  }
}

export async function getTopVideos(count = 100) {
  if (!hasDatabaseUrl()) {
    return seedVideos;
  }

  try {
    const videos = await getRankedTopPool(Math.max(count, 1));

    return videos.length > 0 ? videos.slice(0, count).map(mapVideo) : seedVideos;
  } catch {
    return seedVideos;
  }
}

export async function getArtists() {
  if (!hasDatabaseUrl()) {
    return seedArtists;
  }

  try {
    const artists = await prisma.artist.findMany({
      orderBy: { name: "asc" },
      take: 24,
      select: {
        name: true,
        country: true,
        genre1: true,
      },
    });

    return artists.length > 0 ? artists.map(mapArtist) : seedArtists;
  } catch {
    return seedArtists;
  }
}

export async function getArtistBySlug(slug: string) {
  if (!hasDatabaseUrl()) {
    return getSeedArtistBySlug(slug);
  }

  try {
    const artists = await prisma.artist.findMany({
      select: {
        name: true,
        country: true,
        genre1: true,
      },
    });

    const match = artists.map(mapArtist).find((artist) => artist.slug === slug);
    return match ?? getSeedArtistBySlug(slug);
  } catch {
    return getSeedArtistBySlug(slug);
  }
}

export async function searchCatalog(query: string) {
  if (!hasDatabaseUrl()) {
    return searchSeedCatalog(query);
  }

  const normalized = query.trim();

  if (!normalized) {
    return {
      videos: await getTopVideos(),
      artists: await getArtists(),
      genres: seedGenres.slice(0, 6),
    };
  }

  try {
    const [videos, artists] = await Promise.all([
      prisma.video.findMany({
        where: {
          OR: [
            { title: { contains: normalized } },
            { channelTitle: { contains: normalized } },
          ],
        },
        take: 12,
        select: {
          videoId: true,
          title: true,
          channelTitle: true,
          favourited: true,
          description: true,
        },
      }),
      prisma.artist.findMany({
        where: {
          OR: [
            { name: { contains: normalized } },
            { genre1: { contains: normalized } },
            { country: { contains: normalized } },
          ],
        },
        take: 12,
        select: {
          name: true,
          country: true,
          genre1: true,
        },
      }),
    ]);

    return {
      videos: videos.length > 0 ? videos.map(mapVideo) : searchSeedCatalog(query).videos,
      artists: artists.length > 0 ? artists.map(mapArtist) : searchSeedCatalog(query).artists,
      genres: seedGenres.filter((genre) => genre.toLowerCase().includes(normalized.toLowerCase())),
    };
  } catch {
    return searchSeedCatalog(query);
  }
}

export async function getGenres() {
  if (!hasDatabaseUrl()) {
    return seedGenres;
  }

  try {
    const rows = await prisma.$queryRaw<Array<{ genre: string | null }>>`
      SELECT genre
      FROM genres
      WHERE genre IS NOT NULL
        AND TRIM(genre) <> ''
      ORDER BY genre ASC
      LIMIT 200
    `;

    const genres = rows
      .map((row) => row.genre?.trim() ?? "")
      .filter((genre): genre is string => genre.length > 0);

    return genres.length > 0 ? genres : seedGenres;
  } catch {
    return seedGenres;
  }
}

export async function getGenreCards() {
  const genres = await getGenres();

  if (!hasDatabaseUrl()) {
    return genres.map((genre) => ({ genre, previewVideoId: null }));
  }

  try {
    const previewPool = await getRankedTopPool(129);

    if (previewPool.length === 0) {
      return genres.map((genre) => ({ genre, previewVideoId: null }));
    }

    const step = previewPool.length > 1 ? previewPool.length - 1 : 1;

    return genres.map((genre, index) => ({
      genre,
      previewVideoId: previewPool[(index * step) % previewPool.length]?.videoId ?? null,
    }));
  } catch {
    return genres.map((genre) => ({ genre, previewVideoId: null }));
  }
}

export async function getAiTracks(): Promise<AiTrackRecord[]> {
  return getPreviewStore().aiTrackDetails.map(({ description, ...track }) => track);
}

export async function getAiTrackById(id: string): Promise<AiTrackDetail | null> {
  const fallback = getPreviewStore().aiTrackDetails.find((track) => track.id === id) ?? null;

  if (!hasDatabaseUrl()) {
    return fallback;
  }

  const numericId = Number(id);

  if (!Number.isInteger(numericId)) {
    return fallback;
  }

  try {
    const track = await prisma.aiTrack.findUnique({
      where: { id: numericId },
      select: {
        id: true,
        title: true,
        description: true,
        prompt: true,
        tool: true,
        playCount: true,
      },
    });

    if (!track) {
      return fallback;
    }

    return {
      id: String(track.id),
      title: track.title,
      tool: track.tool ?? "Other",
      genre: "AI Rock / Metal",
      playCount: track.playCount,
      score: 0,
      prompt: track.prompt ?? "Prompt unavailable",
      description: track.description ?? "AI-generated track from the retained Yeh dataset.",
    };
  } catch {
    return fallback;
  }
}

export async function getGenreBySlug(slug: string) {
  const genres = await getGenres();
  return genres.find((genre) => getGenreSlug(genre) === slug);
}

function getArtistsByGenreFallback(genre: string) {
  return seedArtists.filter((artist) => {
    return artist.genre.toLowerCase().includes(genre.toLowerCase());
  });
}

export async function getArtistsByGenre(genre: string) {
  if (!hasDatabaseUrl()) {
    return getArtistsByGenreFallback(genre);
  }

  try {
    const artists = await prisma.$queryRaw<Array<{ name: string; country: string | null; genre1: string | null }>>`
      SELECT
        a.name,
        a.origin AS country,
        COALESCE(a.genre1, a.genre2, a.genre3, a.genre4, a.genre5, a.genre6) AS genre1
      FROM artists a
      WHERE (
        a.genre1 LIKE CONCAT('%', ${genre}, '%')
        OR a.genre2 LIKE CONCAT('%', ${genre}, '%')
        OR a.genre3 LIKE CONCAT('%', ${genre}, '%')
        OR a.genre4 LIKE CONCAT('%', ${genre}, '%')
        OR a.genre5 LIKE CONCAT('%', ${genre}, '%')
        OR a.genre6 LIKE CONCAT('%', ${genre}, '%')
      )
      ORDER BY a.name ASC
      LIMIT 24
    `;

    return artists.length > 0 ? artists.map(mapArtist) : getArtistsByGenreFallback(genre);
  } catch {
    return getArtistsByGenreFallback(genre);
  }
}

export async function getVideosByGenre(genre: string) {
  const genreHash = genre.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0);

  const getGenreFallback = async () => {
    const fallbackPool = await getRankedTopPool(129);
    if (fallbackPool.length === 0) {
      return seedVideos;
    }

    const start = genreHash % fallbackPool.length;
    const rotated = [...fallbackPool.slice(start), ...fallbackPool.slice(0, start)].slice(0, 24);
    return rotated.map(mapVideo);
  };

  const getGenreKeywordVideos = async () => {
    const rows = await prisma.$queryRaw<RankedVideoRow[]>`
      SELECT
        v.videoId,
        v.title,
        NULL AS channelTitle,
        v.favourited,
        v.description
      FROM videos v
      WHERE (
        v.title LIKE CONCAT('%', ${genre}, '%')
        OR v.description LIKE CONCAT('%', ${genre}, '%')
      )
        AND v.videoId REGEXP '^[A-Za-z0-9_-]{11}$'
        AND EXISTS (
          SELECT 1
          FROM site_videos sv
          INNER JOIN videos vv ON vv.id = sv.video_id
          WHERE vv.videoId = v.videoId
            AND sv.status = 'available'
        )
        AND NOT EXISTS (
          SELECT 1
          FROM site_videos sv
          INNER JOIN videos vv ON vv.id = sv.video_id
          WHERE vv.videoId = v.videoId
            AND (sv.status IS NULL OR sv.status <> 'available')
        )
      ORDER BY v.favourited DESC, v.views DESC, v.videoId ASC
      LIMIT 24
    `;

    return rows;
  };

  if (!hasDatabaseUrl()) {
    return seedVideos;
  }

  try {
    const artists = await getArtistsByGenre(genre);
    const artistNames = [...new Set(artists.map((artist) => artist.name).filter(Boolean))].slice(0, 8);

    if (artistNames.length === 0) {
      const keywordVideos = await getGenreKeywordVideos();
      if (keywordVideos.length > 0) {
        return keywordVideos.map(mapVideo);
      }

      return await getGenreFallback();
    }

    const titleFilters = artistNames.map(
      (artistName) => Prisma.sql`v.title LIKE CONCAT('%', ${artistName}, '%')`
    );

    const videos = await prisma.$queryRaw<RankedVideoRow[]>`
      SELECT
        v.videoId,
        v.title,
        NULL AS channelTitle,
        v.favourited,
        v.description
      FROM videos v
      WHERE (
        ${Prisma.join(titleFilters, Prisma.sql` OR `)}
      )
        AND v.videoId REGEXP '^[A-Za-z0-9_-]{11}$'
        AND EXISTS (
          SELECT 1
          FROM site_videos sv
          INNER JOIN videos vv ON vv.id = sv.video_id
          WHERE vv.videoId = v.videoId
            AND sv.status = 'available'
        )
        AND NOT EXISTS (
          SELECT 1
          FROM site_videos sv
          INNER JOIN videos vv ON vv.id = sv.video_id
          WHERE vv.videoId = v.videoId
            AND (sv.status IS NULL OR sv.status <> 'available')
        )
      ORDER BY v.favourited DESC, v.views DESC, v.videoId ASC
      LIMIT 24
    `;

    if (videos.length > 0) {
      return videos.map(mapVideo);
    }

    const keywordVideos = await getGenreKeywordVideos();
    if (keywordVideos.length > 0) {
      return keywordVideos.map(mapVideo);
    }

    return await getGenreFallback();
  } catch {
    return await getGenreFallback();
  }
}

export async function getDataSourceStatus(): Promise<DataSourceStatus> {
  const envConfigured = hasDatabaseUrl();

  if (!envConfigured) {
    return {
      mode: "seed",
      envConfigured: false,
      videoCount: seedVideos.length,
      artistCount: seedArtists.length,
      genreCount: seedGenres.length,
      detail: "DATABASE_URL not set. Using seeded preview data.",
    };
  }

  try {
    const [videoCount, artistCount, genreCount] = await Promise.all([
      prisma.video.count(),
      prisma.artist.count(),
      prisma.genre.count(),
    ]);

    return {
      mode: "database",
      envConfigured: true,
      videoCount,
      artistCount,
      genreCount,
      detail: "Connected to the retained Yeh MySQL dataset.",
    };
  } catch {
    return {
      mode: "database-error",
      envConfigured: true,
      videoCount: seedVideos.length,
      artistCount: seedArtists.length,
      genreCount: seedGenres.length,
      detail: "DATABASE_URL is set, but the live database is not reachable yet. Falling back to seeded preview data.",
    };
  }
}

function getSeedPlaylists() {
  return getPreviewStore().playlistsByUser.get(PREVIEW_DEFAULT_USER_ID) ?? [];
}

function getPreviewUserId(userId?: number) {
  return userId ?? PREVIEW_DEFAULT_USER_ID;
}

function getPreviewFavouriteIds(userId?: number) {
  const store = getPreviewStore();
  const resolvedUserId = getPreviewUserId(userId);

  const existing = store.favouriteIdsByUser.get(resolvedUserId);

  if (existing) {
    return existing;
  }

  const created = new Set(seedVideos.slice(0, 3).map((video) => video.id));
  store.favouriteIdsByUser.set(resolvedUserId, created);
  return created;
}

function getPreviewPlaylists(userId?: number) {
  const store = getPreviewStore();
  const resolvedUserId = getPreviewUserId(userId);
  const existing = store.playlistsByUser.get(resolvedUserId);

  if (existing) {
    return existing;
  }

  const created = seedPlaylists.map((playlist) => ({
    ...playlist,
    videos: [...playlist.videos],
  }));
  store.playlistsByUser.set(resolvedUserId, created);
  return created;
}

function toPlaylistSummary(playlist: PlaylistDetail): PlaylistSummary {
  return {
    id: playlist.id,
    name: playlist.name,
    itemCount: playlist.videos.length,
    leadVideoId: playlist.videos[0]?.id ?? seedVideos[0].id,
  };
}

export async function getPlaylists(userId?: number): Promise<PlaylistSummary[]> {
  if (!hasDatabaseUrl()) {
    return getPreviewPlaylists(userId).map(toPlaylistSummary);
  }

  if (!userId) {
    return [];
  }

  try {
    const playlists = await prisma.playlistName.findMany({
      where: {
        userId,
      },
      orderBy: { id: "asc" },
      take: 24,
      include: {
        items: {
          orderBy: { sortOrder: "asc" },
          take: 1,
          include: {
            video: {
              select: {
                videoId: true,
              },
            },
          },
        },
        _count: {
          select: {
            items: true,
          },
        },
      },
    });

    if (playlists.length === 0) {
      return getPreviewPlaylists(userId).map(toPlaylistSummary);
    }

    return playlists.map((playlist) => ({
      id: String(playlist.id),
      name: playlist.name,
      itemCount: playlist._count.items,
      leadVideoId: playlist.items[0]?.video.videoId ?? seedVideos[0].id,
    }));
  } catch {
    return getPreviewPlaylists(userId).map(toPlaylistSummary);
  }
}

export async function getPlaylistById(id: string, userId?: number): Promise<PlaylistDetail | null> {
  const fallback = getPreviewPlaylists(userId).find((playlist) => playlist.id === id) ?? null;

  if (!hasDatabaseUrl()) {
    return fallback;
  }

  const numericId = Number(id);

  if (!Number.isInteger(numericId)) {
    return fallback;
  }

  try {
    const playlist = await prisma.playlistName.findUnique({
      where: { id: numericId },
      include: {
        items: {
          orderBy: { sortOrder: "asc" },
          include: {
            video: {
              select: {
                videoId: true,
                title: true,
                channelTitle: true,
                favourited: true,
                description: true,
              },
            },
          },
        },
      },
    });

    if (!playlist || playlist.userId !== userId || playlist.items.length === 0) {
      return fallback;
    }

    return {
      id: String(playlist.id),
      name: playlist.name,
      videos: playlist.items.map((item) => mapVideo(item.video)),
    };
  } catch {
    return fallback;
  }
}

export async function getFavouriteVideos(userId?: number) {
  if (hasDatabaseUrl() && userId) {
    try {
      const favourites = await prisma.favourite.findMany({
        where: {
          userId,
        },
        include: {
          video: {
            select: {
              videoId: true,
              title: true,
              channelTitle: true,
              favourited: true,
              description: true,
            },
          },
        },
        take: 50,
      });

      if (favourites.length > 0) {
        return favourites.map((entry) => mapVideo(entry.video));
      }
    } catch {
      // Fall through to preview fallback.
    }
  }

  const topVideos = await getTopVideos();
  const combined = [...topVideos, ...seedVideos].filter(
    (video, index, array) => array.findIndex((entry) => entry.id === video.id) === index,
  );
  const previewIds = getPreviewFavouriteIds(userId);

  const favourites = combined.filter((video) => previewIds.has(video.id));
  return favourites.length > 0 ? favourites : seedVideos.slice(0, 3);
}

export async function updateFavourite(videoId: string, action: "add" | "remove", userId?: number) {
  if (hasDatabaseUrl() && userId) {
    const video = await prisma.video.findUnique({
      where: { videoId },
      select: { id: true },
    });

    if (!video) {
      return {
        videoId,
        isFavourite: false,
        favourites: await getFavouriteVideos(userId),
      };
    }

    if (action === "add") {
      const existing = await prisma.favourite.findFirst({
        where: {
          userId,
          videoId: video.id,
        },
        select: { id: true },
      });

      if (!existing) {
        await prisma.favourite.create({
          data: {
            userId,
            videoId: video.id,
          },
        });
      }
    } else {
      await prisma.favourite.deleteMany({
        where: {
          userId,
          videoId: video.id,
        },
      });
    }

    return {
      videoId,
      isFavourite: action === "add",
      favourites: await getFavouriteVideos(userId),
    };
  }

  const previewIds = getPreviewFavouriteIds(userId);

  if (action === "add") {
    previewIds.add(videoId);
  } else {
    previewIds.delete(videoId);
  }

  return {
    videoId,
    isFavourite: previewIds.has(videoId),
    favourites: await getFavouriteVideos(userId),
  };
}

export async function createPlaylist(name: string, videoIds: string[] = [], userId?: number) {
  if (hasDatabaseUrl() && userId) {
    const matchingVideos = await prisma.video.findMany({
      where: {
        videoId: {
          in: videoIds,
        },
      },
      select: {
        id: true,
      },
      take: 50,
    });

    const playlist = await prisma.playlistName.create({
      data: {
        name,
        userId,
        isPrivate: false,
        items: {
          create:
            matchingVideos.length > 0
              ? matchingVideos.map((video, index) => ({
                  videoId: video.id,
                  sortOrder: index,
                }))
              : undefined,
        },
      },
      include: {
        items: {
          orderBy: {
            sortOrder: "asc",
          },
          include: {
            video: {
              select: {
                videoId: true,
                title: true,
                channelTitle: true,
                favourited: true,
                description: true,
              },
            },
          },
        },
      },
    });

    return {
      id: String(playlist.id),
      name: playlist.name,
      videos: playlist.items.map((item) => mapVideo(item.video)),
    };
  }

  const topVideos = await getTopVideos();
  const combined = [...topVideos, ...seedVideos].filter(
    (video, index, array) => array.findIndex((entry) => entry.id === video.id) === index,
  );
  const chosenVideos = combined.filter((video) => videoIds.includes(video.id));
  const playlistVideos = chosenVideos.length > 0 ? chosenVideos : [combined[0] ?? seedVideos[0]];
  const previewPlaylists = getPreviewPlaylists(userId);
  const nextId = String(
    Math.max(0, ...previewPlaylists.map((playlist) => Number(playlist.id) || 0)) + 1,
  );

  const playlist: PlaylistDetail = {
    id: nextId,
    name,
    videos: playlistVideos,
  };

  const store = getPreviewStore();
  const resolvedUserId = getPreviewUserId(userId);
  store.playlistsByUser.set(resolvedUserId, [...previewPlaylists, playlist]);
  return playlist;
}

export async function addPlaylistItem(playlistId: string, videoId: string, userId?: number) {
  if (hasDatabaseUrl() && userId) {
    const numericPlaylistId = Number(playlistId);

    if (!Number.isInteger(numericPlaylistId)) {
      return null;
    }

    const playlist = await prisma.playlistName.findFirst({
      where: {
        id: numericPlaylistId,
        userId,
      },
      select: {
        id: true,
        name: true,
      },
    });

    if (!playlist) {
      return null;
    }

    const video = await prisma.video.findUnique({
      where: {
        videoId,
      },
      select: {
        id: true,
      },
    });

    if (!video) {
      return null;
    }

    const existingCount = await prisma.playlistItem.count({
      where: {
        playlistId: playlist.id,
      },
    });

    await prisma.playlistItem.create({
      data: {
        playlistId: playlist.id,
        videoId: video.id,
        sortOrder: existingCount,
      },
    });

    return getPlaylistById(String(playlist.id));
  }

  const topVideos = await getTopVideos();
  const combined = [...topVideos, ...seedVideos].filter(
    (video, index, array) => array.findIndex((entry) => entry.id === video.id) === index,
  );
  const video = combined.find((entry) => entry.id === videoId);

  if (!video) {
    return null;
  }

  const store = getPreviewStore();
  const resolvedUserId = getPreviewUserId(userId);
  const previewPlaylists = getPreviewPlaylists(userId);
  let updatedPlaylist: PlaylistDetail | null = null;

  const nextPlaylists = previewPlaylists.map((playlist) => {
    if (playlist.id !== playlistId) {
      return playlist;
    }

    updatedPlaylist = {
      ...playlist,
      videos: [...playlist.videos, video],
    };

    return updatedPlaylist;
  });

  store.playlistsByUser.set(resolvedUserId, nextPlaylists);

  return updatedPlaylist;
}

export async function submitAiVote(trackId: string, vote: 1 | -1) {
  const previewStore = getPreviewStore();
  let updatedTrack: AiTrackDetail | null = null;

  previewStore.aiTrackDetails = previewStore.aiTrackDetails.map((track) => {
    if (track.id !== trackId) {
      return track;
    }

    updatedTrack = {
      ...track,
      score: track.score + vote,
    };

    return updatedTrack;
  });

  return updatedTrack;
}