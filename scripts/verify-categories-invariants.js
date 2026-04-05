#!/usr/bin/env node
"use strict";

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

function readArg(name, fallback) {
  const raw = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  if (!raw) {
    return fallback;
  }

  const value = raw.slice(name.length + 3);
  if (!value) {
    return fallback;
  }

  return value;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function asNumber(value, fallback) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function assertInvariant(condition, description, details, failures) {
  if (condition) {
    console.log(`[ok] ${description}`);
    return;
  }

  failures.push({ description, details });
  console.error(`[fail] ${description}`);
  if (details) {
    console.error(`       ${details}`);
  }
}

async function runApiChecks({ baseUrl, maxApiDurationMs, minCoverage }, failures) {
  const url = `${baseUrl.replace(/\/$/, "")}/api/categories`;
  const startedAt = Date.now();

  let response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: {
        "Cache-Control": "no-cache",
      },
    });
  } catch (error) {
    failures.push({
      description: "API /api/categories reachable",
      details: `request failed: ${error instanceof Error ? error.message : String(error)}`,
    });
    console.error("[fail] API /api/categories reachable");
    return;
  }

  const networkDurationMs = Date.now() - startedAt;
  assertInvariant(response.ok, "API /api/categories returns 2xx", `status=${response.status}`, failures);

  let payload;
  try {
    payload = await response.json();
  } catch (error) {
    failures.push({
      description: "API /api/categories returns valid JSON",
      details: error instanceof Error ? error.message : String(error),
    });
    console.error("[fail] API /api/categories returns valid JSON");
    return;
  }

  const categories = Array.isArray(payload?.categories) ? payload.categories : [];
  const count = Number(payload?.meta?.count ?? 0);
  const durationMs = Number(payload?.meta?.durationMs ?? NaN);
  const withThumb = categories.filter(
    (entry) => typeof entry?.previewVideoId === "string" && /^[A-Za-z0-9_-]{11}$/.test(entry.previewVideoId),
  ).length;

  assertInvariant(categories.length === count, "API meta count matches payload size", `meta.count=${count} categories=${categories.length}`, failures);
  assertInvariant(
    Number.isFinite(durationMs) && durationMs <= maxApiDurationMs,
    "API reports fast compute duration",
    `durationMs=${durationMs} max=${maxApiDurationMs}`,
    failures,
  );
  assertInvariant(networkDurationMs <= Math.max(maxApiDurationMs * 4, 1200), "API network response is responsive", `networkMs=${networkDurationMs}`, failures);

  const coverage = categories.length > 0 ? withThumb / categories.length : 0;
  assertInvariant(
    coverage >= minCoverage,
    "API thumbnail coverage meets threshold",
    `coverage=${(coverage * 100).toFixed(2)}% threshold=${(minCoverage * 100).toFixed(2)}%`,
    failures,
  );
}

async function main() {
  if (hasFlag("help")) {
    console.log([
      "Usage: node scripts/verify-categories-invariants.js [options]",
      "",
      "Options:",
      "  --check-api                 Also verify live /api/categories endpoint",
      "  --base-url=http://localhost:3000",
      "  --min-coverage=0.95         Minimum required thumbnail coverage",
      "  --max-api-duration-ms=350   Max API-reported compute duration",
      "  --help",
    ].join("\n"));
    process.exit(0);
  }

  loadDatabaseEnv();

  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set. Add it to apps/web/.env.local or your shell.");
    process.exit(1);
  }

  const checkApi = hasFlag("check-api");
  const baseUrl = readArg("base-url", "http://localhost:3000");
  const minCoverage = asNumber(readArg("min-coverage", "0.95"), 0.95);
  const maxApiDurationMs = asNumber(readArg("max-api-duration-ms", "350"), 350);

  const prisma = new PrismaClient({ log: ["warn", "error"] });
  const failures = [];

  try {
    const [
      genreCountRows,
      cardCountRows,
      duplicateRows,
      invalidVideoIdRows,
      unavailableThumbRows,
      withThumbRows,
    ] = await Promise.all([
      prisma.$queryRaw`SELECT COUNT(*) AS count FROM genres WHERE name IS NOT NULL AND TRIM(name) <> ''`,
      prisma.$queryRaw`SELECT COUNT(*) AS count FROM genre_cards`,
      prisma.$queryRaw`
        SELECT genre, COUNT(*) AS c
        FROM genre_cards
        GROUP BY genre
        HAVING COUNT(*) > 1
      `,
      prisma.$queryRaw`
        SELECT genre, thumbnail_video_id AS thumbnailVideoId
        FROM genre_cards
        WHERE thumbnail_video_id IS NOT NULL
          AND thumbnail_video_id NOT REGEXP '^[A-Za-z0-9_-]{11}$'
        LIMIT 20
      `,
      prisma.$queryRaw`
        SELECT gc.genre, gc.thumbnail_video_id AS thumbnailVideoId
        FROM genre_cards gc
        LEFT JOIN videos v
          ON CONVERT(v.videoId USING utf8mb4) = CONVERT(gc.thumbnail_video_id USING utf8mb4)
        LEFT JOIN site_videos sv
          ON sv.video_id = v.id
        WHERE gc.thumbnail_video_id IS NOT NULL
          AND gc.thumbnail_video_id <> ''
          AND (v.id IS NULL OR sv.status <> 'available')
        LIMIT 20
      `,
      prisma.$queryRaw`
        SELECT COUNT(*) AS count
        FROM genre_cards
        WHERE thumbnail_video_id IS NOT NULL
          AND thumbnail_video_id <> ''
      `,
    ]);

    const genreCount = Number(genreCountRows[0]?.count ?? 0);
    const cardCount = Number(cardCountRows[0]?.count ?? 0);
    const withThumb = Number(withThumbRows[0]?.count ?? 0);
    const coverage = cardCount > 0 ? withThumb / cardCount : 0;

    console.log("Categories invariant audit\n");
    console.log(`genres=${genreCount} genre_cards=${cardCount} with_thumb=${withThumb} coverage=${(coverage * 100).toFixed(2)}%\n`);

    assertInvariant(cardCount === genreCount, "genre_cards row count matches canonical genres", `genres=${genreCount} cards=${cardCount}`, failures);
    assertInvariant(duplicateRows.length === 0, "No duplicate genres in genre_cards", duplicateRows.length ? `examples=${JSON.stringify(duplicateRows.slice(0, 3))}` : "", failures);
    assertInvariant(invalidVideoIdRows.length === 0, "All thumbnail_video_id values use valid YouTube ID format", invalidVideoIdRows.length ? `examples=${JSON.stringify(invalidVideoIdRows.slice(0, 3))}` : "", failures);
    assertInvariant(unavailableThumbRows.length === 0, "All stored thumbnail videos resolve to available site_videos", unavailableThumbRows.length ? `examples=${JSON.stringify(unavailableThumbRows.slice(0, 3))}` : "", failures);
    assertInvariant(
      coverage >= minCoverage,
      "Thumbnail coverage meets threshold",
      `coverage=${(coverage * 100).toFixed(2)}% threshold=${(minCoverage * 100).toFixed(2)}%`,
      failures,
    );

    if (checkApi) {
      console.log("\nRunning live API checks\n");
      await runApiChecks({ baseUrl, maxApiDurationMs, minCoverage }, failures);
    }

    if (failures.length > 0) {
      console.error(`\nInvariant check failed: ${failures.length} issue(s).`);
      process.exit(1);
    }

    console.log("\nAll category invariants passed.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("Fatal error in category invariant checker:", error);
  process.exit(1);
});
