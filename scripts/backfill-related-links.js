#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { PrismaClient } = require("@prisma/client");

function loadDatabaseEnv() {
  const envPath = path.resolve(process.cwd(), "apps/web/.env.local");
  if (!fs.existsSync(envPath)) {
    return;
  }

  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
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

function parseArg(name, fallback) {
  const raw = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  if (!raw) {
    return fallback;
  }
  return raw.slice(name.length + 3);
}

function normalizeVideoId(value) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!/^[A-Za-z0-9_-]{11}$/.test(trimmed)) {
    return null;
  }

  return trimmed;
}

function toNumber(value) {
  if (typeof value === "bigint") {
    return Number(value);
  }

  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function toSerializable(value) {
  if (Array.isArray(value)) {
    return value.map(toSerializable);
  }

  if (value && typeof value === "object") {
    const next = {};
    for (const [key, inner] of Object.entries(value)) {
      next[key] = toSerializable(inner);
    }
    return next;
  }

  if (typeof value === "bigint") {
    return Number(value);
  }

  return value;
}

loadDatabaseEnv();

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set. Add it to apps/web/.env.local or the current shell.");
  process.exit(1);
}

if (!process.env.YOUTUBE_DATA_API_KEY) {
  console.error("YOUTUBE_DATA_API_KEY is not set. Add it to apps/web/.env.local or the current shell.");
  process.exit(1);
}

const maxCalls = Math.max(1, Number(parseArg("max-calls", "5000")));
const minRelated = Math.max(1, Number(parseArg("min-related", "4")));
const candidateLimit = Math.max(1, Number(parseArg("candidate-limit", String(maxCalls))));
const includeNonPlayable = process.argv.includes("--include-non-playable");
const dryRun = process.argv.includes("--dry-run");
const statePathArg = parseArg("state", "").trim();
const statePath = statePathArg || path.resolve(process.cwd(), "logs/related-backfill-state.json");

const prisma = new PrismaClient();

function readState(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function writeState(filePath, payload) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function fetchRelatedFromYouTube(videoId) {
  const url = new URL("https://www.googleapis.com/youtube/v3/search");
  url.searchParams.set("part", "snippet");
  url.searchParams.set("maxResults", "8");
  url.searchParams.set("relatedToVideoId", videoId);
  url.searchParams.set("type", "video");
  url.searchParams.set("key", process.env.YOUTUBE_DATA_API_KEY);

  const response = await fetch(url, {
    headers: {
      "User-Agent": "YehThatRocksRelatedBackfill/1.0",
    },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    const quotaExceeded =
      response.status === 403 &&
      /exceeded your\s*<a href=.*quota|quota/i.test(body);
    const error = new Error(`YouTube API ${response.status}: ${body.slice(0, 220)}`);
    error.quotaExceeded = quotaExceeded;
    throw error;
  }

  const payload = await response.json();
  const ids = (payload.items ?? [])
    .map((item) => normalizeVideoId(item?.id?.videoId))
    .filter((id) => Boolean(id) && id !== videoId);

  return Array.from(new Set(ids));
}

async function getCandidateVideos(limit) {
  const playableClause = includeNonPlayable
    ? "1 = 1"
    : `
      EXISTS (
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
    `;

  return prisma.$queryRawUnsafe(
    `
      SELECT
        v.id,
        v.videoId,
        v.title,
        COALESCE(rc.relatedCount, 0) AS relatedCount
      FROM videos v
      LEFT JOIN (
        SELECT
          r.videoId,
          COUNT(DISTINCT r.related) AS relatedCount
        FROM related r
        WHERE r.videoId IS NOT NULL
          AND r.related IS NOT NULL
          AND TRIM(r.videoId) <> ''
          AND TRIM(r.related) <> ''
          AND r.videoId <> r.related
        GROUP BY r.videoId
      ) rc ON rc.videoId = v.videoId
      WHERE v.videoId REGEXP '^[A-Za-z0-9_-]{11}$'
        AND ${playableClause}
        AND COALESCE(rc.relatedCount, 0) < ?
      ORDER BY relatedCount ASC, v.id ASC
      LIMIT ${Math.max(1, limit)}
    `,
    minRelated,
  );
}

async function main() {
  const today = new Date().toISOString().slice(0, 10);
  const state = readState(statePath) || {};
  const usedToday = state.date === today ? toNumber(state.callsUsed) : 0;
  const budgetRemaining = Math.max(0, maxCalls - usedToday);

  if (budgetRemaining <= 0) {
    console.log(
      JSON.stringify(
        {
          event: "related-backfill-skip",
          reason: "daily-budget-exhausted",
          statePath,
          date: today,
          callsUsed: usedToday,
          maxCalls,
        },
        null,
        2,
      ),
    );
    return;
  }

  const candidates = await getCandidateVideos(Math.min(candidateLimit, budgetRemaining));
  if (!candidates.length) {
    console.log(
      JSON.stringify(
        {
          event: "related-backfill-skip",
          reason: "no-candidates",
          minRelated,
          includeNonPlayable,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (dryRun) {
    console.log(
      JSON.stringify(
        {
          event: "related-backfill-dry-run",
          date: today,
          minRelated,
          includeNonPlayable,
          maxCalls,
          usedToday,
          budgetRemaining,
          candidatesConsidered: candidates.length,
          sample: toSerializable(candidates.slice(0, 20)),
        },
        null,
        2,
      ),
    );
    return;
  }

  let callsUsed = 0;
  let sourcesProcessed = 0;
  let sourcesFailed = 0;
  let linksInserted = 0;
  let quotaExhausted = false;

  for (const candidate of candidates) {
    if (callsUsed >= budgetRemaining) {
      break;
    }

    const sourceVideoId = normalizeVideoId(candidate.videoId);
    if (!sourceVideoId) {
      continue;
    }

    try {
      const relatedIds = await fetchRelatedFromYouTube(sourceVideoId);
      callsUsed += 1;

      if (relatedIds.length === 0) {
        sourcesProcessed += 1;
        continue;
      }

      const existingRows = await prisma.relatedCache.findMany({
        where: {
          videoId: sourceVideoId,
        },
        select: {
          related: true,
        },
      });

      const existingSet = new Set(
        existingRows
          .map((row) => normalizeVideoId(row.related))
          .filter(Boolean),
      );

      const now = new Date();
      const createRows = relatedIds
        .filter((relatedId) => !existingSet.has(relatedId))
        .map((relatedId) => ({
          videoId: sourceVideoId,
          related: relatedId,
          createdAt: now,
          updatedAt: now,
        }));

      if (createRows.length > 0) {
        await prisma.relatedCache.createMany({
          data: createRows,
        });
        linksInserted += createRows.length;
      }

      sourcesProcessed += 1;
    } catch (error) {
      callsUsed += 1;
      sourcesFailed += 1;
      if (error && typeof error === "object" && error.quotaExceeded) {
        quotaExhausted = true;
      }
      console.warn(
        JSON.stringify(
          {
            event: "related-backfill-source-failed",
            videoId: sourceVideoId,
            message: error instanceof Error ? error.message : String(error),
          },
          null,
          2,
        ),
      );

      if (quotaExhausted) {
        break;
      }
    }
  }

  const nextCallsUsed = usedToday + callsUsed;
  writeState(statePath, {
    date: today,
    callsUsed: nextCallsUsed,
    maxCalls,
    minRelated,
    updatedAt: new Date().toISOString(),
  });

  console.log(
    JSON.stringify(
      {
        event: "related-backfill-complete",
        date: today,
        minRelated,
        dryRun,
        includeNonPlayable,
        statePath,
        candidatesConsidered: candidates.length,
        budgetRemaining,
        callsUsedThisRun: callsUsed,
        callsUsedToday: nextCallsUsed,
        maxCalls,
        sourcesProcessed,
        sourcesFailed,
        linksInserted,
        quotaExhausted,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
