#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { PrismaClient } = require("@prisma/client");

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const match = trimmed.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match) {
      continue;
    }

    const [, key, rawValue] = match;
    if (process.env[key]) {
      continue;
    }

    process.env[key] = rawValue.replace(/^"/, "").replace(/"$/, "");
  }
}

function loadEnv() {
  loadEnvFile(path.resolve(process.cwd(), "apps/web/.env.local"));
  loadEnvFile(path.resolve(process.cwd(), ".env"));
}

function parseArg(name, fallback) {
  const raw = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  if (!raw) {
    return fallback;
  }
  return raw.slice(name.length + 3);
}

function toPositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function toSafeNumber(value, fallback = 0) {
  if (typeof value === "bigint") {
    return Number(value);
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function ensureDirFor(filePath) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
}

function readState(statePath) {
  if (!fs.existsSync(statePath)) {
    return {
      posts: [],
      lastRunAt: null,
    };
  }

  try {
    const raw = fs.readFileSync(statePath, "utf8");
    const parsed = JSON.parse(raw);
    return {
      posts: Array.isArray(parsed.posts) ? parsed.posts : [],
      lastRunAt: typeof parsed.lastRunAt === "string" ? parsed.lastRunAt : null,
    };
  } catch {
    return {
      posts: [],
      lastRunAt: null,
    };
  }
}

function writeState(statePath, state) {
  ensureDirFor(statePath);
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
}

function pickWeightedCandidate(candidates) {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return null;
  }

  const tierA = candidates.slice(0, 120);
  const tierB = candidates.slice(120, 420);
  const tierC = candidates.slice(420);

  const availableTiers = [
    { tier: tierA, weight: 0.55 },
    { tier: tierB, weight: 0.30 },
    { tier: tierC, weight: 0.15 },
  ].filter((entry) => entry.tier.length > 0);

  if (availableTiers.length === 0) {
    return null;
  }

  const totalWeight = availableTiers.reduce((sum, entry) => sum + entry.weight, 0);
  let cursor = Math.random() * totalWeight;
  let selectedTier = availableTiers[0].tier;

  for (const entry of availableTiers) {
    cursor -= entry.weight;
    if (cursor <= 0) {
      selectedTier = entry.tier;
      break;
    }
  }

  const pickIndex = Math.floor(Math.random() * selectedTier.length);
  return selectedTier[pickIndex] ?? candidates[0] ?? null;
}

function buildShareMessage(video) {
  const title = String(video.title || "Unknown track").trim();
  const artist = String(video.artist || "Unknown artist").trim();
  const genre = String(video.genre || "Rock / Metal").trim();

  return `Now playing on YehThatRocks:\n${artist} - ${title}\nGenre: ${genre}\n\nWhat do you think of this one?`;
}

async function postToFacebookGroup({ groupId, accessToken, link, message }) {
  const endpoint = `https://graph.facebook.com/v20.0/${encodeURIComponent(groupId)}/feed`;
  const payload = new URLSearchParams();
  payload.set("link", link);
  payload.set("message", message);
  payload.set("access_token", accessToken);

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: payload,
  });

  const text = await response.text();
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null;
  }

  if (!response.ok) {
    const reason = parsed?.error?.message || text || `facebook-http-${response.status}`;
    throw new Error(reason);
  }

  return {
    id: parsed?.id || null,
    raw: parsed,
  };
}

async function getTopPlayableCandidates(prisma, poolSize) {
  const limit = Math.max(50, Math.min(poolSize, 2000));

  const videoColumns = await prisma.$queryRawUnsafe("SHOW COLUMNS FROM videos");
  const columnSet = new Set(videoColumns.map((col) => String(col.Field || "").trim()));

  const artistExpr = columnSet.has("parsedArtist")
    ? "COALESCE(NULLIF(TRIM(v.parsedArtist), ''), 'Unknown artist')"
    : "'Unknown artist'";
  const titleExpr = columnSet.has("parsedTrack")
    ? "COALESCE(NULLIF(TRIM(v.parsedTrack), ''), NULLIF(TRIM(v.title), ''), 'Unknown track')"
    : "COALESCE(NULLIF(TRIM(v.title), ''), 'Unknown track')";
  const genreExpr = columnSet.has("genre")
    ? "COALESCE(NULLIF(TRIM(v.genre), ''), 'Rock / Metal')"
    : "'Rock / Metal'";
  const favouritedExpr = columnSet.has("favourited") ? "COALESCE(v.favourited, 0)" : "0";

  // Pull a quality-weighted pool from playable catalogue rows.
  const rows = await prisma.$queryRawUnsafe(
    `
      SELECT
        v.videoId AS videoId,
        ${artistExpr} AS artist,
        ${titleExpr} AS title,
        ${genreExpr} AS genre,
        ${favouritedExpr} AS favourited,
        v.id AS internalId
      FROM videos v
      WHERE v.videoId REGEXP '^[A-Za-z0-9_-]{11}$'
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
      ORDER BY ${favouritedExpr} DESC, v.id DESC
      LIMIT ?
    `,
    limit,
  );

  return rows.map((row) => ({
    videoId: String(row.videoId || "").trim(),
    artist: String(row.artist || "Unknown artist"),
    title: String(row.title || "Unknown track"),
    genre: String(row.genre || "Rock / Metal"),
    favourited: toSafeNumber(row.favourited, 0),
    internalId: toSafeNumber(row.internalId, 0),
  })).filter((row) => row.videoId.length === 11);
}

async function main() {
  loadEnv();

  const dryRunFromArg = process.argv.includes("--dry-run");
  const dryRunFromEnv = String(process.env.FB_GROUP_AUTOSHARE_DRY_RUN || "1") === "1";
  const dryRun = dryRunFromArg || dryRunFromEnv;

  const minIntervalMinutes = toPositiveInt(process.env.FB_GROUP_AUTOSHARE_MIN_INTERVAL_MINUTES || "180", 180);
  const maxPostsPerDay = toPositiveInt(process.env.FB_GROUP_AUTOSHARE_MAX_POSTS_PER_DAY || "4", 4);
  const candidatePoolSize = toPositiveInt(process.env.FB_GROUP_AUTOSHARE_POOL_SIZE || "600", 600);
  const dedupeWindowDays = toPositiveInt(process.env.FB_GROUP_AUTOSHARE_DEDUPE_DAYS || "30", 30);
  const statePath = path.resolve(
    process.cwd(),
    process.env.FB_GROUP_AUTOSHARE_STATE_PATH || "logs/facebook-group-autoshare-state.json",
  );

  const appUrl = (process.env.APP_URL || "").trim().replace(/\/$/, "");
  const groupId = (process.env.FB_GROUP_ID || "").trim();
  const accessToken = (process.env.FB_GROUP_ACCESS_TOKEN || "").trim();

  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set. Add it to apps/web/.env.local or current shell.");
  }

  if (!appUrl) {
    throw new Error("APP_URL is required for share links.");
  }

  if (!dryRun) {
    if (!groupId) {
      throw new Error("FB_GROUP_ID is required when dry-run is disabled.");
    }
    if (!accessToken) {
      throw new Error("FB_GROUP_ACCESS_TOKEN is required when dry-run is disabled.");
    }
  }

  const now = new Date();
  const state = readState(statePath);
  const posts = Array.isArray(state.posts) ? state.posts : [];

  const minIntervalMs = minIntervalMinutes * 60 * 1000;
  const lastPostedAt = posts.length > 0 ? new Date(posts[posts.length - 1].postedAt).getTime() : null;
  if (lastPostedAt && Number.isFinite(lastPostedAt) && now.getTime() - lastPostedAt < minIntervalMs) {
    const remainingMs = minIntervalMs - (now.getTime() - lastPostedAt);
    const remainingMin = Math.ceil(remainingMs / 60000);
    console.log(`[facebook-autoshare] Skipped: min interval not reached. Try again in ~${remainingMin} minute(s).`);
    return;
  }

  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const postsToday = posts.filter((entry) => {
    const ts = new Date(entry.postedAt).getTime();
    return Number.isFinite(ts) && ts >= startOfDay.getTime();
  }).length;

  if (postsToday >= maxPostsPerDay) {
    console.log(`[facebook-autoshare] Skipped: daily cap reached (${postsToday}/${maxPostsPerDay}).`);
    return;
  }

  const dedupeCutoff = new Date(now.getTime() - dedupeWindowDays * 24 * 60 * 60 * 1000).getTime();
  const recentlyPostedIds = new Set(
    posts
      .filter((entry) => {
        const ts = new Date(entry.postedAt).getTime();
        return Number.isFinite(ts) && ts >= dedupeCutoff;
      })
      .map((entry) => String(entry.videoId || "").trim())
      .filter(Boolean),
  );

  const prisma = new PrismaClient();
  try {
    const pool = await getTopPlayableCandidates(prisma, candidatePoolSize);
    const filteredPool = pool.filter((video) => !recentlyPostedIds.has(video.videoId));
    const candidates = filteredPool.length > 0 ? filteredPool : pool;

    if (candidates.length === 0) {
      console.log("[facebook-autoshare] Skipped: no playable candidates available.");
      return;
    }

    const selected = pickWeightedCandidate(candidates);
    if (!selected) {
      console.log("[facebook-autoshare] Skipped: no candidate selected.");
      return;
    }

    const shareLink = `${appUrl}/s/${encodeURIComponent(selected.videoId)}`;
    const message = buildShareMessage(selected);

    if (dryRun) {
      console.log("[facebook-autoshare] Dry run: would post the following payload:");
      console.log(JSON.stringify({
        groupId: groupId || "<not-set>",
        link: shareLink,
        message,
        selected,
      }, null, 2));
      return;
    }

    const result = await postToFacebookGroup({
      groupId,
      accessToken,
      link: shareLink,
      message,
    });

    const nextState = {
      lastRunAt: now.toISOString(),
      posts: [
        ...posts,
        {
          postedAt: now.toISOString(),
          videoId: selected.videoId,
          title: selected.title,
          artist: selected.artist,
          link: shareLink,
          facebookPostId: result.id,
        },
      ].slice(-500),
    };

    writeState(statePath, nextState);

    console.log("[facebook-autoshare] Posted successfully.");
    console.log(JSON.stringify({ facebookPostId: result.id, videoId: selected.videoId, link: shareLink }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("[facebook-autoshare] Failed:", error?.message || error);
  process.exit(1);
});
