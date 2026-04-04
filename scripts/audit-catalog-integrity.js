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

const sampleLimit = Math.max(1, Number(parseArg("sample", "25")));
const minRelated = Math.max(1, Number(parseArg("min-related", "4")));
const outPathArg = parseArg("out", "").trim();
const outPath = outPathArg || path.resolve(process.cwd(), `logs/catalog-audit-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);

const prisma = new PrismaClient();

async function main() {
  const playableFilter = `
    v.videoId REGEXP '^[A-Za-z0-9_-]{11}$'
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
  `;

  const [
    totalVideos,
    validVideoIds,
    playableVideos,
    videosMissingStatus,
    videosWithConflictingStatuses,
    artistStatsMismatches,
    artistStatsMissingRows,
    artistStatsStaleRows,
    relatedOrphanSource,
    relatedOrphanTarget,
    relatedSelfLinks,
    relatedDuplicatePairs,
    playableVideosWithLowRelated,
  ] = await Promise.all([
    prisma.$queryRawUnsafe("SELECT COUNT(*) AS total FROM videos"),
    prisma.$queryRawUnsafe("SELECT COUNT(*) AS total FROM videos WHERE videoId REGEXP '^[A-Za-z0-9_-]{11}$'"),
    prisma.$queryRawUnsafe(
      `
        SELECT COUNT(DISTINCT v.videoId) AS total
        FROM videos v
        WHERE ${playableFilter}
      `,
    ),
    prisma.$queryRawUnsafe(
      `
        SELECT
          v.id,
          v.videoId,
          v.title
        FROM videos v
        WHERE v.videoId REGEXP '^[A-Za-z0-9_-]{11}$'
          AND NOT EXISTS (
            SELECT 1
            FROM site_videos sv
            WHERE sv.video_id = v.id
          )
        ORDER BY v.id ASC
        LIMIT ${sampleLimit}
      `,
    ),
    prisma.$queryRawUnsafe(
      `
        SELECT
          v.id,
          v.videoId,
          v.title,
          GROUP_CONCAT(DISTINCT sv.status ORDER BY sv.status SEPARATOR ',') AS statuses
        FROM videos v
        INNER JOIN site_videos sv ON sv.video_id = v.id
        WHERE v.videoId REGEXP '^[A-Za-z0-9_-]{11}$'
        GROUP BY v.id, v.videoId, v.title
        HAVING SUM(CASE WHEN sv.status = 'available' THEN 1 ELSE 0 END) > 0
           AND SUM(CASE WHEN sv.status IS NULL OR sv.status <> 'available' THEN 1 ELSE 0 END) > 0
        ORDER BY v.id ASC
        LIMIT ${sampleLimit}
      `,
    ),
    prisma.$queryRawUnsafe(
      `
        SELECT
          s.display_name AS displayName,
          s.video_count AS projectedCount,
          COALESCE(a.videoCount, 0) AS actualCount,
          s.source AS source
        FROM artist_stats s
        LEFT JOIN (
          SELECT
            LOWER(TRIM(v.parsedArtist)) AS normalizedArtist,
            COUNT(DISTINCT v.videoId) AS videoCount
          FROM videos v
          WHERE v.parsedArtist IS NOT NULL
            AND TRIM(v.parsedArtist) <> ''
            AND ${playableFilter}
          GROUP BY LOWER(TRIM(v.parsedArtist))
        ) a ON a.normalizedArtist = s.normalized_artist
        WHERE COALESCE(s.video_count, 0) <> COALESCE(a.videoCount, 0)
        ORDER BY ABS(COALESCE(s.video_count, 0) - COALESCE(a.videoCount, 0)) DESC, s.display_name ASC
        LIMIT ${sampleLimit}
      `,
    ),
    prisma.$queryRawUnsafe(
      `
        SELECT
          a.normalizedArtist,
          a.videoCount
        FROM (
          SELECT
            LOWER(TRIM(v.parsedArtist)) AS normalizedArtist,
            COUNT(DISTINCT v.videoId) AS videoCount
          FROM videos v
          WHERE v.parsedArtist IS NOT NULL
            AND TRIM(v.parsedArtist) <> ''
            AND ${playableFilter}
          GROUP BY LOWER(TRIM(v.parsedArtist))
        ) a
        LEFT JOIN artist_stats s ON s.normalized_artist = a.normalizedArtist
        WHERE s.id IS NULL
        ORDER BY a.videoCount DESC, a.normalizedArtist ASC
        LIMIT ${sampleLimit}
      `,
    ),
    prisma.$queryRawUnsafe(
      `
        SELECT
          s.display_name AS displayName,
          s.video_count AS projectedCount,
          s.source AS source
        FROM artist_stats s
        LEFT JOIN (
          SELECT
            LOWER(TRIM(v.parsedArtist)) AS normalizedArtist,
            COUNT(DISTINCT v.videoId) AS videoCount
          FROM videos v
          WHERE v.parsedArtist IS NOT NULL
            AND TRIM(v.parsedArtist) <> ''
            AND ${playableFilter}
          GROUP BY LOWER(TRIM(v.parsedArtist))
        ) a ON a.normalizedArtist = s.normalized_artist
        WHERE COALESCE(a.videoCount, 0) = 0
          AND s.video_count > 0
        ORDER BY s.video_count DESC, s.display_name ASC
        LIMIT ${sampleLimit}
      `,
    ),
    prisma.$queryRawUnsafe(
      `
        SELECT r.videoId, COUNT(*) AS linkCount
        FROM related r
        LEFT JOIN videos v ON v.videoId = r.videoId
        WHERE r.videoId IS NOT NULL
          AND TRIM(r.videoId) <> ''
          AND v.id IS NULL
        GROUP BY r.videoId
        ORDER BY linkCount DESC, r.videoId ASC
        LIMIT ${sampleLimit}
      `,
    ),
    prisma.$queryRawUnsafe(
      `
        SELECT r.related, COUNT(*) AS linkCount
        FROM related r
        LEFT JOIN videos v ON v.videoId = r.related
        WHERE r.related IS NOT NULL
          AND TRIM(r.related) <> ''
          AND v.id IS NULL
        GROUP BY r.related
        ORDER BY linkCount DESC, r.related ASC
        LIMIT ${sampleLimit}
      `,
    ),
    prisma.$queryRawUnsafe(
      `
        SELECT videoId, COUNT(*) AS linkCount
        FROM related
        WHERE videoId = related
        GROUP BY videoId
        ORDER BY linkCount DESC, videoId ASC
        LIMIT ${sampleLimit}
      `,
    ),
    prisma.$queryRawUnsafe(
      `
        SELECT videoId, related, COUNT(*) AS duplicateCount
        FROM related
        GROUP BY videoId, related
        HAVING COUNT(*) > 1
        ORDER BY duplicateCount DESC, videoId ASC
        LIMIT ${sampleLimit}
      `,
    ),
    prisma.$queryRawUnsafe(
      `
        SELECT
          p.videoId,
          p.videoDbId,
          p.title,
          COALESCE(rc.relatedCount, 0) AS relatedCount
        FROM (
          SELECT DISTINCT
            v.videoId,
            v.id AS videoDbId,
            v.title
          FROM videos v
          WHERE ${playableFilter}
        ) p
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
        ) rc ON rc.videoId = p.videoId
        WHERE COALESCE(rc.relatedCount, 0) < ?
        ORDER BY relatedCount ASC, p.videoDbId ASC
        LIMIT ${sampleLimit}
      `,
      minRelated,
    ),
  ]);

  const report = {
    generatedAt: new Date().toISOString(),
    thresholds: {
      sampleLimit,
      minRelated,
    },
    totals: {
      videos: toNumber(totalVideos[0]?.total),
      validVideoIds: toNumber(validVideoIds[0]?.total),
      playableDistinctVideoIds: toNumber(playableVideos[0]?.total),
    },
    findings: {
      videosMissingSiteStatusSample: toSerializable(videosMissingStatus),
      videosWithConflictingStatusesSample: toSerializable(videosWithConflictingStatuses),
      artistStatsMismatchesSample: toSerializable(artistStatsMismatches),
      artistStatsMissingRowsSample: toSerializable(artistStatsMissingRows),
      artistStatsStaleRowsSample: toSerializable(artistStatsStaleRows),
      relatedOrphanSourceSample: toSerializable(relatedOrphanSource),
      relatedOrphanTargetSample: toSerializable(relatedOrphanTarget),
      relatedSelfLinksSample: toSerializable(relatedSelfLinks),
      relatedDuplicatePairsSample: toSerializable(relatedDuplicatePairs),
      playableVideosWithLowRelatedSample: toSerializable(playableVideosWithLowRelated),
    },
    remediation: {
      artistProjectionRebuild: "npm run rebuild:artist-stats",
      embedabilityAudit: "npm run audit:embedability:all",
      unavailablePrune: "npm run prune:unavailable:all",
      relatedBackfill: `npm run backfill:related -- --max-calls=5000 --min-related=${minRelated}`,
    },
  };

  const outDir = path.dirname(outPath);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  const summary = {
    outPath,
    totals: report.totals,
    samples: {
      videosMissingSiteStatus: report.findings.videosMissingSiteStatusSample.length,
      conflictingStatuses: report.findings.videosWithConflictingStatusesSample.length,
      artistStatsMismatches: report.findings.artistStatsMismatchesSample.length,
      artistStatsMissingRows: report.findings.artistStatsMissingRowsSample.length,
      artistStatsStaleRows: report.findings.artistStatsStaleRowsSample.length,
      relatedOrphanSource: report.findings.relatedOrphanSourceSample.length,
      relatedOrphanTarget: report.findings.relatedOrphanTargetSample.length,
      relatedSelfLinks: report.findings.relatedSelfLinksSample.length,
      relatedDuplicatePairs: report.findings.relatedDuplicatePairsSample.length,
      playableVideosWithLowRelated: report.findings.playableVideosWithLowRelatedSample.length,
    },
  };

  console.log(JSON.stringify(summary, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
