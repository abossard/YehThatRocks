#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { Prisma, PrismaClient } = require("@prisma/client");

if (!process.env.DATABASE_URL) {
  const envPath = path.resolve(process.cwd(), "apps/web/.env.local");
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
    const databaseUrlLine = lines.find((line) => line.startsWith("DATABASE_URL="));
    if (databaseUrlLine) {
      process.env.DATABASE_URL = databaseUrlLine.replace(/^DATABASE_URL="?/, "").replace(/"?$/, "");
    }
  }
}

const prisma = new PrismaClient();

function parseArg(name, fallback) {
  const raw = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  if (!raw) {
    return fallback;
  }
  return raw.slice(name.length + 3);
}

const limit = Number(parseArg("limit", "200"));
const offset = Number(parseArg("offset", "0"));
const includeAll = process.argv.includes("--all");
const concurrency = Number(parseArg("concurrency", "8"));
const exhaustive = process.argv.includes("--exhaustive");
const retries = Number(parseArg("retries", "2"));
const dbChunkMultiplier = Number(parseArg("dbChunkMultiplier", "3"));
const checkpointFile = parseArg("checkpointFile", "").trim();
const resume = process.argv.includes("--resume");
const writeRetries = Number(parseArg("writeRetries", "6"));

const AGE_RESTRICTED_PATTERNS = [
  /Sign in to confirm your age/i,
  /age[-\s]?restricted/i,
  /playerAgeGateRenderer/i,
  /desktopLegacyAgeGateReason/i,
  /"isFamilySafe"\s*:\s*false/i,
  /"status"\s*:\s*"AGE_CHECK_REQUIRED"/i,
  /"status"\s*:\s*"LOGIN_REQUIRED"[\s\S]{0,240}"reason"\s*:\s*"[^"]*age/i,
];

function containsAgeRestrictionMarker(html) {
  return AGE_RESTRICTED_PATTERNS.some((pattern) => pattern.test(html));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isWriteConflictError(error) {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error.code === "P2034" || error.code === "P2028"),
  );
}

async function withWriteRetry(work, contextLabel) {
  let attempt = 0;

  while (true) {
    try {
      return await work();
    } catch (error) {
      if (!isWriteConflictError(error) || attempt >= writeRetries) {
        throw error;
      }

      const backoffMs = 40 * 2 ** attempt + Math.floor(Math.random() * 60);
      console.warn(
        JSON.stringify(
          {
            event: "write-retry",
            context: contextLabel,
            attempt: attempt + 1,
            backoffMs,
            code: error.code,
          },
          null,
          2,
        ),
      );
      await sleep(backoffMs);
      attempt += 1;
    }
  }
}

function formatSeconds(totalSeconds) {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function readCheckpoint(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function writeCheckpoint(filePath, payload) {
  if (!filePath) {
    return;
  }

  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function fetchDuplicateMap(videoIds) {
  if (videoIds.length === 0) {
    return new Map();
  }

  const duplicates = await prisma.video.findMany({
    where: { videoId: { in: videoIds } },
    select: { id: true, videoId: true, title: true },
  });

  const duplicateMap = new Map();

  for (const row of duplicates) {
    if (!duplicateMap.has(row.videoId)) {
      duplicateMap.set(row.videoId, []);
    }
    duplicateMap.get(row.videoId).push(row);
  }

  return duplicateMap;
}

async function fetchExistingSiteVideoIds(duplicateMap) {
  const allIds = [];

  for (const dupRows of duplicateMap.values()) {
    for (const dup of dupRows) {
      allIds.push(dup.id);
    }
  }

  if (allIds.length === 0) {
    return new Set();
  }

  const rows = await prisma.siteVideo.findMany({
    where: { videoId: { in: allIds } },
    select: { videoId: true },
  });

  return new Set(rows.map((row) => row.videoId));
}

async function fetchVideoBatch(cursor, batchLimit, scanAll, seenVideoIds) {
  const uniqueVideos = [];
  let localCursor = cursor;
  let scannedRows = 0;
  let reachedEnd = false;
  const dbChunkSize = Math.max(batchLimit, batchLimit * Math.max(1, dbChunkMultiplier));

  while (uniqueVideos.length < batchLimit) {
    const whereClause = scanAll
      ? Prisma.sql`WHERE v.id > ${localCursor}`
      : Prisma.sql`WHERE v.id > ${localCursor} AND v.favourited = 1`;

    const rows = await prisma.$queryRaw`
      SELECT
        v.id,
        v.videoId,
        v.title,
        v.favourited,
        v.views
      FROM videos v
      ${whereClause}
      ORDER BY v.id ASC
      LIMIT ${dbChunkSize}
    `;

    if (rows.length === 0) {
      reachedEnd = true;
      break;
    }

    scannedRows += rows.length;
    localCursor = rows[rows.length - 1].id;

    for (const row of rows) {
      if (!row.videoId || seenVideoIds.has(row.videoId)) {
        continue;
      }

      seenVideoIds.add(row.videoId);
      uniqueVideos.push(row);

      if (uniqueVideos.length >= batchLimit) {
        break;
      }
    }
  }

  return {
    videos: uniqueVideos,
    nextCursor: localCursor,
    scannedRows,
    reachedEnd,
  };
}

async function checkVideo(videoId) {
  const url = `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}&format=json`;
  let attempt = 0;

  while (attempt <= retries) {
    try {
      const response = await fetch(url, {
        method: "GET",
        headers: {
          "User-Agent": "YehThatRocksEmbedAudit/1.0",
        },
      });

      if (response.ok) {
        const embedProbe = await checkEmbedPlayability(videoId);
        if (embedProbe.status === "unavailable") {
          return { status: "unavailable", reason: `oembed:${response.status}+${embedProbe.reason}` };
        }
        if (embedProbe.status === "available") {
          return { status: "available", reason: `oembed:${response.status}+${embedProbe.reason}` };
        }
        return { status: "check-failed", reason: `oembed:${response.status}+embed:indeterminate` };
      }

      if ([401, 403, 404, 410].includes(response.status)) {
        return { status: "unavailable", reason: `oembed:${response.status}` };
      }

      if (response.status >= 500 || response.status === 429) {
        if (attempt < retries) {
          await sleep(250 * (attempt + 1));
          attempt += 1;
          continue;
        }

        return { status: "check-failed", reason: `oembed:${response.status}` };
      }

      return { status: "check-failed", reason: `oembed:${response.status}` };
    } catch (error) {
      if (attempt < retries) {
        await sleep(250 * (attempt + 1));
        attempt += 1;
        continue;
      }

      return { status: "check-failed", reason: `network:${error instanceof Error ? error.message : "unknown"}` };
    }
  }

  return { status: "check-failed", reason: "unknown" };
}

async function checkEmbedPlayability(videoId) {
  const url = `https://www.youtube.com/embed/${encodeURIComponent(videoId)}?enablejsapi=1`;

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent": "YehThatRocksEmbedAudit/1.0",
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

    if (/"playabilityStatus"\s*:\s*\{\s*"status"\s*:\s*"(ERROR|UNPLAYABLE|LOGIN_REQUIRED|CONTENT_CHECK_REQUIRED|AGE_CHECK_REQUIRED)"/i.test(html)) {
      return { status: "unavailable", reason: "embed:playability-unavailable" };
    }

    if (/"playabilityStatus"\s*:\s*\{\s*"status"\s*:\s*"OK"/i.test(html)) {
      return { status: "available", reason: "embed:playability-ok" };
    }

    if (/video unavailable/i.test(html)) {
      return { status: "unavailable", reason: "embed:video-unavailable" };
    }

    // If we got a 200 response and no unavailability markers, assume it's available
    // (YouTube would have blocked us with 403 or error markers if it wasn't)
    return { status: "available", reason: "embed:accessible-no-markers" };
  } catch (error) {
    return { status: "check-failed", reason: `embed-network:${error instanceof Error ? error.message : "unknown"}` };
  }
}

async function markStatus(video, status, reason, duplicateMap, existingSiteVideoIds) {
  const duplicates = duplicateMap.get(video.videoId) ?? [];

  if (duplicates.length === 0) {
    return;
  }

  const ids = duplicates.map((item) => item.id);
  const canonicalTitle = duplicates[0]?.title ?? video.title ?? "Unknown";

  const updated = await withWriteRetry(
    () =>
      prisma.siteVideo.updateMany({
        where: { videoId: { in: ids } },
        data: {
          status,
          title: `${canonicalTitle} [${reason}]`,
        },
      }),
    "siteVideo.updateMany",
  );

  if (updated.count < ids.length) {
    const missingIds = ids.filter((id) => !existingSiteVideoIds.has(id));

    if (missingIds.length > 0) {
      await withWriteRetry(
        () =>
          prisma.siteVideo.createMany({
            data: missingIds.map((id) => ({
              videoId: id,
              title: `${canonicalTitle} [${reason}]`,
              status,
              createdAt: new Date(),
            })),
            skipDuplicates: true,
          }),
        "siteVideo.createMany",
      );

      for (const id of missingIds) {
        existingSiteVideoIds.add(id);
      }
    }
  }
}

async function runPool(items, worker, parallelism) {
  const queue = [...items];
  const runners = Array.from({ length: Math.max(1, parallelism) }, async () => {
    while (queue.length > 0) {
      const item = queue.shift();
      if (!item) {
        break;
      }
      await worker(item);
    }
  });

  await Promise.all(runners);
}

async function main() {
  const startTime = Date.now();
  const checkpoint = resume ? readCheckpoint(checkpointFile) : null;

  let currentCursor = checkpoint?.cursor ?? offset;
  let batches = checkpoint?.batches ?? 0;
  let checked = checkpoint?.checked ?? 0;
  let scannedRowsTotal = checkpoint?.scannedRowsTotal ?? 0;
  let available = checkpoint?.available ?? 0;
  let unavailable = checkpoint?.unavailable ?? 0;
  let checkFailed = checkpoint?.checkFailed ?? 0;
  const seenVideoIds = new Set();

  if (checkpoint) {
    console.log(
      JSON.stringify(
        {
          event: "checkpoint-loaded",
          checkpointFile,
          cursor: currentCursor,
          batches,
          checked,
          scannedRowsTotal,
          available,
          unavailable,
          checkFailed,
        },
        null,
        2,
      ),
    );
  }

  const totalDistinct = includeAll
    ? await prisma.$queryRaw`SELECT COUNT(DISTINCT v.videoId) AS totalDistinct FROM videos v`
    : await prisma.$queryRaw`SELECT COUNT(DISTINCT v.videoId) AS totalDistinct FROM videos v WHERE v.favourited = 1`;
  const totalTarget = Number(totalDistinct[0]?.totalDistinct ?? 0);

  while (true) {
    const { videos, nextCursor, scannedRows, reachedEnd } = await fetchVideoBatch(
      currentCursor,
      limit,
      includeAll,
      seenVideoIds,
    );

    if (videos.length === 0) {
      break;
    }

    batches += 1;
    checked += videos.length;
    scannedRowsTotal += scannedRows;

    const duplicateMap = await fetchDuplicateMap(videos.map((video) => video.videoId));
    const existingSiteVideoIds = await fetchExistingSiteVideoIds(duplicateMap);

    const elapsedSeconds = Math.max(1, Math.floor((Date.now() - startTime) / 1000));
    const rate = checked / elapsedSeconds;
    const remaining = Math.max(0, totalTarget - checked);
    const etaSeconds = rate > 0 ? Math.ceil(remaining / rate) : 0;

    console.log(
      JSON.stringify(
        {
          event: "batch-start",
          batch: batches,
          cursor: currentCursor,
          nextCursor,
          size: videos.length,
          scannedRows,
          scannedRowsTotal,
          checked,
          totalTarget,
          progressPct: totalTarget > 0 ? Number(((checked / totalTarget) * 100).toFixed(2)) : null,
          ratePerSecond: Number(rate.toFixed(3)),
          eta: formatSeconds(etaSeconds),
          includeAll,
        },
        null,
        2,
      ),
    );

    await runPool(
      videos,
      async (video) => {
        const result = await checkVideo(video.videoId);
        if (result.status === "available") {
          available += 1;
          await markStatus(video, "available", result.reason, duplicateMap, existingSiteVideoIds);
        } else if (result.status === "unavailable") {
          unavailable += 1;
          await markStatus(video, "unavailable", result.reason, duplicateMap, existingSiteVideoIds);
        } else {
          checkFailed += 1;
          await markStatus(video, "check-failed", result.reason, duplicateMap, existingSiteVideoIds);
        }
      },
      concurrency,
    );

    writeCheckpoint(checkpointFile, {
      cursor: nextCursor,
      batches,
      checked,
      scannedRowsTotal,
      available,
      unavailable,
      checkFailed,
      updatedAt: new Date().toISOString(),
    });

    console.log(
      JSON.stringify(
        {
          event: "batch-complete",
          batch: batches,
          checked,
          scannedRowsTotal,
          available,
          unavailable,
          checkFailed,
          totalTarget,
          progressPct: totalTarget > 0 ? Number(((checked / totalTarget) * 100).toFixed(2)) : null,
          nextCursor,
          checkpointFile: checkpointFile || null,
        },
        null,
        2,
      ),
    );

    currentCursor = nextCursor;

    if (!exhaustive || reachedEnd) {
      break;
    }
  }

  console.log(
    JSON.stringify(
      {
        checked,
        available,
        unavailable,
        checkFailed,
        offset,
        finalCursor: currentCursor,
        limit,
        includeAll,
        concurrency,
        retries,
        writeRetries,
        dbChunkMultiplier,
        checkpointFile: checkpointFile || null,
        resumedFromCheckpoint: Boolean(checkpoint),
        exhaustive,
        batches,
        scannedRowsTotal,
        totalTarget,
        progressPct: totalTarget > 0 ? Number(((checked / totalTarget) * 100).toFixed(2)) : null,
        uniqueVideoIdsSeen: seenVideoIds.size,
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
