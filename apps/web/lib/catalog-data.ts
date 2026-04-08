import { prisma } from "@/lib/db";
import {
  artists as seedArtists,
  genres as seedGenres,
  getArtistBySlug as getSeedArtistBySlug,
  getRelatedVideos as getSeedRelatedVideos,
  getVideoById as getSeedVideoById,
  searchCatalog as searchSeedCatalog,
  videos as seedVideos,
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

export type GenreCard = {
  genre: string;
  previewVideoId: string | null;
};

type PreviewStore = {
  favouriteIdsByUser: Map<number, Set<string>>;
  playlistsByUser: Map<number, PlaylistDetail[]>;
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

type ParsedVideoMetadata = {
  artist: string | null;
  track: string | null;
  videoType: string | null;
  confidence: number | null;
  reason: string | null;
};

type PlaybackDecisionRow = {
  id: number;
  title: string;
  description: string | null;
  parsedArtist: string | null;
  parsedTrack: string | null;
  parsedVideoType: string | null;
  parseConfidence: number | null;
  hasAvailable: number;
  hasBlocked: number;
};

export type PlaybackDecision = {
  allowed: boolean;
  reason:
    | "ok"
    | "invalid-video-id"
    | "not-found"
    | "missing-metadata"
    | "low-confidence"
    | "unknown-video-type"
    | "unavailable";
  message?: string;
};

type CachedPlaybackDecision = {
  expiresAt: number;
  decision: PlaybackDecision;
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
const GROQ_API_KEY = process.env.GROQ_API_KEY?.trim() || undefined;
const GROQ_MODEL = process.env.GROQ_MODEL?.trim() || "openai/gpt-oss-120b";
const PLAYBACK_MIN_CONFIDENCE = Math.max(0, Math.min(1, Number(process.env.PLAYBACK_MIN_CONFIDENCE || "0.8")));
const CATALOG_DEBUG_ENABLED = process.env.NODE_ENV === "development" && process.env.DEBUG_CATALOG === "1";
const PLAYBACK_DECISION_CACHE_TTL_MS = 15_000;
const playbackDecisionCache = new Map<string, CachedPlaybackDecision>();
const ALLOWED_VIDEO_TYPES = new Set(["official", "lyric", "live", "cover", "remix", "fan"]);
const NON_MUSIC_SIGNAL_PATTERN = /\b(instagram|tiktok|facebook|whatsapp|snapchat|podcast|interview|prank|challenge|reaction|vlog|tutorial|gameplay|livestream|stream highlights?|shorts?)\b/i;

let hasCheckedVideoMetadataColumns = false;
let videoMetadataColumnsAvailable = false;

function debugCatalog(event: string, detail?: Record<string, unknown>) {
  if (!CATALOG_DEBUG_ENABLED) {
    return;
  }

  const payload = detail ? ` ${JSON.stringify(detail)}` : "";
  console.log(`[catalog-data] ${event}${payload}`);
}

function containsAgeRestrictionMarker(html: string) {
  return AGE_RESTRICTED_PATTERNS.some((pattern) => pattern.test(html));
}

function isLikelyNonMusicSignal(row: PlaybackDecisionRow) {
  const haystack = `${row.title}\n${row.description ?? ""}`;
  return NON_MUSIC_SIGNAL_PATTERN.test(haystack);
}

function evaluatePlaybackMetadataEligibility(row: PlaybackDecisionRow): PlaybackDecision {
  const artist = row.parsedArtist?.trim() ?? "";
  const track = row.parsedTrack?.trim() ?? "";
  const videoType = (row.parsedVideoType ?? "").trim().toLowerCase();
  const confidence = Number(row.parseConfidence ?? NaN);

  if (!artist || !track) {
    return {
      allowed: false,
      reason: "missing-metadata",
      message: "Sorry, that video cannot be played on YehThatRocks.",
    };
  }

  if (!ALLOWED_VIDEO_TYPES.has(videoType)) {
    return {
      allowed: false,
      reason: "unknown-video-type",
      message: "Sorry, that video cannot be played on YehThatRocks.",
    };
  }

  if (!Number.isFinite(confidence) || confidence < PLAYBACK_MIN_CONFIDENCE) {
    return {
      allowed: false,
      reason: "low-confidence",
      message: "Sorry, that video cannot be played on YehThatRocks.",
    };
  }

  if (isLikelyNonMusicSignal(row) && confidence < 0.9) {
    return {
      allowed: false,
      reason: "low-confidence",
      message: "Sorry, that video cannot be played on YehThatRocks.",
    };
  }

  return { allowed: true, reason: "ok" };
}

function truncate(value: string, maxLength: number) {
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

async function withSoftTimeout<T>(label: string, timeoutMs: number, operation: () => Promise<T>) {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([operation(), timeoutPromise]);
  } finally {
    if (timeoutHandle !== undefined) {
      clearTimeout(timeoutHandle);
    }
  }
}

function normalizeParsedString(value: unknown, maxLength: number) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed || trimmed.toLowerCase() === "unknown" || trimmed.toLowerCase() === "null") {
    return null;
  }

  return truncate(trimmed, maxLength);
}

function normalizeParsedConfidence(value: unknown) {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }

  return Math.max(0, Math.min(1, numeric));
}

function normalizeLooseToken(value: string | null | undefined) {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseSimpleTitleSides(title: string) {
  const withDash = title.split(" - ").map((part) => part.trim()).filter(Boolean);
  if (withDash.length >= 2) {
    return { left: withDash[0], right: withDash[1] };
  }

  const withPipe = title.split("|").map((part) => part.trim()).filter(Boolean);
  if (withPipe.length >= 2) {
    return { left: withPipe[0], right: withPipe[1] };
  }

  return null;
}

function isLikelySwappedByTitleOrder(title: string, artist: string | null | undefined, track: string | null | undefined) {
  if (!artist || !track) {
    return false;
  }

  const sides = parseSimpleTitleSides(title);
  if (!sides) {
    return false;
  }

  const left = normalizeLooseToken(sides.left);
  const right = normalizeLooseToken(sides.right);
  const artistToken = normalizeLooseToken(artist);
  const trackToken = normalizeLooseToken(track);

  if (!left || !right || !artistToken || !trackToken) {
    return false;
  }

  return left.includes(artistToken) && right.includes(trackToken) && !left.includes(trackToken);
}

function inferArtistFromTitle(title: string) {
  const sides = parseSimpleTitleSides(title);
  if (!sides) {
    return null;
  }

  const markerPattern = /\b(official|video|lyrics?|lyric|remaster(?:ed)?|live|hd|4k|audio|visualizer|feat\.?|ft\.?)\b|[\[(]/i;
  const leftHasMarkers = markerPattern.test(sides.left);
  const rightHasMarkers = markerPattern.test(sides.right);

  if (leftHasMarkers && !rightHasMarkers) {
    return sides.right;
  }

  if (rightHasMarkers && !leftHasMarkers) {
    return sides.left;
  }

  return sides.left;
}

function sanitizeFallbackMetadataToken(value: string | null | undefined, maxLength: number) {
  if (!value) {
    return null;
  }

  const cleaned = value
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\b(official\s+video|official|lyrics?|lyric\s+video|audio|visualizer|hd|4k|remaster(?:ed)?)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  return normalizeParsedString(cleaned, maxLength);
}

function deriveAdminImportFallbackMetadata(title: string) {
  const sides = parseSimpleTitleSides(title);

  if (!sides) {
    return null;
  }

  const inferredArtist = inferArtistFromTitle(title);
  const fallbackArtist = sanitizeFallbackMetadataToken(inferredArtist ?? sides.left, 255);
  const fallbackTrack = sanitizeFallbackMetadataToken(
    inferredArtist && inferredArtist.toLowerCase() === sides.left.toLowerCase() ? sides.right : sides.left,
    255,
  );

  if (!fallbackArtist || !fallbackTrack) {
    return null;
  }

  return {
    artist: fallbackArtist,
    track: fallbackTrack,
    videoType: "official",
    confidence: Math.max(PLAYBACK_MIN_CONFIDENCE, 0.82),
    reason: "Admin direct import heuristic fallback from title parsing.",
  } as const;
}

function extractJsonObject(content: unknown) {
  if (typeof content !== "string") {
    throw new Error("Groq returned non-string message content");
  }

  const trimmed = content.trim();

  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");

    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1)) as Record<string, unknown>;
    }

    throw new Error(`Unable to parse Groq JSON payload: ${trimmed.slice(0, 220)}`);
  }
}

async function ensureVideoMetadataColumnsAvailable() {
  if (hasCheckedVideoMetadataColumns || !hasDatabaseUrl()) {
    return videoMetadataColumnsAvailable;
  }

  hasCheckedVideoMetadataColumns = true;

  try {
    const columns = await prisma.$queryRaw<Array<{ Field: string }>>`SHOW COLUMNS FROM videos`;
    const names = new Set(columns.map((column) => column.Field));
    videoMetadataColumnsAvailable = names.has("parsedArtist") && names.has("parsedTrack");
  } catch {
    videoMetadataColumnsAvailable = false;
  }

  return videoMetadataColumnsAvailable;
}

function buildGroqMetadataPrompt(video: PersistableVideoRecord) {
  const descriptionSnippet = truncate(video.description ?? "", 700);

  return [
    "Extract music metadata from this YouTube video record.",
    "Return JSON only with keys:",
    '{"artist":string|null,"track":string|null,"videoType":"official"|"lyric"|"live"|"cover"|"remix"|"fan"|"unknown","confidence":number,"reason":string}',
    "Rules:",
    "- artist must be the performing artist/band.",
    "- track must be song title only.",
    "- Do not include venue, city, date, official video, remaster, lyrics, HD in artist or track.",
    "- If ambiguous, use null and lower confidence.",
    "",
    `videoId: ${video.id}`,
    `rawTitle: ${video.title}`,
    `descriptionSnippet: ${descriptionSnippet}`,
  ].join("\n");
}

async function classifyVideoMetadataWithGroq(video: PersistableVideoRecord): Promise<ParsedVideoMetadata | null> {
  if (!GROQ_API_KEY) {
    return null;
  }

  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        temperature: 0.1,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You are a strict music metadata extraction service. Output valid JSON only, with no markdown fences.",
          },
          {
            role: "user",
            content: buildGroqMetadataPrompt(video),
          },
        ],
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Groq API error ${response.status}: ${body.slice(0, 260)}`);
    }

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const parsed = extractJsonObject(payload?.choices?.[0]?.message?.content);

    return {
      artist: normalizeParsedString(parsed.artist, 255),
      track: normalizeParsedString(parsed.track, 255),
      videoType: normalizeParsedString(parsed.videoType, 50),
      confidence: normalizeParsedConfidence(parsed.confidence),
      reason: normalizeParsedString(parsed.reason, 500),
    };
  } catch (error) {
    debugCatalog("classifyVideoMetadataWithGroq:error", {
      videoId: video.id,
      message: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

async function maybePersistRuntimeMetadata(videoRowId: number, video: PersistableVideoRecord) {
  if (!GROQ_API_KEY) {
    return;
  }

  const hasColumns = await ensureVideoMetadataColumnsAvailable();
  if (!hasColumns) {
    return;
  }

  try {
    const existing = await prisma.$queryRaw<
      Array<{
        parsedArtist: string | null;
        parsedTrack: string | null;
        parsedVideoType: string | null;
        parseConfidence: number | null;
        parseMethod: string | null;
      }>
    >`
      SELECT parsedArtist, parsedTrack, parsedVideoType, parseConfidence, parseMethod
      FROM videos
      WHERE id = ${videoRowId}
      LIMIT 1
    `;

    const existingMeta = existing[0];
    const existingLikelySwapped = isLikelySwappedByTitleOrder(
      video.title,
      existingMeta?.parsedArtist,
      existingMeta?.parsedTrack,
    );
    const existingConfidence = Number(existingMeta?.parseConfidence ?? NaN);
    const hasStrongGroqParse =
      Boolean(existingMeta?.parsedArtist?.trim()) &&
      Boolean(existingMeta?.parsedTrack?.trim()) &&
      existingMeta?.parsedVideoType !== "unknown" &&
      Number.isFinite(existingConfidence) &&
      existingConfidence >= PLAYBACK_MIN_CONFIDENCE &&
      existingMeta?.parseMethod === "groq-llm";

    if (hasStrongGroqParse) {
      if (existingLikelySwapped && existingMeta?.parsedArtist && existingMeta?.parsedTrack) {
        await prisma.$executeRaw`
          UPDATE videos
          SET
            parsedArtist = ${existingMeta.parsedTrack},
            parsedTrack = ${existingMeta.parsedArtist},
            parseMethod = ${"groq-llm-corrected"},
            parseReason = ${`Auto-corrected swapped artist/track by title order: ${video.id}`},
            parsedAt = ${new Date()}
          WHERE id = ${videoRowId}
        `;

        await refreshArtistProjectionForName(existingMeta.parsedTrack);
      } else if (existingMeta?.parsedArtist?.trim()) {
        await refreshArtistProjectionForName(existingMeta.parsedArtist);
      }
      return;
    }

    const parsed = await classifyVideoMetadataWithGroq(video);
    if (!parsed) {
      return;
    }

    const shouldSwapParsed = isLikelySwappedByTitleOrder(video.title, parsed.artist, parsed.track);
    const correctedArtist = shouldSwapParsed ? parsed.track : parsed.artist;
    const correctedTrack = shouldSwapParsed ? parsed.artist : parsed.track;
    const correctedReason = shouldSwapParsed
      ? `${parsed.reason ?? ""}${parsed.reason ? " | " : ""}Auto-corrected swapped artist/track by title order.`
      : parsed.reason;

    await prisma.$executeRaw`
      UPDATE videos
      SET
        parsedArtist = ${correctedArtist},
        parsedTrack = ${correctedTrack},
        parsedVideoType = ${parsed.videoType},
        parseMethod = ${shouldSwapParsed ? "groq-llm-corrected" : "groq-llm"},
        parseReason = ${correctedReason},
        parseConfidence = ${parsed.confidence},
        parsedAt = ${new Date()}
      WHERE id = ${videoRowId}
    `;

    debugCatalog("maybePersistRuntimeMetadata:updated", {
      videoId: video.id,
      rowId: videoRowId,
      artist: correctedArtist,
      track: correctedTrack,
      confidence: parsed.confidence,
      corrected: shouldSwapParsed,
    });

    if (correctedArtist) {
      await refreshArtistProjectionForName(correctedArtist);
    }
  } catch (error) {
    debugCatalog("maybePersistRuntimeMetadata:error", {
      videoId: video.id,
      rowId: videoRowId,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

const runtimeMetadataBackfillInFlight = new Set<number>();

function triggerRuntimeMetadataBackfill(videoRowId: number, video: PersistableVideoRecord) {
  if (runtimeMetadataBackfillInFlight.has(videoRowId)) {
    return;
  }

  runtimeMetadataBackfillInFlight.add(videoRowId);
  void maybePersistRuntimeMetadata(videoRowId, video)
    .catch(() => undefined)
    .finally(() => {
      runtimeMetadataBackfillInFlight.delete(videoRowId);
    });
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

export function resolveSelectedVideoId(
  searchParams?: Record<string, string | string[] | undefined>,
  fallbackVideoId?: string,
) {
  const rawSelectedVideo = typeof searchParams?.v === "string"
    ? searchParams.v
    : Array.isArray(searchParams?.v)
      ? searchParams.v[0]
      : undefined;
  const selectedVideoId = normalizeYouTubeVideoId(rawSelectedVideo) ?? rawSelectedVideo;

  return selectedVideoId ?? fallbackVideoId;
}

const TOP_POOL_CACHE_TTL_MS = 5_000;
let topPoolCache:
  | {
      expiresAt: number;
      rows: RankedVideoRow[];
    }
  | undefined;
const NEWEST_CACHE_TTL_MS = 15_000;
let newestVideosCache:
  | {
      expiresAt: number;
      count: number;
      rows: RankedVideoRow[];
    }
  | undefined;

const GENRE_RESULTS_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const GENRE_CARDS_CACHE_TTL_MS = 30 * 1000; // 30 seconds
const CATEGORY_QUERY_TIMEOUT_MS = 2_500;
const genreArtistsCache = new Map<string, { expiresAt: number; artists: ArtistRecord[] }>();
const genreVideosCache = new Map<string, { expiresAt: number; videos: VideoRecord[] }>();
const genreVideosInFlight = new Map<string, Promise<VideoRecord[]>>();
let genreCardsCache: { expiresAt: number; cards: GenreCard[] } | undefined;
let genreCardsInFlight: Promise<GenreCard[]> | undefined;
const ARTIST_VIDEOS_CACHE_TTL_MS = 60_000;
const artistVideosCache = new Map<string, { expiresAt: number; videos: VideoRecord[] }>();
const ARTIST_LETTER_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const artistLetterCache = new Map<string, { expiresAt: number; rows: Array<ArtistRecord & { videoCount: number }> }>();
const ARTIST_LETTER_PAGE_CACHE_TTL_MS = 60_000; // 1 minute
const artistLetterPageCache = new Map<string, { expiresAt: number; rows: Array<ArtistRecord & { videoCount: number }> }>();
const artistLetterPageInFlight = new Map<string, Promise<Array<ArtistRecord & { videoCount: number }>>>();
const ARTIST_STATS_TABLE_CACHE_TTL_MS = 60_000;
let artistColumnMapCache:
  | {
      name: string;
      country: string | null;
      genreColumns: string[];
    }
  | undefined;
let artistVideoColumnMapCache:
  | {
      artistName: string;
      videoRef: string;
      joinsOnVideoPrimaryId: boolean;
    }
  | undefined;
let artistVideoStatsSourceCache: "videosbyartist" | "parsedArtist" | undefined;
let artistStatsProjectionAvailabilityCache:
  | {
      checkedAt: number;
      available: boolean;
    }
  | undefined;
let artistStatsThumbnailColumnAvailabilityCache:
  | {
      checkedAt: number;
      available: boolean;
    }
  | undefined;

let genreListCache: { expiresAt: number; genres: string[] } | undefined;

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
    INNER JOIN site_videos sv
      ON sv.video_id = v.id
      AND sv.status = 'available'
    WHERE v.videoId IS NOT NULL
      AND CHAR_LENGTH(v.videoId) = 11
    GROUP BY v.id, v.videoId, v.title, v.favourited, v.description
    ORDER BY v.favourited DESC, v.views DESC, v.videoId ASC
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
  favourited: number | bigint | null;
  description: string | null;
}): VideoRecord {
  const favouritedValue =
    typeof video.favourited === "bigint"
      ? Number(video.favourited)
      : Number(video.favourited ?? 0);

  const inferredChannelTitle = inferArtistFromTitle(video.title)
    ?? (video.title.includes(" - ")
      ? video.title.split(" - ", 1)[0].trim()
      : video.title.split("|", 1)[0].trim());

  return {
    id: video.videoId,
    title: video.title,
    channelTitle: video.channelTitle ?? (inferredChannelTitle || "Unknown Channel"),
    genre: "Rock / Metal",
    favourited: Number.isFinite(favouritedValue) ? favouritedValue : 0,
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

  await maybePersistRuntimeMetadata(persistedVideo.id, video);

  return persistedVideo;
}

async function persistRelatedVideoCache(videoId: string, relatedIds: string[]) {
  const persistedRelatedIds = Array.from(new Set(relatedIds.filter(Boolean)));
  const effectiveRelatedIds = persistedRelatedIds.length > 0 ? persistedRelatedIds : [videoId];
  const now = new Date();

  await prisma.relatedCache.deleteMany({
    where: {
      videoId,
    },
  });

  await prisma.relatedCache.createMany({
    data: effectiveRelatedIds.map((relatedId) => ({
      videoId,
      related: relatedId,
      createdAt: now,
      updatedAt: now,
    })),
  });

  const reverseCandidateIds = effectiveRelatedIds.filter((relatedId) => relatedId !== videoId);
  if (reverseCandidateIds.length === 0) {
    return;
  }

  const existingVideos = await prisma.video.findMany({
    where: {
      videoId: {
        in: reverseCandidateIds,
      },
    },
    select: {
      videoId: true,
    },
  });

  if (existingVideos.length === 0) {
    return;
  }

  const existingVideoIds = existingVideos
    .map((video) => video.videoId)
    .filter((id): id is string => Boolean(id));

  if (existingVideoIds.length === 0) {
    return;
  }

  const alreadyLinkedBack = await prisma.relatedCache.findMany({
    where: {
      videoId: {
        in: existingVideoIds,
      },
      related: videoId,
    },
    select: {
      videoId: true,
    },
  });

  const linkedBackSet = new Set(alreadyLinkedBack.map((row) => row.videoId).filter(Boolean));
  const reverseLinksToCreate = existingVideoIds
    .filter((existingVideoId) => !linkedBackSet.has(existingVideoId))
    .map((existingVideoId) => ({
      videoId: existingVideoId,
      related: videoId,
      createdAt: now,
      updatedAt: now,
    }));

  if (reverseLinksToCreate.length > 0) {
    await prisma.relatedCache.createMany({
      data: reverseLinksToCreate,
    });
  }
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
      .filter((item): item is NonNullable<typeof item> => Boolean(item));

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
  options?: { forceAvailabilityRefresh?: boolean },
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

  if (existingVideo && !options?.forceAvailabilityRefresh) {
    debugCatalog("hydrateAndPersistVideo:local-hit", { videoId: normalizedVideoId });
    return mapStoredVideoToPersistable(existingVideo);
  }

  debugCatalog("hydrateAndPersistVideo:hydrate", {
    videoId: normalizedVideoId,
    hasExistingVideo: Boolean(existingVideo),
    forceAvailabilityRefresh: Boolean(options?.forceAvailabilityRefresh),
  });

  const video = providedVideo ?? (existingVideo ? mapStoredVideoToPersistable(existingVideo) : await fetchOEmbedVideo(normalizedVideoId));

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

export async function importVideoFromDirectSource(source: string) {
  const normalizedVideoId = normalizeYouTubeVideoId(source);

  if (!normalizedVideoId) {
    return {
      videoId: null,
      decision: {
        allowed: false,
        reason: "invalid-video-id",
        message: "Invalid YouTube URL or video id.",
      } satisfies PlaybackDecision,
    };
  }

  await hydrateAndPersistVideo(normalizedVideoId, undefined, { forceAvailabilityRefresh: true });
  let decision = await getVideoPlaybackDecision(normalizedVideoId);

  if (
    hasDatabaseUrl()
    && !decision.allowed
    && (decision.reason === "missing-metadata" || decision.reason === "unknown-video-type" || decision.reason === "low-confidence")
  ) {
    const fallbackRows = await prisma.$queryRaw<Array<{ id: number; title: string }>>`
      SELECT id, title
      FROM videos
      WHERE videoId = ${normalizedVideoId}
      LIMIT 1
    `;

    const fallbackRow = fallbackRows[0];
    const fallbackMeta = fallbackRow ? deriveAdminImportFallbackMetadata(fallbackRow.title) : null;

    if (fallbackRow && fallbackMeta) {
      await prisma.$executeRaw`
        UPDATE videos
        SET
          parsedArtist = ${fallbackMeta.artist},
          parsedTrack = ${fallbackMeta.track},
          parsedVideoType = ${fallbackMeta.videoType},
          parseMethod = ${"admin-direct-import-heuristic"},
          parseReason = ${fallbackMeta.reason},
          parseConfidence = ${fallbackMeta.confidence},
          parsedAt = ${new Date()}
        WHERE id = ${fallbackRow.id}
      `;

      await refreshArtistProjectionForName(fallbackMeta.artist);
      playbackDecisionCache.delete(normalizedVideoId);
      decision = await getVideoPlaybackDecision(normalizedVideoId);
    }
  }

  return { videoId: normalizedVideoId, decision };
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
    thumbnailVideoId: undefined,
  };
}

function escapeSqlIdentifier(identifier: string) {
  return `\`${identifier.replace(/`/g, "``")}\``;
}

function mapArtistProjectionRow(row: {
  displayName: string;
  slug: string;
  country: string | null;
  genre: string | null;
  thumbnailVideoId?: string | null;
}) {
  const normalizedThumbnailVideoId = normalizeYouTubeVideoId(row.thumbnailVideoId);

  return {
    name: row.displayName,
    slug: row.slug,
    country: row.country ?? "Unknown",
    genre: row.genre ?? "Rock / Metal",
    thumbnailVideoId: normalizedThumbnailVideoId,
  } satisfies ArtistRecord;
}

function getArtistLetterCache(cacheKey: string) {
  const cached = artistLetterCache.get(cacheKey);
  if (!cached) {
    return undefined;
  }

  if (cached.expiresAt <= Date.now()) {
    artistLetterCache.delete(cacheKey);
    return undefined;
  }

  return cached.rows;
}

function setArtistLetterCache(cacheKey: string, rows: Array<ArtistRecord & { videoCount: number }>) {
  artistLetterCache.set(cacheKey, {
    expiresAt: Date.now() + ARTIST_LETTER_CACHE_TTL_MS,
    rows,
  });
}

async function hasArtistStatsProjection() {
  const now = Date.now();
  if (
    artistStatsProjectionAvailabilityCache &&
    artistStatsProjectionAvailabilityCache.checkedAt + ARTIST_STATS_TABLE_CACHE_TTL_MS > now
  ) {
    return artistStatsProjectionAvailabilityCache.available;
  }

  try {
    const rows = await prisma.$queryRawUnsafe<Array<{ hasRows: number }>>(
      "SELECT EXISTS(SELECT 1 FROM artist_stats LIMIT 1) AS hasRows",
    );

    const available = Number(rows[0]?.hasRows ?? 0) > 0;
    artistStatsProjectionAvailabilityCache = {
      checkedAt: now,
      available,
    };
    return available;
  } catch {
    artistStatsProjectionAvailabilityCache = {
      checkedAt: now,
      available: false,
    };
    return false;
  }
}

async function hasArtistStatsThumbnailColumn() {
  const now = Date.now();
  if (
    artistStatsThumbnailColumnAvailabilityCache &&
    artistStatsThumbnailColumnAvailabilityCache.checkedAt + ARTIST_STATS_TABLE_CACHE_TTL_MS > now
  ) {
    return artistStatsThumbnailColumnAvailabilityCache.available;
  }

  try {
    const rows = await prisma.$queryRawUnsafe<Array<{ Field: string }>>(
      "SHOW COLUMNS FROM artist_stats LIKE 'thumbnail_video_id'",
    );

    const available = rows.length > 0;
    artistStatsThumbnailColumnAvailabilityCache = {
      checkedAt: now,
      available,
    };
    return available;
  } catch {
    artistStatsThumbnailColumnAvailabilityCache = {
      checkedAt: now,
      available: false,
    };
    return false;
  }
}

async function refreshArtistProjectionForName(artistName: string) {
  const displayName = artistName.trim();
  if (!displayName) {
    return;
  }

  if (!hasDatabaseUrl()) {
    return;
  }

  if (!(await hasArtistStatsProjection())) {
    return;
  }

  const normalizedArtist = displayName.toLowerCase();

  const statsRows = await prisma.$queryRawUnsafe<Array<{ videoCount: number | null; thumbnailVideoId: string | null }>>(
    `
      SELECT
        COUNT(DISTINCT v.videoId) AS videoCount,
        SUBSTRING_INDEX(GROUP_CONCAT(v.videoId ORDER BY v.id ASC), ',', 1) AS thumbnailVideoId
      FROM videos v
      WHERE LOWER(TRIM(v.parsedArtist)) = ?
        AND v.videoId REGEXP '^[A-Za-z0-9_-]{11}$'
        AND EXISTS (
          SELECT 1
          FROM site_videos sv
          WHERE sv.video_id = v.id
            AND sv.status = 'available'
        )
        AND NOT EXISTS (
          SELECT 1
          FROM site_videos sv
          WHERE sv.video_id = v.id
            AND (sv.status IS NULL OR sv.status <> 'available')
        )
    `,
    normalizedArtist,
  );

  const videoCount = Number(statsRows[0]?.videoCount ?? 0);
  if (videoCount <= 0) {
    await prisma.$executeRawUnsafe(
      "DELETE FROM artist_stats WHERE normalized_artist = ?",
      normalizedArtist,
    );
    return;
  }

  const columns = await getArtistColumnMap();
  const nameCol = escapeSqlIdentifier(columns.name);
  const countrySelect = columns.country ? `a.${escapeSqlIdentifier(columns.country)} AS country` : "NULL AS country";
  const genreExpr =
    columns.genreColumns.length > 0
      ? `COALESCE(${columns.genreColumns.map((column) => `a.${escapeSqlIdentifier(column)}`).join(", ")})`
      : "NULL";

  const artistMetaRows = await prisma.$queryRawUnsafe<Array<{ country: string | null; genre: string | null }>>(
    `
      SELECT
        ${countrySelect},
        ${genreExpr} AS genre
      FROM artists a
      WHERE LOWER(TRIM(a.${nameCol})) = ?
      LIMIT 1
    `,
    normalizedArtist,
  );

  const country = artistMetaRows[0]?.country ?? null;
  const genre = artistMetaRows[0]?.genre ?? null;
  const firstLetter = displayName.charAt(0).toUpperCase();
  const slug = slugify(displayName);
  const thumbnailVideoId = statsRows[0]?.thumbnailVideoId ?? null;
  const hasThumbnailColumn = await hasArtistStatsThumbnailColumn();

  if (hasThumbnailColumn) {
    await prisma.$executeRawUnsafe(
      `
        INSERT INTO artist_stats (
          normalized_artist,
          display_name,
          slug,
          first_letter,
          country,
          genre,
          thumbnail_video_id,
          video_count,
          source
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          display_name = VALUES(display_name),
          slug = VALUES(slug),
          first_letter = VALUES(first_letter),
          country = VALUES(country),
          genre = VALUES(genre),
          thumbnail_video_id = VALUES(thumbnail_video_id),
          video_count = VALUES(video_count),
          source = VALUES(source)
      `,
      normalizedArtist,
      displayName,
      slug,
      firstLetter,
      country,
      genre,
      thumbnailVideoId,
      videoCount,
      "runtime",
    );
    return;
  }

  await prisma.$executeRawUnsafe(
    `
      INSERT INTO artist_stats (
        normalized_artist,
        display_name,
        slug,
        first_letter,
        country,
        genre,
        video_count,
        source
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        display_name = VALUES(display_name),
        slug = VALUES(slug),
        first_letter = VALUES(first_letter),
        country = VALUES(country),
        genre = VALUES(genre),
        video_count = VALUES(video_count),
        source = VALUES(source)
    `,
    normalizedArtist,
    displayName,
    slug,
    firstLetter,
    country,
    genre,
    videoCount,
    "runtime",
  );
}

export async function refreshArtistThumbnailForName(artistName: string, badVideoId?: string) {
  const displayName = artistName.trim();
  if (!displayName || !hasDatabaseUrl()) {
    return null;
  }

  if (!(await hasArtistStatsProjection())) {
    return null;
  }

  const normalizedArtist = displayName.toLowerCase();
  const bad = typeof badVideoId === "string" && /^[A-Za-z0-9_-]{11}$/.test(badVideoId)
    ? badVideoId
    : null;

  const candidateRows = await prisma.$queryRawUnsafe<Array<{ thumbnailVideoId: string | null }>>(
    `
      SELECT
        SUBSTRING_INDEX(GROUP_CONCAT(v.videoId ORDER BY v.id ASC), ',', 1) AS thumbnailVideoId
      FROM videos v
      WHERE LOWER(TRIM(v.parsedArtist)) = ?
        AND v.videoId REGEXP '^[A-Za-z0-9_-]{11}$'
        ${bad ? "AND v.videoId <> ?" : ""}
        AND EXISTS (
          SELECT 1
          FROM site_videos sv
          WHERE sv.video_id = v.id
            AND sv.status = 'available'
        )
        AND NOT EXISTS (
          SELECT 1
          FROM site_videos sv
          WHERE sv.video_id = v.id
            AND (sv.status IS NULL OR sv.status <> 'available')
        )
    `,
    ...(bad ? [normalizedArtist, bad] : [normalizedArtist]),
  );

  const nextThumbnailVideoId = candidateRows[0]?.thumbnailVideoId ?? null;
  const hasThumbnailColumn = await hasArtistStatsThumbnailColumn();

  if (hasThumbnailColumn) {
    await prisma.$executeRawUnsafe(
      `
        UPDATE artist_stats
        SET thumbnail_video_id = ?
        WHERE normalized_artist = ?
      `,
      nextThumbnailVideoId,
      normalizedArtist,
    );
  }

  return nextThumbnailVideoId;
}

async function getArtistColumnMap() {
  if (artistColumnMapCache) {
    return artistColumnMapCache;
  }

  const columns = await prisma.$queryRawUnsafe<Array<{ Field: string }>>("SHOW COLUMNS FROM artists");
  const available = new Set(columns.map((column) => column.Field));

  const name = available.has("artist") ? "artist" : available.has("name") ? "name" : "artist";
  const country = available.has("country") ? "country" : available.has("origin") ? "origin" : null;
  const genreColumns = ["genre1", "genre2", "genre3", "genre4", "genre5", "genre6"].filter((column) => available.has(column));

  artistColumnMapCache = {
    name,
    country,
    genreColumns,
  };

  return artistColumnMapCache;
}

async function getArtistVideoColumnMap() {
  if (artistVideoColumnMapCache) {
    return artistVideoColumnMapCache;
  }

  const columns = await prisma.$queryRawUnsafe<Array<{ Field: string; Type: string }>>("SHOW COLUMNS FROM videosbyartist");
  const available = new Set(columns.map((column) => column.Field));
  const typeByField = new Map(columns.map((column) => [column.Field, column.Type.toLowerCase()]));

  const artistName = available.has("artist")
    ? "artist"
    : available.has("artistname")
      ? "artistname"
      : available.has("artist_name")
        ? "artist_name"
        : "artist";

  const videoRef = available.has("video_id")
    ? "video_id"
    : available.has("videoId")
      ? "videoId"
      : available.has("videoid")
        ? "videoid"
        : "videoId";

  const videoRefType = typeByField.get(videoRef) ?? "";
  const joinsOnVideoPrimaryId = videoRef === "video_id" || /(int|bigint|smallint|tinyint)/i.test(videoRefType);

  artistVideoColumnMapCache = {
    artistName,
    videoRef,
    joinsOnVideoPrimaryId,
  };

  return artistVideoColumnMapCache;
}

export async function pruneVideoAndAssociationsByVideoId(videoId: string, reason = "runtime-prune") {
  const normalizedVideoId = normalizeYouTubeVideoId(videoId);
  if (!normalizedVideoId || !hasDatabaseUrl()) {
    return { pruned: false, deletedVideoRows: 0, reason: "invalid-or-no-db" };
  }

  const matchingRows = await prisma.video.findMany({
    where: { videoId: normalizedVideoId },
    select: { id: true, parsedArtist: true },
  });

  if (matchingRows.length === 0) {
    return { pruned: false, deletedVideoRows: 0, reason: "not-found" };
  }

  const ids = matchingRows.map((row) => row.id);
  const parsedArtistsToRefresh = Array.from(
    new Set(
      matchingRows
        .map((row) => row.parsedArtist?.trim())
        .filter((value): value is string => Boolean(value)),
    ),
  );

  const loadTableColumns = async (tableName: string) => {
    try {
      return await prisma.$queryRawUnsafe<Array<{ Field: string; Type: string }>>(
        `SHOW COLUMNS FROM ${tableName}`,
      );
    } catch {
      return [] as Array<{ Field: string; Type: string }>;
    }
  };

  const [siteVideoColumns, playlistColumns, favouriteColumns, artistVideoColumns, messageColumns, relatedColumns] = await Promise.all([
    loadTableColumns("site_videos"),
    loadTableColumns("playlistitems"),
    loadTableColumns("favourites"),
    loadTableColumns("videosbyartist"),
    loadTableColumns("messages"),
    loadTableColumns("related"),
  ]);

  const pickColumn = (columns: Array<{ Field: string; Type: string }>, names: string[]) =>
    columns.find((column) => names.includes(column.Field));

  const executeWithRetry = async (query: string, params: unknown[]) => {
    const maxAttempts = 4;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        await prisma.$executeRawUnsafe(query, ...params);
        return true;
      } catch (error) {
        const code =
          error && typeof error === "object" && "code" in error
            ? String((error as { code?: unknown }).code ?? "")
            : "";
        const message =
          error instanceof Error
            ? error.message
            : String(error ?? "");
        const lockError =
          code === "P2010" && (message.includes("1205") || message.includes("1213"));

        if (!lockError || attempt === maxAttempts) {
          throw error;
        }

        await new Promise((resolve) => setTimeout(resolve, 120 * attempt));
      }
    }

    return false;
  };

  try {
    const siteVideoRef = pickColumn(siteVideoColumns, ["video_id", "videoId"]);
    if (siteVideoRef) {
      await executeWithRetry(
        `DELETE FROM site_videos WHERE ${escapeSqlIdentifier(siteVideoRef.Field)} IN (${ids.map(() => "?").join(",")})`,
        ids,
      );
    }

    const playlistRef = pickColumn(playlistColumns, ["video_id", "videoId"]);
    if (playlistRef) {
      if (/int|bigint|smallint|tinyint/i.test(playlistRef.Type)) {
        await executeWithRetry(
          `DELETE FROM playlistitems WHERE ${escapeSqlIdentifier(playlistRef.Field)} IN (${ids.map(() => "?").join(",")})`,
          ids,
        );
      } else {
        await executeWithRetry(
          `DELETE FROM playlistitems WHERE ${escapeSqlIdentifier(playlistRef.Field)} = ?`,
          [normalizedVideoId],
        );
      }
    }

    const favouriteRef = pickColumn(favouriteColumns, ["video_id", "videoId"]);
    if (favouriteRef) {
      if (/int|bigint|smallint|tinyint/i.test(favouriteRef.Type)) {
        await executeWithRetry(
          `DELETE FROM favourites WHERE ${escapeSqlIdentifier(favouriteRef.Field)} IN (${ids.map(() => "?").join(",")})`,
          ids,
        );
      } else {
        await executeWithRetry(
          `DELETE FROM favourites WHERE ${escapeSqlIdentifier(favouriteRef.Field)} = ?`,
          [normalizedVideoId],
        );
      }
    }

    const artistVideoRef = pickColumn(artistVideoColumns, ["video_id", "videoId", "id"]);
    if (artistVideoRef) {
      if (/int|bigint|smallint|tinyint/i.test(artistVideoRef.Type)) {
        await executeWithRetry(
          `DELETE FROM videosbyartist WHERE ${escapeSqlIdentifier(artistVideoRef.Field)} IN (${ids.map(() => "?").join(",")})`,
          ids,
        );
      } else {
        await executeWithRetry(
          `DELETE FROM videosbyartist WHERE ${escapeSqlIdentifier(artistVideoRef.Field)} = ?`,
          [normalizedVideoId],
        );
      }
    }

    const messageRef = pickColumn(messageColumns, ["video_id", "videoId"]);
    if (messageRef) {
      await executeWithRetry(
        `DELETE FROM messages WHERE ${escapeSqlIdentifier(messageRef.Field)} = ?`,
        [normalizedVideoId],
      );
    }

    const relatedVideoRef = pickColumn(relatedColumns, ["video_id", "videoId"]);
    const relatedRelatedRef = pickColumn(relatedColumns, ["related_video", "related"]);
    if (relatedVideoRef && relatedRelatedRef) {
      await executeWithRetry(
        `DELETE FROM related WHERE ${escapeSqlIdentifier(relatedVideoRef.Field)} = ? OR ${escapeSqlIdentifier(relatedRelatedRef.Field)} = ?`,
        [normalizedVideoId, normalizedVideoId],
      );
    } else if (relatedVideoRef) {
      await executeWithRetry(
        `DELETE FROM related WHERE ${escapeSqlIdentifier(relatedVideoRef.Field)} = ?`,
        [normalizedVideoId],
      );
    } else if (relatedRelatedRef) {
      await executeWithRetry(
        `DELETE FROM related WHERE ${escapeSqlIdentifier(relatedRelatedRef.Field)} = ?`,
        [normalizedVideoId],
      );
    }

    await executeWithRetry(
      `DELETE FROM videos WHERE id IN (${ids.map(() => "?").join(",")})`,
      ids,
    );
  } catch {
    const siteVideoRef = pickColumn(siteVideoColumns, ["video_id", "videoId"]);
    if (siteVideoRef) {
      try {
        await executeWithRetry(
          `UPDATE site_videos SET status = 'unavailable' WHERE ${escapeSqlIdentifier(siteVideoRef.Field)} IN (${ids.map(() => "?").join(",")})`,
          ids,
        );
      } catch {
        // best-effort fallback only
      }
    }

    return { pruned: false, deletedVideoRows: 0, reason: "lock-timeout-marked-unavailable" };
  }

  // Reset hot caches so lists immediately reflect the prune.
  topPoolCache = undefined;
  artistVideosCache.clear();
  artistLetterCache.clear();
  artistLetterPageCache.clear();
  artistLetterPageInFlight.clear();
  genreArtistsCache.clear();
  genreVideosCache.clear();

  debugCatalog("pruneVideoAndAssociationsByVideoId:done", {
    videoId: normalizedVideoId,
    deletedVideoRows: ids.length,
    reason,
  });

  for (const artistName of parsedArtistsToRefresh) {
    await refreshArtistProjectionForName(artistName).catch(() => undefined);
  }

  return { pruned: true, deletedVideoRows: ids.length, reason };
}

async function getArtistVideoStatsSource() {
  if (artistVideoStatsSourceCache) {
    return artistVideoStatsSourceCache;
  }

  try {
    const rows = await prisma.$queryRawUnsafe<Array<{ hasRows: number }>>(
      "SELECT EXISTS(SELECT 1 FROM videosbyartist LIMIT 1) AS hasRows",
    );

    artistVideoStatsSourceCache = Number(rows[0]?.hasRows ?? 0) > 0 ? "videosbyartist" : "parsedArtist";
  } catch {
    artistVideoStatsSourceCache = "parsedArtist";
  }

  return artistVideoStatsSourceCache;
}

async function findArtistsInDatabase(options: {
  limit: number;
  search?: string;
  orderByName?: boolean;
  prefixOnly?: boolean;
}) {
  const { limit, search, orderByName, prefixOnly } = options;
  const columns = await getArtistColumnMap();

  const nameCol = escapeSqlIdentifier(columns.name);
  const countrySelect = columns.country ? `a.${escapeSqlIdentifier(columns.country)} AS country` : "NULL AS country";
  const genreExpr =
    columns.genreColumns.length > 0
      ? `COALESCE(${columns.genreColumns.map((column) => `a.${escapeSqlIdentifier(column)}`).join(", ")})`
      : "NULL";

  const whereParts: string[] = [];
  const params: string[] = [];

  if (search && search.trim()) {
    const needle = prefixOnly ? `${search.trim()}%` : `%${search.trim()}%`;
    whereParts.push(`a.${nameCol} LIKE ?`);
    params.push(needle);

    if (columns.country) {
      whereParts.push(`a.${escapeSqlIdentifier(columns.country)} LIKE ?`);
      params.push(needle);
    }

    for (const genreColumn of columns.genreColumns) {
      whereParts.push(`a.${escapeSqlIdentifier(genreColumn)} LIKE ?`);
      params.push(needle);
    }
  }

  const whereSql = whereParts.length > 0 ? `WHERE ${whereParts.join(" OR ")}` : "";
  const orderSql = orderByName ? `ORDER BY a.${nameCol} ASC` : "";
  const cappedLimit = Math.max(1, Math.min(100, Math.floor(limit)));

  return prisma.$queryRawUnsafe<Array<{ name: string; country: string | null; genre1: string | null }>>(
    `
      SELECT
        a.${nameCol} AS name,
        ${countrySelect},
        ${genreExpr} AS genre1
      FROM artists a
      ${whereSql}
      ${orderSql}
      LIMIT ${cappedLimit}
    `,
    ...params,
  );
}

export async function getCurrentVideo(videoId?: string, options?: { skipPlaybackDecision?: boolean }) {
  const normalizedVideoId = normalizeYouTubeVideoId(videoId);

  debugCatalog("getCurrentVideo:start", {
    inputVideoId: videoId,
    normalizedVideoId,
    hasDatabase: hasDatabaseUrl(),
  });

  if (!hasDatabaseUrl()) {
    return null;
  }

  try {
    if (normalizedVideoId && !options?.skipPlaybackDecision) {
      const decision = await getVideoPlaybackDecision(normalizedVideoId);
      if (!decision.allowed) {
        if (decision.reason === "unavailable") {
          await pruneVideoAndAssociationsByVideoId(normalizedVideoId, "playback-decision-unavailable").catch(() => undefined);
        }
        debugCatalog("getCurrentVideo:denied-requested-video", {
          videoId: normalizedVideoId,
          reason: decision.reason,
        });
        return null;
      }
    }

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
              WHERE sv.video_id = videos.id
                AND sv.status = 'available'
            )
            AND NOT EXISTS (
              SELECT 1
              FROM site_videos sv
              WHERE sv.video_id = videos.id
                AND (sv.status IS NULL OR sv.status <> 'available')
            )
          ORDER BY updatedAt DESC, id DESC
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

    debugCatalog("getCurrentVideo:return-seed-video", {
      videoId: normalizedVideoId,
      reason: "no-query-hit",
    });

    return null;
  } catch {
    debugCatalog("getCurrentVideo:return-seed-video-after-error", {
      videoId: normalizedVideoId,
    });

    return null;
  }
}

export async function getVideoForSharing(videoId?: string) {
  const normalizedVideoId = normalizeYouTubeVideoId(videoId);

  if (!normalizedVideoId) {
    return null;
  }

  if (!hasDatabaseUrl()) {
    const seedVideo = getSeedVideoById(normalizedVideoId);
    return seedVideo?.id === normalizedVideoId ? seedVideo : null;
  }

  try {
    const rows = await prisma.$queryRaw<Array<RankedVideoRow>>`
      SELECT
        videoId,
        title,
        NULL AS channelTitle,
        favourited,
        description
      FROM videos
      WHERE videoId = ${normalizedVideoId}
        AND videoId REGEXP '^[A-Za-z0-9_-]{11}$'
      LIMIT 1
    `;

    const row = rows[0];

    if (row) {
      return mapVideo(row);
    }

    const seedVideo = getSeedVideoById(normalizedVideoId);
    return seedVideo?.id === normalizedVideoId ? seedVideo : null;
  } catch {
    const seedVideo = getSeedVideoById(normalizedVideoId);
    return seedVideo?.id === normalizedVideoId ? seedVideo : null;
  }
}

export async function getVideoPlaybackDecision(videoId?: string): Promise<PlaybackDecision> {
  const normalizedVideoId = normalizeYouTubeVideoId(videoId);

  if (!normalizedVideoId) {
    return {
      allowed: false,
      reason: "invalid-video-id",
      message: "Sorry, that video cannot be played on YehThatRocks.",
    };
  }

  if (!hasDatabaseUrl()) {
    return { allowed: true, reason: "ok" };
  }

  const cachedDecision = playbackDecisionCache.get(normalizedVideoId);
  const now = Date.now();
  if (cachedDecision && cachedDecision.expiresAt > now) {
    return cachedDecision.decision;
  }

  const fetchDecisionRows = async () =>
    prisma.$queryRaw<Array<PlaybackDecisionRow>>`
    SELECT
      v.id,
      v.title,
      v.description,
      v.parsedArtist,
      v.parsedTrack,
      v.parsedVideoType,
      v.parseConfidence,
      EXISTS (
        SELECT 1
        FROM site_videos sv
        WHERE sv.video_id = v.id
          AND sv.status = 'available'
      ) AS hasAvailable,
      EXISTS (
        SELECT 1
        FROM site_videos sv
        WHERE sv.video_id = v.id
          AND (sv.status IS NULL OR sv.status <> 'available')
      ) AS hasBlocked
    FROM videos v
    WHERE v.videoId = ${normalizedVideoId}
    ORDER BY hasAvailable DESC, hasBlocked ASC, v.updatedAt DESC, v.id DESC
    LIMIT 1
  `;

  let row = (await fetchDecisionRows())[0];
  let hydratedFromDirectRequest = false;

  if (!row) {
    const hydrated = await hydrateAndPersistVideo(normalizedVideoId);

    if (!hydrated) {
      const decision: PlaybackDecision = {
        allowed: false,
        reason: "not-found",
        message: "Sorry, that video cannot be played on YehThatRocks.",
      };
      playbackDecisionCache.set(normalizedVideoId, {
        expiresAt: now + PLAYBACK_DECISION_CACHE_TTL_MS,
        decision,
      });
      return decision;
    }

    row = (await fetchDecisionRows())[0];
    hydratedFromDirectRequest = true;

    if (!row) {
      const decision: PlaybackDecision = {
        allowed: false,
        reason: "not-found",
        message: "Sorry, that video cannot be played on YehThatRocks.",
      };
      playbackDecisionCache.set(normalizedVideoId, {
        expiresAt: now + PLAYBACK_DECISION_CACHE_TTL_MS,
        decision,
      });
      return decision;
    }
  }

  // Check availability status first — if explicitly marked available, allow playback
  // and trigger metadata backfill async in the background.
  if (!Boolean(row.hasAvailable) || Boolean(row.hasBlocked)) {
    if (!hydratedFromDirectRequest) {
      await hydrateAndPersistVideo(normalizedVideoId, undefined, { forceAvailabilityRefresh: true });
      row = (await fetchDecisionRows())[0] ?? row;
    }

    if (Boolean(row.hasAvailable) && !Boolean(row.hasBlocked)) {
      // Video is available, but allow it through before metadata validation.
      // Metadata will be backfilled asynchronously below.
    } else {
      const decision: PlaybackDecision = {
        allowed: false,
        reason: "unavailable",
        message: "Sorry, that video cannot be played on YehThatRocks.",
      };
      playbackDecisionCache.set(normalizedVideoId, {
        expiresAt: now + PLAYBACK_DECISION_CACHE_TTL_MS,
        decision,
      });
      return decision;
    }
  }

  const needsMetadataBackfill =
    !row.parsedArtist?.trim() ||
    !row.parsedTrack?.trim() ||
    row.parsedVideoType === "unknown" ||
    !Number.isFinite(Number(row.parseConfidence ?? NaN)) ||
    Number(row.parseConfidence ?? NaN) < PLAYBACK_MIN_CONFIDENCE;

  const likelySwappedMetadata = isLikelySwappedByTitleOrder(
    row.title,
    row.parsedArtist,
    row.parsedTrack,
  );

  if (needsMetadataBackfill || likelySwappedMetadata) {
    triggerRuntimeMetadataBackfill(row.id, {
      id: normalizedVideoId,
      title: row.title,
      channelTitle: "YouTube",
      genre: "Rock / Metal",
      favourited: 0,
      description: row.description ?? "Catalog video pending metadata classification.",
      thumbnail: getYouTubeThumbnailUrl(normalizedVideoId),
    });

    if (likelySwappedMetadata) {
      row = {
        ...row,
        parsedArtist: row.parsedTrack,
        parsedTrack: row.parsedArtist,
      };
    }
  }

  const decision = evaluatePlaybackMetadataEligibility(row);
  playbackDecisionCache.set(normalizedVideoId, {
    expiresAt: now + PLAYBACK_DECISION_CACHE_TTL_MS,
    decision,
  });
  return decision;
}

export async function getRelatedVideos(videoId: string) {
  if (!hasDatabaseUrl()) {
    return [];
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
          WHERE sv.video_id = v.id
            AND sv.status = 'available'
        )
        AND NOT EXISTS (
          SELECT 1
          FROM site_videos sv
          WHERE sv.video_id = v.id
            AND (sv.status IS NULL OR sv.status <> 'available')
        )
      GROUP BY v.videoId, v.title, v.favourited, v.description
      ORDER BY v.favourited DESC, MAX(v.views) DESC, v.videoId ASC
      LIMIT 10
    `;

    const videos = dedupeRankedRows(mappedVideos).slice(0, 10);
    return videos.map(mapVideo);
  } catch {
    return [];
  }
}

export async function getTopVideos(count = 100) {
  if (!hasDatabaseUrl()) {
    return [];
  }

  try {
    const videos = await getRankedTopPool(Math.max(count, 1));

    return videos.length > 0 ? videos.slice(0, count).map(mapVideo) : [];
  } catch {
    return [];
  }
}

export async function getNewestVideos(count = 20) {
  if (!hasDatabaseUrl()) {
    return [];
  }

  const safeCount = Math.max(1, Math.min(100, Math.floor(count)));
  const now = Date.now();

  if (
    newestVideosCache
    && newestVideosCache.expiresAt > now
    && newestVideosCache.count >= safeCount
  ) {
    return newestVideosCache.rows.slice(0, safeCount).map(mapVideo);
  }

  try {
    const videos = await prisma.$queryRaw<RankedVideoRow[]>`
      SELECT
        v.videoId,
        v.title,
        NULL AS channelTitle,
        v.favourited,
        v.description
      FROM videos v
      WHERE EXISTS (
        SELECT 1
        FROM site_videos sv
        WHERE sv.video_id = v.id
          AND sv.status = 'available'
      )
      ORDER BY v.updatedAt DESC, v.id DESC
      LIMIT ${safeCount}
    `;

    newestVideosCache = {
      expiresAt: now + NEWEST_CACHE_TTL_MS,
      count: safeCount,
      rows: videos,
    };

    return videos.map(mapVideo);
  } catch {
    return [];
  }
}

export async function getArtists() {
  if (!hasDatabaseUrl()) {
    return seedArtists;
  }

  try {
    if (await hasArtistStatsProjection()) {
      const hasThumbnailColumn = await hasArtistStatsThumbnailColumn();
      const thumbnailSelect = hasThumbnailColumn
        ? `
            COALESCE(
              CASE
                WHEN s.thumbnail_video_id IS NOT NULL
                  AND EXISTS (
                    SELECT 1
                    FROM videos v
                    INNER JOIN site_videos sv ON sv.video_id = v.id
                    WHERE v.videoId = s.thumbnail_video_id
                      AND sv.status = 'available'
                  )
                THEN s.thumbnail_video_id
                ELSE NULL
              END,
              (
                SELECT SUBSTRING_INDEX(GROUP_CONCAT(v2.videoId ORDER BY v2.id ASC), ',', 1)
                FROM videos v2
                INNER JOIN site_videos sv2 ON sv2.video_id = v2.id
                WHERE LOWER(TRIM(v2.parsedArtist)) = s.normalized_artist
                  AND v2.videoId REGEXP '^[A-Za-z0-9_-]{11}$'
                  AND sv2.status = 'available'
              )
            ) AS thumbnailVideoId
          `
        : "NULL AS thumbnailVideoId";
      const rows = await prisma.$queryRawUnsafe<Array<{
        displayName: string;
        slug: string;
        country: string | null;
        genre: string | null;
        thumbnailVideoId: string | null;
      }>>(
        `
          SELECT s.display_name AS displayName, s.slug, s.country, s.genre, ${thumbnailSelect}
          FROM artist_stats s
          WHERE s.video_count > 0
          ORDER BY s.display_name ASC
          LIMIT 24
        `,
      );

      if (rows.length > 0) {
        return rows.map(mapArtistProjectionRow);
      }
    }

    const artists = await findArtistsInDatabase({
      limit: 24,
      orderByName: true,
    });

    return artists.length > 0 ? artists.map(mapArtist) : seedArtists;
  } catch {
    return seedArtists;
  }
}

export async function getArtistsByLetter(letter: string, limit = 120, offset = 0): Promise<Array<ArtistRecord & { videoCount: number }>> {
  const normalizedLetter = letter.trim().toUpperCase();
  const safeLimit = Math.max(1, Math.min(limit, 300));
  const safeOffset = Math.max(0, Math.floor(offset));
  const projectionPageCacheKey = `${normalizedLetter}:${safeOffset}:${safeLimit}`;
  const countFromSeed = (artistName: string) => {
    const normalizedName = artistName.trim().toLowerCase();
    return seedVideos.filter((video) => {
      return (
        video.channelTitle.toLowerCase().includes(normalizedName) ||
        video.title.toLowerCase().includes(normalizedName)
      );
    }).length;
  };

  if (!/^[A-Z]$/.test(normalizedLetter)) {
    return [];
  }

  if (!hasDatabaseUrl()) {
    return seedArtists
      .filter((artist) => artist.name.trim().toUpperCase().startsWith(normalizedLetter))
      .slice(safeOffset, safeOffset + safeLimit)
      .map((artist) => ({
        ...artist,
        videoCount: countFromSeed(artist.name),
      }))
      .filter((artist) => artist.videoCount > 0);
  }

  try {
    if (await hasArtistStatsProjection()) {
      const now = Date.now();
      const cachedPage = artistLetterPageCache.get(projectionPageCacheKey);
      if (cachedPage && cachedPage.expiresAt > now) {
        return cachedPage.rows;
      }

      const inFlight = artistLetterPageInFlight.get(projectionPageCacheKey);
      if (inFlight) {
        return await inFlight;
      }

      const hasThumbnailColumn = await hasArtistStatsThumbnailColumn();
      const queryPromise = (async () => {
        const projectedRows = await prisma.$queryRawUnsafe<Array<{
          displayName: string;
          slug: string;
          country: string | null;
          genre: string | null;
          videoCount: number | null;
          thumbnailVideoId: string | null;
        }>>(
          `
            SELECT
              s.display_name AS displayName,
              s.slug,
              s.country,
              s.genre,
              s.video_count AS videoCount,
              ${hasThumbnailColumn ? "s.thumbnail_video_id" : "NULL"} AS thumbnailVideoId
            FROM artist_stats s
            WHERE s.first_letter = ?
              AND s.video_count > 0
            ORDER BY s.display_name ASC
            LIMIT ${safeLimit}
            OFFSET ${safeOffset}
          `,
          normalizedLetter,
        );

        if (projectedRows.length > 0 || safeOffset > 0) {
          const mapped = projectedRows.map((row) => ({
            ...mapArtistProjectionRow(row),
            videoCount: Number(row.videoCount ?? 0),
          }));

          artistLetterPageCache.set(projectionPageCacheKey, {
            expiresAt: Date.now() + ARTIST_LETTER_PAGE_CACHE_TTL_MS,
            rows: mapped,
          });

          return mapped;
        }

        return [];
      })();

      artistLetterPageInFlight.set(projectionPageCacheKey, queryPromise);

      const projected = await queryPromise.finally(() => {
        artistLetterPageInFlight.delete(projectionPageCacheKey);
      });

      if (projected.length > 0 || safeOffset > 0) {
        return projected;
      }
    }

    const columns = await getArtistColumnMap();
    const statsSource = await getArtistVideoStatsSource();
    const letterCacheKey = `${statsSource}:${normalizedLetter}`;

    if (statsSource === "parsedArtist") {
      const cachedRows = getArtistLetterCache(letterCacheKey);
      if (cachedRows) {
        return cachedRows.slice(safeOffset, safeOffset + safeLimit);
      }
    }

    const nameCol = escapeSqlIdentifier(columns.name);
    const countrySelect = columns.country ? `a.${escapeSqlIdentifier(columns.country)} AS country` : "NULL AS country";
    const genreExpr =
      columns.genreColumns.length > 0
        ? `COALESCE(${columns.genreColumns.map((column) => `a.${escapeSqlIdentifier(column)}`).join(", ")})`
        : "NULL";

    if (statsSource === "parsedArtist") {
      const artists = await prisma.$queryRawUnsafe<Array<{ name: string; country: string | null; genre1: string | null }>>(
        `
          SELECT
            a.${nameCol} AS name,
            ${countrySelect},
            ${genreExpr} AS genre1
          FROM artists a
          WHERE a.${nameCol} IS NOT NULL
            AND TRIM(a.${nameCol}) <> ''
            AND UPPER(LEFT(TRIM(a.${nameCol}), 1)) = ?
          ORDER BY a.${nameCol} ASC
        `,
        normalizedLetter,
      );

      const parsedArtistCounts = await prisma.$queryRawUnsafe<Array<{ parsedArtist: string | null; videoCount: number | null; thumbnailVideoId: string | null }>>(
        `
          SELECT
            v.parsedArtist AS parsedArtist,
            COUNT(DISTINCT v.videoId) AS videoCount,
            SUBSTRING_INDEX(GROUP_CONCAT(v.videoId ORDER BY v.id ASC), ',', 1) AS thumbnailVideoId
          FROM videos v
          WHERE v.parsedArtist IS NOT NULL
            AND TRIM(v.parsedArtist) <> ''
            AND v.videoId REGEXP '^[A-Za-z0-9_-]{11}$'
            AND EXISTS (
              SELECT 1
              FROM site_videos sv
              WHERE sv.video_id = v.id
                AND sv.status = 'available'
            )
            AND NOT EXISTS (
              SELECT 1
              FROM site_videos sv
              WHERE sv.video_id = v.id
                AND (sv.status IS NULL OR sv.status <> 'available')
            )
            AND v.parsedArtist LIKE ?
          GROUP BY v.parsedArtist
        `,
        `${normalizedLetter}%`,
      );

      const countByArtist = new Map<string, number>();
      const thumbnailByArtist = new Map<string, string>();
      for (const row of parsedArtistCounts) {
        const key = row.parsedArtist?.trim().toLowerCase();
        if (!key) {
          continue;
        }

        const nextCount = Number(row.videoCount ?? 0);
        countByArtist.set(key, (countByArtist.get(key) ?? 0) + nextCount);
        if (row.thumbnailVideoId) {
          thumbnailByArtist.set(key, row.thumbnailVideoId);
        }
      }

      const rows = artists
        .map((row) => {
          const key = row.name.trim().toLowerCase();
          return {
            ...mapArtist(row),
            videoCount: countByArtist.get(key) ?? 0,
            thumbnailVideoId: thumbnailByArtist.get(key),
          };
        })
        .filter((artist) => artist.videoCount > 0);

      setArtistLetterCache(letterCacheKey, rows);
      return rows.slice(safeOffset, safeOffset + safeLimit);
    }

    let videoCountSubquery = `
      SELECT
        LOWER(TRIM(v.parsedArtist)) AS artistKey,
        COUNT(DISTINCT v.videoId) AS videoCount,
        SUBSTRING_INDEX(GROUP_CONCAT(v.videoId ORDER BY v.id ASC), ',', 1) AS thumbnailVideoId
      FROM videos v
      WHERE v.parsedArtist IS NOT NULL
        AND TRIM(v.parsedArtist) <> ''
        AND v.videoId REGEXP '^[A-Za-z0-9_-]{11}$'
        AND UPPER(LEFT(TRIM(v.parsedArtist), 1)) = ?
      GROUP BY LOWER(TRIM(v.parsedArtist))
    `;

    if (statsSource === "videosbyartist") {
      const artistVideoColumns = await getArtistVideoColumnMap();
      const vaArtistCol = escapeSqlIdentifier(artistVideoColumns.artistName);
      const vaVideoRefCol = escapeSqlIdentifier(artistVideoColumns.videoRef);
      const joinVideoExpr = artistVideoColumns.joinsOnVideoPrimaryId ? "v.id" : "v.videoId";

      videoCountSubquery = `
        SELECT
          LOWER(TRIM(va.${vaArtistCol})) AS artistKey,
          COUNT(DISTINCT v.videoId) AS videoCount,
          SUBSTRING_INDEX(GROUP_CONCAT(v.videoId ORDER BY v.id ASC), ',', 1) AS thumbnailVideoId
        FROM videosbyartist va
        INNER JOIN videos v ON ${joinVideoExpr} = va.${vaVideoRefCol}
        WHERE UPPER(LEFT(TRIM(va.${vaArtistCol}), 1)) = ?
          AND v.videoId REGEXP '^[A-Za-z0-9_-]{11}$'
        GROUP BY LOWER(TRIM(va.${vaArtistCol}))
      `;
    }

    const rows = await prisma.$queryRawUnsafe<Array<{ name: string; country: string | null; genre1: string | null; videoCount: number | null; thumbnailVideoId: string | null }>>(
      `
        SELECT
          a.${nameCol} AS name,
          ${countrySelect},
          ${genreExpr} AS genre1,
          vc.videoCount AS videoCount,
          vc.thumbnailVideoId AS thumbnailVideoId
        FROM artists a
        INNER JOIN (${videoCountSubquery}) vc ON vc.artistKey = LOWER(TRIM(a.${nameCol}))
        WHERE vc.videoCount > 0
          AND a.${nameCol} IS NOT NULL
          AND TRIM(a.${nameCol}) <> ''
          AND UPPER(LEFT(TRIM(a.${nameCol}), 1)) = ?
        ORDER BY a.${nameCol} ASC
        LIMIT ${safeLimit}
        OFFSET ${safeOffset}
      `,
      normalizedLetter,
      normalizedLetter,
    );

    const mappedRows = rows.map((row) => ({
      ...mapArtist(row),
      videoCount: Number(row.videoCount ?? 0),
      thumbnailVideoId: row.thumbnailVideoId ?? undefined,
    }));
    return mappedRows;
  } catch {
    return seedArtists
      .filter((artist) => artist.name.trim().toUpperCase().startsWith(normalizedLetter))
      .slice(safeOffset, safeOffset + safeLimit)
      .map((artist) => ({
        ...artist,
        videoCount: countFromSeed(artist.name),
      }))
      .filter((artist) => artist.videoCount > 0);
  }
}

export async function getArtistBySlug(slug: string) {
  if (!hasDatabaseUrl()) {
    return getSeedArtistBySlug(slug);
  }

  try {
    if (await hasArtistStatsProjection()) {
      const rows = await prisma.$queryRawUnsafe<Array<{
        displayName: string;
        slug: string;
        country: string | null;
        genre: string | null;
      }>>(
        `
          SELECT display_name AS displayName, slug, country, genre
          FROM artist_stats
          WHERE slug = ?
          LIMIT 1
        `,
        slug,
      );

      if (rows.length > 0) {
        return mapArtistProjectionRow(rows[0]);
      }
    }

    const columns = await getArtistColumnMap();
    const nameCol = escapeSqlIdentifier(columns.name);
    const countrySelect = columns.country ? `a.${escapeSqlIdentifier(columns.country)} AS country` : "NULL AS country";
    const genreExpr =
      columns.genreColumns.length > 0
        ? `COALESCE(${columns.genreColumns.map((column) => `a.${escapeSqlIdentifier(column)}`).join(", ")})`
        : "NULL";

    const artists = await prisma.$queryRawUnsafe<Array<{ name: string; country: string | null; genre1: string | null }>>(
      `
        SELECT
          a.${nameCol} AS name,
          ${countrySelect},
          ${genreExpr} AS genre1
        FROM artists a
        WHERE a.${nameCol} IS NOT NULL
          AND TRIM(a.${nameCol}) <> ''
        ORDER BY a.${nameCol} ASC
      `,
    );

    const match = artists.find((artist) => slugify(artist.name) === slug);
    return match ? mapArtist(match) : getSeedArtistBySlug(slug);
  } catch {
    return getSeedArtistBySlug(slug);
  }
}

export async function getVideosByArtist(artistName: string, limit = 500) {
  const exactArtist = artistName.trim();
  const normalizedArtist = exactArtist.toLowerCase();
  const normalizedArtistCompact = normalizedArtist.replace(/\s+/g, " ");
  const safeLimit = Math.max(1, Math.min(limit, 500));

  if (!normalizedArtist) {
    return [] as VideoRecord[];
  }

  const cacheKey = `${normalizedArtist}:${safeLimit}`;
  const cached = artistVideosCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.videos;
  }

  if (!hasDatabaseUrl()) {
    const fallback = seedVideos
      .filter((video) =>
        video.channelTitle.toLowerCase().includes(normalizedArtist) ||
        video.title.toLowerCase().includes(normalizedArtist),
      )
      .slice(0, safeLimit);
    artistVideosCache.set(cacheKey, {
      expiresAt: Date.now() + ARTIST_VIDEOS_CACHE_TTL_MS,
      videos: fallback,
    });
    return fallback;
  }

  try {
    const query = `
      SELECT
        v.videoId,
        v.title,
        NULL AS channelTitle,
        v.favourited,
        v.description
      FROM videos v
      WHERE v.parsedArtist = ?
        AND EXISTS (
          SELECT 1
          FROM site_videos sv
          WHERE sv.video_id = v.id
            AND sv.status = 'available'
        )
        AND NOT EXISTS (
          SELECT 1
          FROM site_videos sv
          WHERE sv.video_id = v.id
            AND (sv.status IS NULL OR sv.status <> 'available')
        )
      ORDER BY v.views DESC, v.id ASC
      LIMIT ${safeLimit}
    `;

    let rows = await prisma.$queryRawUnsafe<Array<{
      videoId: string;
      title: string;
      channelTitle: string | null;
      favourited: number;
      description: string | null;
    }>>(query, exactArtist);

    if (rows.length === 0) {
      // Keep this fallback index-friendly: avoid LOWER/TRIM on table columns.
      // Most deployments use case-insensitive collations, so this resolves casing-only mismatches.
      rows = await prisma.$queryRawUnsafe<Array<{
        videoId: string;
        title: string;
        channelTitle: string | null;
        favourited: number;
        description: string | null;
      }>>(query, normalizedArtist);
    }

    if (rows.length === 0 && normalizedArtistCompact !== normalizedArtist) {
      rows = await prisma.$queryRawUnsafe<Array<{
        videoId: string;
        title: string;
        channelTitle: string | null;
        favourited: number;
        description: string | null;
      }>>(query, normalizedArtistCompact);
    }

    const mapped = rows
      .map(mapVideo)
      .filter((video, index, allVideos) => allVideos.findIndex((candidate) => candidate.id === video.id) === index);
    artistVideosCache.set(cacheKey, {
      expiresAt: Date.now() + ARTIST_VIDEOS_CACHE_TTL_MS,
      videos: mapped,
    });

    // Reconcile projection in the background to keep page response fast.
    void (async () => {
      try {
        if (await hasArtistStatsProjection()) {
          const projectionRows = await prisma.$queryRawUnsafe<Array<{ videoCount: number | null }>>(
            `
              SELECT video_count AS videoCount
              FROM artist_stats
              WHERE normalized_artist = ?
              LIMIT 1
            `,
            normalizedArtist,
          );

          const projectedCount = Number(projectionRows[0]?.videoCount ?? 0);
          if (projectedCount !== mapped.length) {
            await refreshArtistProjectionForName(artistName).catch(() => undefined);
          }
          return;
        }

        if (mapped.length === 0) {
          await refreshArtistProjectionForName(artistName).catch(() => undefined);
        }
      } catch {
        // best-effort reconciliation only
      }
    })();

    return mapped;
  } catch {
    const fallback = seedVideos
      .filter((video) =>
        video.channelTitle.toLowerCase().includes(normalizedArtist) ||
        video.title.toLowerCase().includes(normalizedArtist),
      )
      .slice(0, safeLimit);
    artistVideosCache.set(cacheKey, {
      expiresAt: Date.now() + ARTIST_VIDEOS_CACHE_TTL_MS,
      videos: fallback,
    });
    return fallback;
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
    // MySQL fulltext ignores words shorter than ft_min_word_len (default 4, InnoDB default 3).
    // Filtering here avoids the common failure where all tokens are stop-words/too-short
    // which would cause +word* syntax to return zero results.
    const FT_MIN_WORD_LEN = 3;
    // Strip MySQL FTS boolean-mode operators before building the query to avoid syntax errors
    const ftWords = normalized
      .split(/\s+/)
      .map((w) => w.replace(/[+\-><()~*"@]/g, ""))
      .filter((w) => w.length >= FT_MIN_WORD_LEN);

    // Use word* (OR mode, no + prefix) so partial matches are returned ranked by relevance.
    // Requiring all tokens with + breaks multi-word artist names that include stop words.
    const booleanQuery = ftWords.map((w) => `${w}*`).join(" ");

    const [ftVideos, artists] = await Promise.all([
      ftWords.length > 0
        ? prisma.$queryRaw<Array<{ videoId: string; title: string; channelTitle: string | null; favourited: number; description: string | null }>>`
            SELECT videoId, title, NULL AS channelTitle, favourited, description,
                   MATCH(title, parsedArtist, parsedTrack) AGAINST(${booleanQuery} IN BOOLEAN MODE) AS score
            FROM videos
            WHERE MATCH(title, parsedArtist, parsedTrack) AGAINST(${booleanQuery} IN BOOLEAN MODE)
            ORDER BY score DESC
            LIMIT 50
          `
        : Promise.resolve([]),
      findArtistsInDatabase({
        limit: 12,
        search: normalized,
      }),
    ]);

    // LIKE fallback: when fulltext returns no results (all short words, or no indexed terms)
    // try a phrase-level LIKE across all searchable text columns.
    let videos = ftVideos;
    if (videos.length === 0) {
      const likePattern = `%${normalized}%`;
      videos = await prisma.$queryRaw<Array<{ videoId: string; title: string; channelTitle: string | null; favourited: number; description: string | null }>>`
        SELECT videoId, title, NULL AS channelTitle, favourited, description, 1 AS score
        FROM videos
        WHERE title LIKE ${likePattern}
           OR parsedArtist LIKE ${likePattern}
           OR parsedTrack LIKE ${likePattern}
        ORDER BY favourited DESC
        LIMIT 50
      `;
    }

    return {
      videos: videos.length > 0 ? videos.map(mapVideo) : searchSeedCatalog(query).videos,
      artists: artists.length > 0 ? artists.map(mapArtist) : searchSeedCatalog(query).artists,
      genres: seedGenres.filter((genre) => genre.toLowerCase().includes(normalized.toLowerCase())),
    };
  } catch (err) {
    console.error("[searchCatalog] query failed, falling back to seed:", err);
    return searchSeedCatalog(query);
  }
}

export type SearchSuggestion = {
  type: "artist" | "track" | "genre";
  label: string;
  /** Relative URL destination used directly by the search UI. */
  url: string;
};

export async function suggestCatalog(query: string): Promise<SearchSuggestion[]> {
  const normalized = query.trim();
  if (!normalized) return [];
  const normalizedLower = normalized.toLowerCase();

  const prefixPattern = `${normalized}%`;

  const [artistRows, trackRows] = await Promise.all([
    hasDatabaseUrl()
      ? findArtistsInDatabase({ limit: 4, search: normalized, orderByName: true, prefixOnly: true })
      : seedArtists
          .filter((a) => a.name.toLowerCase().startsWith(normalized.toLowerCase()))
          .slice(0, 4),

    hasDatabaseUrl()
      ? prisma.$queryRaw<Array<{ videoId: string; title: string }>>`
          SELECT videoId, title
          FROM videos
          WHERE title LIKE ${prefixPattern}
          ORDER BY favourited DESC
          LIMIT 4
        `
      : seedVideos
          .filter((v) => v.title.toLowerCase().startsWith(normalized.toLowerCase()))
          .map((v) => ({ videoId: v.id, title: v.title }))
          .slice(0, 4),
  ]);

  const genreSuggestions: SearchSuggestion[] = seedGenres
    .filter((g) => g.toLowerCase().startsWith(normalized.toLowerCase()))
    .slice(0, 3)
    .map((g) => ({ type: "genre", label: g, url: `/categories/${getGenreSlug(g)}` }));

  const artistSuggestions: SearchSuggestion[] = artistRows.map((r) => ({
    type: "artist",
    label: r.name,
    url: `/artist/${slugify(r.name)}`,
  }));

  const trackSuggestions: SearchSuggestion[] = trackRows.map((r) => ({
    type: "track",
    label: r.title,
    url: `/?v=${encodeURIComponent(r.videoId)}&resume=1`,
  }));

  const strictPrefixSuggestions = [...artistSuggestions, ...genreSuggestions, ...trackSuggestions].filter((suggestion) =>
    suggestion.label.trim().toLowerCase().startsWith(normalizedLower),
  );

  // Interleave: artists first, then genres, then tracks, deduped by label
  const seen = new Set<string>();
  const results: SearchSuggestion[] = [];
  for (const s of strictPrefixSuggestions) {
    const key = s.label.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      results.push(s);
    }
    if (results.length >= 10) break;
  }
  return results;
}

export async function getGenres() {
  if (!hasDatabaseUrl()) {
    return seedGenres;
  }

  const now = Date.now();
  if (genreListCache && genreListCache.expiresAt > now) {
    return genreListCache.genres;
  }

  try {
    // Read from genre_cards which is the pre-built canonical store.
    // Falls back to the genres table if genre_cards is empty (first run before batch script).
    const rows = await prisma.$queryRaw<Array<{ genre: string }>>`
      SELECT genre FROM genre_cards ORDER BY genre ASC LIMIT 1000
    `;

    if (rows.length > 0) {
      const genres = rows.map((r) => r.genre);
      genreListCache = { expiresAt: now + GENRE_RESULTS_CACHE_TTL_MS, genres };
      return genres;
    }

    // genre_cards not yet populated — fall back to genres table
    const fallbackRows = await prisma.$queryRaw<Array<{ genre: string }>>`
      SELECT name AS genre FROM genres WHERE name IS NOT NULL AND TRIM(name) <> '' ORDER BY name ASC LIMIT 500
    `;
    const genres = fallbackRows.map((r) => r.genre);
    genreListCache = { expiresAt: now + GENRE_RESULTS_CACHE_TTL_MS, genres };
    return genres;
  } catch {
    return genreListCache?.genres ?? [];
  }
}

export async function getGenreCards() {
  if (!hasDatabaseUrl()) {
    return seedGenres.map((genre) => ({ genre, previewVideoId: null }));
  }

  const now = Date.now();
  if (genreCardsCache && genreCardsCache.expiresAt > now) {
    return genreCardsCache.cards;
  }

  if (genreCardsInFlight) {
    return genreCardsCache?.cards ?? [];
  }

  genreCardsInFlight = (async () => {
    try {
      const rows = await prisma.$queryRaw<Array<{ genre: string; thumbnailVideoId: string | null }>>`
        SELECT genre, thumbnail_video_id AS thumbnailVideoId
        FROM genre_cards
        ORDER BY genre ASC
        LIMIT 1000
      `;

      const cards: GenreCard[] = rows.map((row) => ({
        genre: row.genre,
        previewVideoId: row.thumbnailVideoId ?? null,
      }));

      genreCardsCache = { expiresAt: now + GENRE_CARDS_CACHE_TTL_MS, cards };
      // Keep genre list in sync
      genreListCache = { expiresAt: now + GENRE_RESULTS_CACHE_TTL_MS, genres: cards.map((c) => c.genre) };
      return cards;
    } catch {
      const stale = genreCardsCache?.cards ?? [];
      genreCardsCache = { expiresAt: now + 30_000, cards: stale };
      return stale;
    }
  })().finally(() => {
    genreCardsInFlight = undefined;
  });

  // Await on first load so the page renders with real data
  if (!genreCardsCache) {
    return genreCardsInFlight;
  }

  return genreCardsCache.cards;
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
  const cacheKey = genre.trim().toLowerCase();
  const cached = genreArtistsCache.get(cacheKey);
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    return cached.artists;
  }

  if (!hasDatabaseUrl()) {
    const fallback = getArtistsByGenreFallback(genre);
    genreArtistsCache.set(cacheKey, { expiresAt: now + GENRE_RESULTS_CACHE_TTL_MS, artists: fallback });
    return fallback;
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
      LIMIT 24
    `;

    const mappedArtists = artists.length > 0
      ? artists.map(mapArtist).sort((a, b) => a.name.localeCompare(b.name))
      : getArtistsByGenreFallback(genre);
    genreArtistsCache.set(cacheKey, {
      expiresAt: now + GENRE_RESULTS_CACHE_TTL_MS,
      artists: mappedArtists,
    });
    return mappedArtists;
  } catch {
    const fallback = getArtistsByGenreFallback(genre);
    genreArtistsCache.set(cacheKey, { expiresAt: now + GENRE_RESULTS_CACHE_TTL_MS, artists: fallback });
    return fallback;
  }
}

export async function getVideosByGenre(
  genre: string,
  options?: {
    artists?: Awaited<ReturnType<typeof getArtistsByGenre>>;
  }
) {
  const cacheKey = genre.trim().toLowerCase();
  const now = Date.now();
  if (!options?.artists) {
    const cached = genreVideosCache.get(cacheKey);
    if (cached && cached.expiresAt > now && cached.videos.length > 0) {
      return cached.videos;
    }

    if (cached && cached.videos.length === 0) {
      genreVideosCache.delete(cacheKey);
    }
  }

  const storeGenreVideosInCache = (videos: VideoRecord[]) => {
    if (!options?.artists && videos.length > 0) {
      genreVideosCache.set(cacheKey, { expiresAt: now + GENRE_RESULTS_CACHE_TTL_MS, videos });
    }
  };

  const buildUniqueGenreVideos = (rows: RankedVideoRow[]) => {
    return dedupeRankedRows(rows).slice(0, 24).map(mapVideo);
  };

  const getGenreFallback = async () => {
    if (!hasDatabaseUrl()) {
      return seedVideos;
    }
    return [];
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
      WHERE MATCH(v.title, v.parsedArtist, v.parsedTrack) AGAINST (${genre} IN NATURAL LANGUAGE MODE)
        AND v.videoId REGEXP '^[A-Za-z0-9_-]{11}$'
        AND EXISTS (
          SELECT 1
          FROM site_videos sv
          WHERE sv.video_id = v.id
            AND sv.status = 'available'
        )
        AND NOT EXISTS (
          SELECT 1
          FROM site_videos sv
          WHERE sv.video_id = v.id
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
    return await withSoftTimeout(`getVideosByGenre:${cacheKey}`, CATEGORY_QUERY_TIMEOUT_MS, async () => {
      const keywordVideos = await getGenreKeywordVideos();
    if (keywordVideos.length >= 12) {
      const resolved = await buildUniqueGenreVideos(keywordVideos);
      storeGenreVideosInCache(resolved);
      return resolved;
    }

    const artists = options?.artists ?? (await getArtistsByGenre(genre));
    const artistNames = [...new Set(artists.map((artist) => artist.name).filter(Boolean))].slice(0, 32);

    if (artistNames.length === 0) {
      if (keywordVideos.length > 0) {
        const resolved = await buildUniqueGenreVideos(keywordVideos);
        storeGenreVideosInCache(resolved);
        return resolved;
      }

      const fallback = await getGenreFallback();
      storeGenreVideosInCache(fallback);
      return fallback;
    }

    const fulltextTerm = artistNames
      .map((name) => (name.includes(" ") ? `"${name}"` : name))
      .join(" ");

    const videos = await prisma.$queryRaw<RankedVideoRow[]>`
      SELECT
        v.videoId,
        v.title,
        NULL AS channelTitle,
        v.favourited,
        v.description
      FROM videos v
      WHERE MATCH(v.title, v.parsedArtist, v.parsedTrack) AGAINST (${fulltextTerm} IN BOOLEAN MODE)
        AND v.videoId REGEXP '^[A-Za-z0-9_-]{11}$'
        AND EXISTS (
          SELECT 1
          FROM site_videos sv
          WHERE sv.video_id = v.id
            AND sv.status = 'available'
        )
        AND NOT EXISTS (
          SELECT 1
          FROM site_videos sv
          WHERE sv.video_id = v.id
            AND (sv.status IS NULL OR sv.status <> 'available')
        )
      ORDER BY v.favourited DESC, v.views DESC, v.videoId ASC
      LIMIT 24
    `;

    if (videos.length > 0) {
      const resolved = await buildUniqueGenreVideos(videos);
      storeGenreVideosInCache(resolved);
      return resolved;
    }

    const normalizedArtistNames = artistNames
      .map((name) => name.trim().toLowerCase())
      .filter((name) => name.length > 0)
      .slice(0, 32);

    if (normalizedArtistNames.length > 0) {
      const placeholders = normalizedArtistNames.map(() => "?").join(", ");
      const artistMatchedVideos = await prisma.$queryRawUnsafe<RankedVideoRow[]>(
        `
          SELECT
            v.videoId,
            v.title,
            NULL AS channelTitle,
            v.favourited,
            v.description
          FROM videos v
          WHERE LOWER(TRIM(v.parsedArtist)) IN (${placeholders})
            AND v.videoId REGEXP '^[A-Za-z0-9_-]{11}$'
            AND EXISTS (
              SELECT 1
              FROM site_videos sv
              WHERE sv.video_id = v.id
                AND sv.status = 'available'
            )
            AND NOT EXISTS (
              SELECT 1
              FROM site_videos sv
              WHERE sv.video_id = v.id
                AND (sv.status IS NULL OR sv.status <> 'available')
            )
          ORDER BY v.favourited DESC, v.views DESC, v.videoId ASC
          LIMIT 24
        `,
        ...normalizedArtistNames,
      );

      if (artistMatchedVideos.length > 0) {
        const resolved = await buildUniqueGenreVideos(artistMatchedVideos);
        storeGenreVideosInCache(resolved);
        return resolved;
      }
    }

    const artistColumns = await getArtistColumnMap();
    if (artistColumns.genreColumns.length > 0) {
      const artistNameColumn = escapeSqlIdentifier(artistColumns.name);
      const genrePredicates = artistColumns.genreColumns
        .map((column) => `a.${escapeSqlIdentifier(column)} LIKE CONCAT('%', ?, '%')`)
        .join(" OR ");
      const genreParams = artistColumns.genreColumns.map(() => genre);

      const artistGenreMatchedVideos = await prisma.$queryRawUnsafe<RankedVideoRow[]>(
        `
          SELECT
            v.videoId,
            v.title,
            NULL AS channelTitle,
            v.favourited,
            v.description
          FROM artists a
          INNER JOIN videos v ON LOWER(TRIM(v.parsedArtist)) = LOWER(TRIM(a.${artistNameColumn}))
          WHERE (${genrePredicates})
            AND v.videoId REGEXP '^[A-Za-z0-9_-]{11}$'
            AND EXISTS (
              SELECT 1
              FROM site_videos sv
              WHERE sv.video_id = v.id
                AND sv.status = 'available'
            )
            AND NOT EXISTS (
              SELECT 1
              FROM site_videos sv
              WHERE sv.video_id = v.id
                AND (sv.status IS NULL OR sv.status <> 'available')
            )
          GROUP BY v.videoId, v.title, v.favourited, v.description
          ORDER BY v.favourited DESC, v.views DESC, v.videoId ASC
          LIMIT 24
        `,
        ...genreParams,
      );

      if (artistGenreMatchedVideos.length > 0) {
        const resolved = await buildUniqueGenreVideos(artistGenreMatchedVideos);
        storeGenreVideosInCache(resolved);
        return resolved;
      }
    }

    const normalizedGenreNeedle = `%${genre.trim().toLowerCase()}%`;
    const textMatchedVideos = await prisma.$queryRaw<RankedVideoRow[]>`
      SELECT
        v.videoId,
        v.title,
        NULL AS channelTitle,
        v.favourited,
        v.description
      FROM videos v
      WHERE v.videoId REGEXP '^[A-Za-z0-9_-]{11}$'
        AND (
          LOWER(v.title) LIKE ${normalizedGenreNeedle}
          OR LOWER(COALESCE(v.description, '')) LIKE ${normalizedGenreNeedle}
          OR LOWER(COALESCE(v.parsedArtist, '')) LIKE ${normalizedGenreNeedle}
          OR LOWER(COALESCE(v.parsedTrack, '')) LIKE ${normalizedGenreNeedle}
        )
        AND EXISTS (
          SELECT 1
          FROM site_videos sv
          WHERE sv.video_id = v.id
            AND sv.status = 'available'
        )
        AND NOT EXISTS (
          SELECT 1
          FROM site_videos sv
          WHERE sv.video_id = v.id
            AND (sv.status IS NULL OR sv.status <> 'available')
        )
      ORDER BY v.favourited DESC, v.views DESC, v.videoId ASC
      LIMIT 24
    `;

    if (textMatchedVideos.length > 0) {
      const resolved = await buildUniqueGenreVideos(textMatchedVideos);
      storeGenreVideosInCache(resolved);
      return resolved;
    }

    if (keywordVideos.length > 0) {
      const resolved = await buildUniqueGenreVideos(keywordVideos);
      storeGenreVideosInCache(resolved);
      return resolved;
    }

      const fallback = await getGenreFallback();
      storeGenreVideosInCache(fallback);
      return fallback;
    });
  } catch {
    const fallback = await getGenreFallback();
    storeGenreVideosInCache(fallback);
    return fallback;
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
    return [];
  }

  if (!userId) {
    return [];
  }

  try {
    type PlaylistSummaryRow = {
      id: number | bigint;
      name: string | null;
      itemCount: number | bigint;
      leadVideoId: string | null;
    };

    const rowsByLegacySchema = await (async () => {
      try {
        return await prisma.$queryRaw<PlaylistSummaryRow[]>`
          SELECT
            p.id AS id,
            p.name AS name,
            (
              SELECT COUNT(*)
              FROM playlistitems pi
              WHERE pi.playlistId = p.id
            ) AS itemCount,
            (
              SELECT pi.videoId
              FROM playlistitems pi
              WHERE pi.playlistId = p.id
              ORDER BY pi.id ASC
              LIMIT 1
            ) AS leadVideoId
          FROM playlistnames p
          WHERE p.userId = ${userId}
          ORDER BY p.id ASC
          LIMIT 24
        `;
      } catch {
        return [] as PlaylistSummaryRow[];
      }
    })();

    const rowsByMappedSchema = await (async () => {
      try {
        return await prisma.$queryRaw<PlaylistSummaryRow[]>`
          SELECT
            p.id AS id,
            p.name AS name,
            (
              SELECT COUNT(*)
              FROM playlistitems pi
              WHERE pi.playlist_id = p.id
            ) AS itemCount,
            (
              SELECT v.videoId
              FROM playlistitems pi
              LEFT JOIN videos v ON v.id = pi.video_id
              WHERE pi.playlist_id = p.id
              ORDER BY pi.id ASC
              LIMIT 1
            ) AS leadVideoId
          FROM playlistnames p
          WHERE p.user_id = ${userId}
          ORDER BY p.id ASC
          LIMIT 24
        `;
      } catch {
        return [] as PlaylistSummaryRow[];
      }
    })();

    const legacyTotal = rowsByLegacySchema.reduce((sum, row) => {
      const count = typeof row.itemCount === "bigint" ? Number(row.itemCount) : Number(row.itemCount ?? 0);
      return sum + (Number.isFinite(count) ? count : 0);
    }, 0);

    const mappedTotal = rowsByMappedSchema.reduce((sum, row) => {
      const count = typeof row.itemCount === "bigint" ? Number(row.itemCount) : Number(row.itemCount ?? 0);
      return sum + (Number.isFinite(count) ? count : 0);
    }, 0);

    const rows = mappedTotal > legacyTotal ? rowsByMappedSchema : rowsByLegacySchema;

    if (rows.length === 0) {
      return [];
    }

    return rows.map((row) => {
      const lead = typeof row.leadVideoId === "string" && row.leadVideoId.length > 0 ? row.leadVideoId : "__placeholder__";
      const count = typeof row.itemCount === "bigint" ? Number(row.itemCount) : Number(row.itemCount ?? 0);

      return {
        id: String(typeof row.id === "bigint" ? Number(row.id) : row.id),
        name: row.name ?? "Untitled Playlist",
        itemCount: Number.isFinite(count) ? count : 0,
        leadVideoId: lead,
      };
    });
  } catch {
    return [];
  }
}

export async function getPlaylistById(id: string, userId?: number): Promise<PlaylistDetail | null> {
  if (!hasDatabaseUrl() || !userId) {
    return null;
  }

  const numericId = Number(id);

  if (!Number.isInteger(numericId)) {
    return null;
  }

  try {
    const playlistRowsByLegacyOwner = await (async () => {
      try {
        return await prisma.$queryRaw<Array<{ id: number | bigint; name: string | null }>>`
          SELECT id, name
          FROM playlistnames
          WHERE id = ${numericId} AND userId = ${userId}
          LIMIT 1
        `;
      } catch {
        return [] as Array<{ id: number | bigint; name: string | null }>;
      }
    })();

    const playlistRowsByMappedOwner = await (async () => {
      try {
        return await prisma.$queryRaw<Array<{ id: number | bigint; name: string | null }>>`
          SELECT id, name
          FROM playlistnames
          WHERE id = ${numericId} AND user_id = ${userId}
          LIMIT 1
        `;
      } catch {
        return [] as Array<{ id: number | bigint; name: string | null }>;
      }
    })();

    const playlist = playlistRowsByLegacyOwner[0] ?? playlistRowsByMappedOwner[0];

    if (!playlist) {
      return null;
    }

    type PlaylistDetailRow = RankedVideoRow & {
      playlistItemId: number | bigint;
    };

    const collapseToPlaylistItems = (rows: PlaylistDetailRow[]) => {
      const byPlaylistItemId = new Map<string, RankedVideoRow>();

      for (const row of rows) {
        const itemId = typeof row.playlistItemId === "bigint"
          ? row.playlistItemId.toString()
          : String(row.playlistItemId);

        if (byPlaylistItemId.has(itemId)) {
          continue;
        }

        byPlaylistItemId.set(itemId, {
          videoId: row.videoId,
          title: row.title,
          channelTitle: row.channelTitle,
          favourited: row.favourited,
          description: row.description,
        });
      }

      return [...byPlaylistItemId.values()];
    };

    const queryVariants: Array<() => Promise<PlaylistDetailRow[]>> = [
      async () =>
        prisma.$queryRaw<PlaylistDetailRow[]>`
          SELECT
            pi.id AS playlistItemId,
            COALESCE(v.videoId, pi.videoId) AS videoId,
            COALESCE(v.title, CONCAT('Video ', pi.videoId)) AS title,
            COALESCE(v.channelTitle, 'Unknown Channel') AS channelTitle,
            COALESCE(v.favourited, 0) AS favourited,
            COALESCE(v.description, 'Playlist track') AS description
          FROM playlistitems pi
          LEFT JOIN videos v ON v.videoId = pi.videoId
          WHERE pi.playlistId = ${numericId}
          ORDER BY pi.id ASC
        `,
      async () =>
          prisma.$queryRaw<PlaylistDetailRow[]>`
          SELECT
              pi.id AS playlistItemId,
            COALESCE(v.videoId, CAST(pi.videoId AS CHAR)) AS videoId,
            COALESCE(v.title, CONCAT('Video ', CAST(pi.videoId AS CHAR))) AS title,
            COALESCE(v.channelTitle, 'Unknown Channel') AS channelTitle,
            COALESCE(v.favourited, 0) AS favourited,
            COALESCE(v.description, 'Playlist track') AS description
          FROM playlistitems pi
          LEFT JOIN videos v ON v.id = pi.videoId
          WHERE pi.playlistId = ${numericId}
          ORDER BY pi.id ASC
        `,
      async () =>
          prisma.$queryRaw<PlaylistDetailRow[]>`
          SELECT
              pi.id AS playlistItemId,
            COALESCE(v.videoId, CAST(pi.video_id AS CHAR)) AS videoId,
            COALESCE(v.title, CONCAT('Video ', CAST(pi.video_id AS CHAR))) AS title,
            COALESCE(v.channelTitle, 'Unknown Channel') AS channelTitle,
            COALESCE(v.favourited, 0) AS favourited,
            COALESCE(v.description, 'Playlist track') AS description
          FROM playlistitems pi
          LEFT JOIN videos v ON v.id = pi.video_id
          WHERE pi.playlist_id = ${numericId}
          ORDER BY pi.id ASC
        `,
      async () =>
          prisma.$queryRaw<PlaylistDetailRow[]>`
          SELECT
              pi.id AS playlistItemId,
            COALESCE(v.videoId, pi.video_id) AS videoId,
            COALESCE(v.title, CONCAT('Video ', pi.video_id)) AS title,
            COALESCE(v.channelTitle, 'Unknown Channel') AS channelTitle,
            COALESCE(v.favourited, 0) AS favourited,
            COALESCE(v.description, 'Playlist track') AS description
          FROM playlistitems pi
          LEFT JOIN videos v ON v.videoId = pi.video_id
          WHERE pi.playlist_id = ${numericId}
          ORDER BY pi.id ASC
        `,
    ];

    let videoRows: RankedVideoRow[] = [];

    for (const query of queryVariants) {
      try {
        const rows = await query();
        const collapsed = collapseToPlaylistItems(rows);

        if (collapsed.length > videoRows.length) {
          videoRows = collapsed;
        }
      } catch {
        // Try next known schema variant.
      }
    }

    {
      const loadTableColumns = async (tableName: string) => {
        try {
          return await prisma.$queryRawUnsafe<Array<{ Field: string; Type: string }>>(
            `SHOW COLUMNS FROM ${tableName}`,
          );
        } catch {
          return [] as Array<{ Field: string; Type: string }>;
        }
      };

      const pickColumn = (columns: Array<{ Field: string; Type: string }>, names: string[]) =>
        columns.find((column) => names.includes(column.Field));

      const [playlistColumns, videoColumns] = await Promise.all([
        loadTableColumns("playlistitems"),
        loadTableColumns("videos"),
      ]);

      const playlistRef = pickColumn(playlistColumns, ["playlist_id", "playlistId", "playlistid"]);
      const videoRef = pickColumn(playlistColumns, ["video_id", "videoId", "videoid"]);
      const orderRef = pickColumn(playlistColumns, ["sort_order", "sortOrder", "id"]);
      const rowIdRef = pickColumn(playlistColumns, ["id"]);
      const videoPkRef = pickColumn(videoColumns, ["id"]);
      const videoExternalIdRef = pickColumn(videoColumns, ["videoId", "video_id", "videoid"]);
      const videoTitleRef = pickColumn(videoColumns, ["title"]);
      const videoChannelTitleRef = pickColumn(videoColumns, ["channelTitle", "channel_title", "channel"]);
      const videoFavouritedRef = pickColumn(videoColumns, ["favourited", "favorite", "is_favourited"]);
      const videoDescriptionRef = pickColumn(videoColumns, ["description", "desc"]);
      const isPlaylistVideoRefNumeric = Boolean(videoRef && /int|bigint|smallint|tinyint/i.test(videoRef.Type));

      if (playlistRef && videoRef && orderRef && rowIdRef && videoExternalIdRef) {
        const playlistCol = escapeSqlIdentifier(playlistRef.Field);
        const videoCol = escapeSqlIdentifier(videoRef.Field);
        const orderCol = escapeSqlIdentifier(orderRef.Field);
        const rowIdCol = escapeSqlIdentifier(rowIdRef.Field);
        const externalVideoCol = escapeSqlIdentifier(videoExternalIdRef.Field);
        const titleExpr = videoTitleRef ? `v.${escapeSqlIdentifier(videoTitleRef.Field)}` : "NULL";
        const channelTitleExpr = videoChannelTitleRef
          ? `v.${escapeSqlIdentifier(videoChannelTitleRef.Field)}`
          : "NULL";
        const favouritedExpr = videoFavouritedRef
          ? `v.${escapeSqlIdentifier(videoFavouritedRef.Field)}`
          : "0";
        const descriptionExpr = videoDescriptionRef
          ? `v.${escapeSqlIdentifier(videoDescriptionRef.Field)}`
          : "NULL";

        const joinCondition =
          isPlaylistVideoRefNumeric && videoPkRef
            ? `v.${escapeSqlIdentifier(videoPkRef.Field)} = pi.${videoCol}`
            : `v.${externalVideoCol} = pi.${videoCol}`;

        const unresolvedVideoExpr = isPlaylistVideoRefNumeric
          ? `CAST(pi.${videoCol} AS CHAR)`
          : `pi.${videoCol}`;

        try {
          const fallbackRows = await prisma.$queryRawUnsafe<PlaylistDetailRow[]>(
            `
              SELECT
                pi.${rowIdCol} AS playlistItemId,
                COALESCE(v.${externalVideoCol}, ${unresolvedVideoExpr}) AS videoId,
                COALESCE(${titleExpr}, CONCAT('Video ', ${unresolvedVideoExpr})) AS title,
                COALESCE(${channelTitleExpr}, 'Unknown Channel') AS channelTitle,
                COALESCE(${favouritedExpr}, 0) AS favourited,
                COALESCE(${descriptionExpr}, 'Playlist track') AS description
              FROM playlistitems pi
              LEFT JOIN videos v ON ${joinCondition}
              WHERE pi.${playlistCol} = ?
              ORDER BY pi.${orderCol} ASC
            `,
            numericId,
          );

          const collapsed = collapseToPlaylistItems(fallbackRows);

          if (collapsed.length > 0) {
            videoRows = collapsed;
          }
        } catch {
          // Keep empty rows and return playlist shell below.
        }
      }
    }

    return {
      id: String(typeof playlist.id === "bigint" ? Number(playlist.id) : playlist.id),
      name: playlist.name ?? "Untitled Playlist",
      videos: videoRows.map(mapVideo),
    };
  } catch {
    return null;
  }
}

export async function getFavouriteVideos(userId?: number) {
  if (!userId || !hasDatabaseUrl()) {
    return [];
  }

  try {
    const favourites = await prisma.favourite.findMany({
      where: { userid: userId },
      select: { videoId: true },
      take: 50,
    });

    const youtubeIds = favourites
      .map((f) => f.videoId)
      .filter((id): id is string => Boolean(id));

    if (youtubeIds.length === 0) return [];

    const videos = await prisma.video.findMany({
      where: { videoId: { in: youtubeIds } },
      select: {
        videoId: true,
        title: true,
        favourited: true,
        description: true,
      },
    });

    const firstVideoById = new Map<string, (typeof videos)[number]>();

    for (const video of videos) {
      if (!firstVideoById.has(video.videoId)) {
        firstVideoById.set(video.videoId, video);
      }
    }

    const orderedVideos = youtubeIds
      .map((id) => firstVideoById.get(id))
      .filter((video): video is (typeof videos)[number] => Boolean(video));

    return orderedVideos.map((video) =>
      mapVideo({
        ...video,
        channelTitle: null,
      }),
    );
  } catch {
    return [];
  }
}

export async function updateFavourite(videoId: string, action: "add" | "remove", userId?: number) {
  if (hasDatabaseUrl() && userId) {
    const normalizedVideoId = normalizeYouTubeVideoId(videoId) ?? videoId;

    if (action === "add") {
      const existing = await prisma.favourite.findFirst({
        where: { userid: userId, videoId: normalizedVideoId },
        select: { id: true },
      });

      if (!existing) {
        await prisma.favourite.create({
          data: { userid: userId, videoId: normalizedVideoId },
        });
      }
    } else {
      await prisma.favourite.deleteMany({
        where: { userid: userId, videoId: normalizedVideoId },
      });
    }

    const favouriteCount = await prisma.favourite.count({
      where: { videoId: normalizedVideoId },
    });

    await prisma.video.updateMany({
      where: { videoId: normalizedVideoId },
      data: { favourited: favouriteCount },
    });

    topPoolCache = undefined;
    const { invalidateTopVideosCache } = await import("@/lib/top-videos-cache");
    invalidateTopVideosCache();

    return {
      videoId: normalizedVideoId,
      isFavourite: action === "add",
      favourites: await getFavouriteVideos(userId),
    };
  }

  return {
    videoId,
    isFavourite: false,
    favourites: await getFavouriteVideos(userId),
  };
}

export async function createPlaylist(name: string, videoIds: string[] = [], userId?: number) {
  if (hasDatabaseUrl() && userId) {
    const now = new Date();

    // The active DB schema for playlists can vary by environment; try known column shapes.
    let inserted = false;

    try {
      await prisma.$executeRaw`
        INSERT INTO playlistnames (userId, name, createdAt, updatedAt)
        VALUES (${userId}, ${name}, ${now}, ${now})
      `;
      inserted = true;
    } catch {
      // no-op, try alternative shape
    }

    if (!inserted) {
      try {
        await prisma.$executeRaw`
          INSERT INTO playlistnames (user_id, name, is_private)
          VALUES (${userId}, ${name}, ${false})
        `;
        inserted = true;
      } catch {
        // no-op, handled by final throw below
      }
    }

    if (!inserted) {
      throw new Error("Playlist insert failed for known playlistnames schemas.");
    }

    const insertedIdRows = await prisma.$queryRaw<Array<{ id: number | bigint }>>`
      SELECT LAST_INSERT_ID() AS id
    `;
    const createdId = insertedIdRows[0]?.id;
    const playlistId = typeof createdId === "bigint" ? Number(createdId) : createdId;

    if (!playlistId) {
      throw new Error("Playlist inserted but id could not be resolved.");
    }

    if (videoIds.length > 0) {
      const uniqueVideoIds = [...new Set(videoIds.filter(Boolean))].slice(0, 50);

      for (const videoId of uniqueVideoIds) {
        try {
          await prisma.$executeRaw`
            INSERT INTO playlistitems (playlistId, videoId, createdAt, updatedAt)
            VALUES (${playlistId}, ${videoId}, ${now}, ${now})
          `;
        } catch {
          // Item linkage is optional for create success; keep base playlist creation successful.
        }
      }
    }

    return {
      id: String(playlistId),
      name,
      videos: [],
    };
  }

  throw new Error("Playlist creation requires a configured database and authenticated user.");
}

export async function addPlaylistItem(playlistId: string, videoId: string, userId?: number) {
  if (hasDatabaseUrl() && userId) {
    const numericPlaylistId = Number(playlistId);
    const normalizedVideoId = normalizeYouTubeVideoId(videoId) ?? videoId;

    if (!Number.isInteger(numericPlaylistId)) {
      return null;
    }

    try {
      let ownerColumn: "userId" | "user_id" | null = null;

      try {
        const rows = await prisma.$queryRaw<Array<{ id: number | bigint }>>`
          SELECT id
          FROM playlistnames
          WHERE id = ${numericPlaylistId} AND userId = ${userId}
          LIMIT 1
        `;

        if (rows.length > 0) {
          ownerColumn = "userId";
        }
      } catch {
        // Try alternative schema below.
      }

      if (!ownerColumn) {
        try {
          const rows = await prisma.$queryRaw<Array<{ id: number | bigint }>>`
            SELECT id
            FROM playlistnames
            WHERE id = ${numericPlaylistId} AND user_id = ${userId}
            LIMIT 1
          `;

          if (rows.length > 0) {
            ownerColumn = "user_id";
          }
        } catch {
          // no-op
        }
      }

      if (!ownerColumn) {
        return null;
      }

      const existingPlaylist = await getPlaylistById(String(numericPlaylistId), userId);
      if (existingPlaylist?.videos.some((video) => {
        const existingNormalizedId = normalizeYouTubeVideoId(video.id) ?? video.id;
        return existingNormalizedId === normalizedVideoId;
      })) {
        return existingPlaylist;
      }

      const now = new Date();
      let inserted = false;

      const legacyAttempts: Array<() => Promise<number>> = [
        async () =>
          Number(
            await prisma.$executeRaw`
              INSERT INTO playlistitems (playlistId, videoId, createdAt, updatedAt)
              VALUES (${numericPlaylistId}, ${normalizedVideoId}, ${now}, ${now})
            `,
          ),
        async () =>
          Number(
            await prisma.$executeRaw`
              INSERT INTO playlistitems (playlistId, videoId)
              VALUES (${numericPlaylistId}, ${normalizedVideoId})
            `,
          ),
      ];

      for (const attempt of legacyAttempts) {
        try {
          const changed = await attempt();
          if (changed > 0) {
            inserted = true;
            break;
          }
        } catch {
          // Try next known insert shape.
        }
      }

      if (!inserted) {
        let videoPk: number | null = null;

        try {
          const videoRows = await prisma.$queryRaw<Array<{ id: number | bigint }>>`
            SELECT id
            FROM videos
            WHERE videoId = ${normalizedVideoId}
            LIMIT 1
          `;
          const resolvedId = videoRows[0]?.id;
          videoPk = typeof resolvedId === "bigint" ? Number(resolvedId) : Number(resolvedId ?? NaN);

          if (!Number.isInteger(videoPk)) {
            videoPk = null;
          }
        } catch {
          videoPk = null;
        }

        if (videoPk !== null) {
          const modernAttempts: Array<() => Promise<number>> = [
            async () =>
              Number(
                await prisma.$executeRaw`
                  INSERT INTO playlistitems (playlist_id, video_id, sort_order)
                  VALUES (
                    ${numericPlaylistId},
                    ${videoPk},
                    COALESCE((SELECT MAX(sort_order) + 1 FROM playlistitems WHERE playlist_id = ${numericPlaylistId}), 0)
                  )
                `,
              ),
            async () =>
              Number(
                await prisma.$executeRaw`
                  INSERT INTO playlistitems (playlist_id, video_id)
                  VALUES (${numericPlaylistId}, ${videoPk})
                `,
              ),
          ];

          for (const attempt of modernAttempts) {
            try {
              const changed = await attempt();
              if (changed > 0) {
                inserted = true;
                break;
              }
            } catch {
              // Try next known insert shape.
            }
          }
        }
      }

      if (!inserted) {
        return null;
      }

      const resolvedPlaylist = await getPlaylistById(String(numericPlaylistId), userId);

      if (resolvedPlaylist) {
        return resolvedPlaylist;
      }

      const fallbackRows =
        ownerColumn === "userId"
          ? await prisma.$queryRaw<Array<{ id: number | bigint; name: string | null }>>`
              SELECT id, name
              FROM playlistnames
              WHERE id = ${numericPlaylistId} AND userId = ${userId}
              LIMIT 1
            `
          : await prisma.$queryRaw<Array<{ id: number | bigint; name: string | null }>>`
              SELECT id, name
              FROM playlistnames
              WHERE id = ${numericPlaylistId} AND user_id = ${userId}
              LIMIT 1
            `;

      const fallback = fallbackRows[0];

      if (!fallback) {
        return null;
      }

      return {
        id: String(typeof fallback.id === "bigint" ? Number(fallback.id) : fallback.id),
        name: fallback.name ?? "Untitled Playlist",
        videos: [],
      };
    } catch {
      return null;
    }
  }

  return null;
}

export async function removePlaylistItem(playlistId: string, playlistItemIndex: number, userId?: number) {
  if (!hasDatabaseUrl() || !userId) {
    return null;
  }

  const numericPlaylistId = Number(playlistId);

  if (!Number.isInteger(numericPlaylistId) || !Number.isInteger(playlistItemIndex) || playlistItemIndex < 0) {
    return null;
  }

  try {
    let ownerColumn: "userId" | "user_id" | null = null;

    try {
      const rows = await prisma.$queryRaw<Array<{ id: number | bigint }>>`
        SELECT id
        FROM playlistnames
        WHERE id = ${numericPlaylistId} AND userId = ${userId}
        LIMIT 1
      `;

      if (rows.length > 0) {
        ownerColumn = "userId";
      }
    } catch {
      // Try mapped owner column below.
    }

    if (!ownerColumn) {
      try {
        const rows = await prisma.$queryRaw<Array<{ id: number | bigint }>>`
          SELECT id
          FROM playlistnames
          WHERE id = ${numericPlaylistId} AND user_id = ${userId}
          LIMIT 1
        `;

        if (rows.length > 0) {
          ownerColumn = "user_id";
        }
      } catch {
        // no-op
      }
    }

    if (!ownerColumn) {
      return null;
    }

    const loadTableColumns = async (tableName: string) => {
      try {
        return await prisma.$queryRawUnsafe<Array<{ Field: string; Type: string }>>(
          `SHOW COLUMNS FROM ${tableName}`,
        );
      } catch {
        return [] as Array<{ Field: string; Type: string }>;
      }
    };

    const pickColumn = (columns: Array<{ Field: string; Type: string }>, names: string[]) =>
      columns.find((column) => names.includes(column.Field));

    const playlistColumns = await loadTableColumns("playlistitems");
    const playlistRef = pickColumn(playlistColumns, ["playlist_id", "playlistId", "playlistid"]);
    const rowIdRef = pickColumn(playlistColumns, ["id"]);
    const orderRef = pickColumn(playlistColumns, ["sort_order", "sortOrder", "id"]);

    if (!playlistRef || !rowIdRef || !orderRef) {
      return null;
    }

    const playlistCol = escapeSqlIdentifier(playlistRef.Field);
    const rowIdCol = escapeSqlIdentifier(rowIdRef.Field);
    const orderCol = escapeSqlIdentifier(orderRef.Field);

    const itemRows = await prisma.$queryRawUnsafe<Array<{ rowId: number | bigint }>>(
      `
        SELECT pi.${rowIdCol} AS rowId
        FROM playlistitems pi
        WHERE pi.${playlistCol} = ?
        ORDER BY pi.${orderCol} ASC, pi.${rowIdCol} ASC
      `,
      numericPlaylistId,
    );

    const target = itemRows[playlistItemIndex];

    if (!target) {
      return null;
    }

    await prisma.$executeRawUnsafe(
      `DELETE FROM playlistitems WHERE ${rowIdCol} = ? LIMIT 1`,
      typeof target.rowId === "bigint" ? Number(target.rowId) : target.rowId,
    );

    return await getPlaylistById(String(numericPlaylistId), userId);
  } catch {
    return null;
  }
}

export async function reorderPlaylistItems(playlistId: string, fromIndex: number, toIndex: number, userId?: number) {
  if (!hasDatabaseUrl() || !userId) {
    return null;
  }

  const numericPlaylistId = Number(playlistId);

  if (!Number.isInteger(numericPlaylistId) || !Number.isInteger(fromIndex) || !Number.isInteger(toIndex)) {
    return null;
  }

  if (fromIndex < 0 || toIndex < 0) {
    return null;
  }

  if (fromIndex === toIndex) {
    return await getPlaylistById(String(numericPlaylistId), userId);
  }

  try {
    let ownerColumn: "userId" | "user_id" | null = null;

    try {
      const rows = await prisma.$queryRaw<Array<{ id: number | bigint }>>`
        SELECT id
        FROM playlistnames
        WHERE id = ${numericPlaylistId} AND userId = ${userId}
        LIMIT 1
      `;

      if (rows.length > 0) {
        ownerColumn = "userId";
      }
    } catch {
      // Try mapped owner column below.
    }

    if (!ownerColumn) {
      try {
        const rows = await prisma.$queryRaw<Array<{ id: number | bigint }>>`
          SELECT id
          FROM playlistnames
          WHERE id = ${numericPlaylistId} AND user_id = ${userId}
          LIMIT 1
        `;

        if (rows.length > 0) {
          ownerColumn = "user_id";
        }
      } catch {
        // no-op
      }
    }

    if (!ownerColumn) {
      return null;
    }

    const loadTableColumns = async (tableName: string) => {
      try {
        return await prisma.$queryRawUnsafe<Array<{ Field: string; Type: string }>>(
          `SHOW COLUMNS FROM ${tableName}`,
        );
      } catch {
        return [] as Array<{ Field: string; Type: string }>;
      }
    };

    const pickColumn = (columns: Array<{ Field: string; Type: string }>, names: string[]) =>
      columns.find((column) => names.includes(column.Field));

    const playlistColumns = await loadTableColumns("playlistitems");
    const playlistRef = pickColumn(playlistColumns, ["playlist_id", "playlistId", "playlistid"]);
    const rowIdRef = pickColumn(playlistColumns, ["id"]);
    const orderRef = pickColumn(playlistColumns, ["sort_order", "sortOrder", "id"]);

    if (!playlistRef || !rowIdRef || !orderRef) {
      return null;
    }

    // Reordering requires a mutable ordering column.
    if (orderRef.Field === "id") {
      return null;
    }

    const playlistCol = escapeSqlIdentifier(playlistRef.Field);
    const rowIdCol = escapeSqlIdentifier(rowIdRef.Field);
    const orderCol = escapeSqlIdentifier(orderRef.Field);

    const itemRows = await prisma.$queryRawUnsafe<Array<{ rowId: number | bigint }>>(
      `
        SELECT pi.${rowIdCol} AS rowId
        FROM playlistitems pi
        WHERE pi.${playlistCol} = ?
        ORDER BY pi.${orderCol} ASC, pi.${rowIdCol} ASC
      `,
      numericPlaylistId,
    );

    if (fromIndex >= itemRows.length || toIndex >= itemRows.length) {
      return null;
    }

    const reordered = [...itemRows];
    const [moved] = reordered.splice(fromIndex, 1);

    if (!moved) {
      return null;
    }

    reordered.splice(toIndex, 0, moved);

    for (let index = 0; index < reordered.length; index += 1) {
      const rowId = reordered[index]?.rowId;

      if (rowId === undefined || rowId === null) {
        continue;
      }

      const normalizedRowId = typeof rowId === "bigint" ? Number(rowId) : rowId;
      await prisma.$executeRawUnsafe(
        `UPDATE playlistitems SET ${orderCol} = ? WHERE ${rowIdCol} = ? LIMIT 1`,
        index,
        normalizedRowId,
      );
    }

    return await getPlaylistById(String(numericPlaylistId), userId);
  } catch {
    return null;
  }
}

export async function renamePlaylist(playlistId: string, name: string, userId?: number) {
  if (hasDatabaseUrl() && userId) {
    const numericId = Number(playlistId);
    const trimmedName = name.trim();

    if (!Number.isInteger(numericId) || trimmedName.length < 2) {
      return false;
    }

    const now = new Date();

    try {
      const attempts: Array<() => Promise<number>> = [
        async () =>
          Number(
            await prisma.$executeRaw`
              UPDATE playlistnames
              SET name = ${trimmedName}, updatedAt = ${now}
              WHERE id = ${numericId} AND userId = ${userId}
            `,
          ),
        async () =>
          Number(
            await prisma.$executeRaw`
              UPDATE playlistnames
              SET name = ${trimmedName}
              WHERE id = ${numericId} AND userId = ${userId}
            `,
          ),
        async () =>
          Number(
            await prisma.$executeRaw`
              UPDATE playlistnames
              SET name = ${trimmedName}, updatedAt = ${now}
              WHERE id = ${numericId} AND user_id = ${userId}
            `,
          ),
        async () =>
          Number(
            await prisma.$executeRaw`
              UPDATE playlistnames
              SET name = ${trimmedName}
              WHERE id = ${numericId} AND user_id = ${userId}
            `,
          ),
      ];

      for (const attempt of attempts) {
        try {
          const changed = await attempt();

          if (changed > 0) {
            return true;
          }
        } catch {
          // Try the next known schema shape.
        }
      }

      return false;
    } catch {
      return false;
    }
  }

  return false;
}

export async function deletePlaylist(playlistId: string, userId?: number) {
  if (hasDatabaseUrl() && userId) {
    const numericId = Number(playlistId);

    if (!Number.isInteger(numericId)) {
      return false;
    }

    try {
      let ownerColumn: "userId" | "user_id" | null = null;

      try {
        const rows = await prisma.$queryRaw<Array<{ id: number | bigint }>>`
          SELECT id
          FROM playlistnames
          WHERE id = ${numericId} AND userId = ${userId}
          LIMIT 1
        `;

        if (rows.length > 0) {
          ownerColumn = "userId";
        }
      } catch {
        // Try alternative schema below.
      }

      if (!ownerColumn) {
        try {
          const rows = await prisma.$queryRaw<Array<{ id: number | bigint }>>`
            SELECT id
            FROM playlistnames
            WHERE id = ${numericId} AND user_id = ${userId}
            LIMIT 1
          `;

          if (rows.length > 0) {
            ownerColumn = "user_id";
          }
        } catch {
          // no-op
        }
      }

      if (!ownerColumn) {
        return false;
      }

      try {
        await prisma.$executeRaw`
          DELETE FROM playlistitems
          WHERE playlistId = ${numericId}
        `;
      } catch {
        await prisma.$executeRaw`
          DELETE FROM playlistitems
          WHERE playlist_id = ${numericId}
        `;
      }

      const deleted =
        ownerColumn === "userId"
          ? await prisma.$executeRaw`
              DELETE FROM playlistnames
              WHERE id = ${numericId} AND userId = ${userId}
            `
          : await prisma.$executeRaw`
              DELETE FROM playlistnames
              WHERE id = ${numericId} AND user_id = ${userId}
            `;

      return Number(deleted) > 0;
    } catch {
      return false;
    }
  }

  return false;
}

export type PublicUserProfile = {
  id: number;
  screenName: string;
  avatarUrl: string | null;
  bio: string | null;
  location: string | null;
};

export async function getPublicUserProfile(screenName: string): Promise<{
  user: PublicUserProfile | null;
  favourites: VideoRecord[];
  playlists: PlaylistSummary[];
}> {
  const empty = { user: null, favourites: [], playlists: [] };

  if (!screenName.trim() || !hasDatabaseUrl()) {
    return empty;
  }

  let user: PublicUserProfile | null = null;

  try {
    const rows = await prisma.$queryRaw<
      Array<{
        id: number;
        screenName: string | null;
        avatarUrl: string | null;
        bio: string | null;
        location: string | null;
      }>
    >`
      SELECT id, screen_name AS screenName, avatar_url AS avatarUrl, bio, location
      FROM users
      WHERE screen_name = ${screenName}
      LIMIT 1
    `;

    const row = rows[0];
    if (!row || !row.screenName) {
      return empty;
    }

    user = {
      id: Number(row.id),
      screenName: row.screenName,
      avatarUrl: row.avatarUrl ?? null,
      bio: row.bio ?? null,
      location: row.location ?? null,
    };
  } catch {
    return empty;
  }

  const [favourites, playlists] = await Promise.all([
    getFavouriteVideos(user.id),
    getPlaylists(user.id),
  ]);

  return { user, favourites, playlists };
}

export async function getPublicPlaylistVideos(userId: number, playlistId: string): Promise<VideoRecord[]> {
  if (!hasDatabaseUrl()) {
    return [];
  }

  try {
    const playlist = await getPlaylistById(playlistId, userId);
    return playlist?.videos ?? [];
  } catch {
    return [];
  }
}

