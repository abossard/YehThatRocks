#!/usr/bin/env node
/**
 * build-genre-cards.js
 *
 * Populates the `genre_cards` table with a canonical genre name and a
 * representative YouTube thumbnail_video_id for each genre.
 *
 * All video IDs are verified against site_videos.status='available'.
 * Matching runs at batch time using a priority cascade:
 *   1. Exact:    artist_stats.genre == canonical genre name
 *   2. Prefix:   artist_stats.genre starts with canonical genre name
 *   3. Contains: artist_stats.genre contains canonical genre name
 *   4. Reverse:  canonical genre name starts with artist_stats.genre word
 *   5. artists table genre1–6 exact match → available video via videos table
 *   6. artists table genre1–6 contains match (broader fallback)
 *
 * Run: node scripts/build-genre-cards.js
 * Options:
 *   --dry-run    Print results without writing to the DB
 *   --help       Show this message
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { PrismaClient } = require("@prisma/client");

// ---------------------------------------------------------------------------
// Env bootstrap
// ---------------------------------------------------------------------------

function loadDatabaseEnv() {
  const envPath = path.resolve(process.cwd(), "apps/web/.env.local");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const m = trimmed.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    const [, key, raw] = m;
    if (!process.env[key]) process.env[key] = raw.replace(/^"/, "").replace(/"$/, "");
  }
}

loadDatabaseEnv();

if (process.argv.includes("--help")) {
  console.log(
    [
      "Usage: node scripts/build-genre-cards.js [options]",
      "",
      "Options:",
      "  --dry-run    Print results without writing to DB",
      "  --help       Show this message",
    ].join("\n"),
  );
  process.exit(0);
}

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set. Add it to apps/web/.env.local or the current shell.");
  process.exit(1);
}

const isDryRun = process.argv.includes("--dry-run");
const YOUTUBE_ID_RE = /^[A-Za-z0-9_-]{11}$/;
const GENRE_TOKEN_STOP_WORDS = new Set([
  "and",
  "the",
  "with",
  "from",
  "for",
  "of",
  "to",
  "in",
  "on",
  "a",
  "an",
  "music",
]);

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function tokenizeGenre(genre) {
  return normalizeText(genre)
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3 && !GENRE_TOKEN_STOP_WORDS.has(token));
}

function scoreVideoForGenre(genre, title, description) {
  const genreText = normalizeText(genre);
  const titleText = normalizeText(title);
  const descriptionText = normalizeText(description);
  const tokens = tokenizeGenre(genreText);

  let score = 0;

  if (!genreText) {
    return score;
  }

  if (titleText.includes(genreText)) {
    score += 120;
  }
  if (titleText.startsWith(genreText + " ")) {
    score += 20;
  }
  if (descriptionText.includes(genreText)) {
    score += 55;
  }

  for (const token of tokens) {
    if (titleText.includes(token)) {
      score += 18;
    }
    if (descriptionText.includes(token)) {
      score += 7;
    }
  }

  return score;
}

const prisma = new PrismaClient({ log: ["warn", "error"] });

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("Building genre_cards table...\n");

  // 1. Load all canonical genres
  const genreRows = await prisma.$queryRaw`
    SELECT name FROM genres
    WHERE name IS NOT NULL AND TRIM(name) <> ''
    ORDER BY name ASC
  `;
  const genres = genreRows.map((r) => r.name.trim());
  console.log(`Found ${genres.length} canonical genres.`);

  // 2. Load artist_stats entries that have an AVAILABLE video thumbnail.
  //    We join to videos + site_videos so we never store a stale/unavailable ID.
  const statsRows = await prisma.$queryRaw`
    SELECT ast.genre, v.videoId AS thumbnail_video_id, ast.video_count
    FROM artist_stats ast
    JOIN videos v
      ON v.videoId = ast.thumbnail_video_id
      AND v.videoId REGEXP '^[A-Za-z0-9_-]{11}$'
    JOIN site_videos sv
      ON sv.video_id = v.id AND sv.status = 'available'
    WHERE ast.genre IS NOT NULL AND TRIM(ast.genre) <> ''
    ORDER BY ast.video_count DESC, ast.updated_at DESC, ast.id DESC
  `;

  // Best available video per artist_stats genre (highest video_count first)
  const statsBestByGenre = new Map(); // lowercased genre → { vid, originalGenre }
  for (const row of statsRows) {
    const g = row.genre.trim();
    const vid = row.thumbnail_video_id?.trim();
    if (!g || !vid || !YOUTUBE_ID_RE.test(vid)) continue;
    const key = g.toLowerCase();
    if (!statsBestByGenre.has(key)) statsBestByGenre.set(key, { vid, originalGenre: g });
  }
  console.log(`Loaded ${statsBestByGenre.size} artist_stats genres with available thumbnails.`);

  // 3. Resolve each canonical genre through the priority cascade
  const results = new Map(); // canonicalGenre -> videoId | null

  for (const genre of genres) {
    const gLow = genre.toLowerCase();

    // Strategy 1: exact match
    if (statsBestByGenre.has(gLow)) {
      results.set(genre, statsBestByGenre.get(gLow).vid);
      continue;
    }

    // Strategy 2: artist_stats genre starts with canonical name
    //   e.g. "Black" → "Black Metal", "Black Metal (early)"
    let found = null;
    for (const [sKey, { vid }] of statsBestByGenre) {
      if (sKey.startsWith(gLow + " ") || sKey.startsWith(gLow + "(") || sKey === gLow) {
        found = vid;
        break;
      }
    }
    if (found) { results.set(genre, found); continue; }

    // Strategy 3: artist_stats genre contains canonical name as a word
    //   e.g. "Metal" → "Heavy Metal", "Death Metal"
    for (const [sKey, { vid }] of statsBestByGenre) {
      if (sKey.includes(gLow)) {
        found = vid;
        break;
      }
    }
    if (found) { results.set(genre, found); continue; }

    // Strategy 4: canonical name starts with artist_stats genre
    //   e.g. "Metal" is short; "Death Metal" canonical matches "Death" if that
    //   existed — rarely used but catches short artist_stats tags
    for (const [sKey, { vid }] of statsBestByGenre) {
      if (gLow.startsWith(sKey + " ") || gLow.startsWith(sKey + "(")) {
        found = vid;
        break;
      }
    }
    if (found) { results.set(genre, found); continue; }

    results.set(genre, null); // will try artists table below
  }

  // 4. For genres still missing, use the artists.genre1-6 columns → videos table
  const missing = genres.filter((g) => !results.get(g));
  if (missing.length > 0) {
    console.log(`\nStrategies 5-6 (artists table) for ${missing.length} genres...`);

    // Load artists with genre columns
    const artistRows = await prisma.$queryRaw`
      SELECT LOWER(TRIM(name)) AS nameLow, genre1, genre2, genre3, genre4, genre5, genre6
      FROM artists
      WHERE name IS NOT NULL AND TRIM(name) <> ''
    `;

    // artByName: normalised artist name → array of genre values (lowercased)
    const artByName = new Map();
    for (const row of artistRows) {
      if (!row.nameLow) continue;
      const gs = [row.genre1, row.genre2, row.genre3, row.genre4, row.genre5, row.genre6]
        .filter(Boolean).map((g) => g.trim().toLowerCase());
      artByName.set(row.nameLow, gs);
    }

    // Best available video per normalised artist name
    const videoRows = await prisma.$queryRaw`
      SELECT LOWER(TRIM(v.parsedArtist)) AS artistLow, v.videoId
      FROM videos v
      JOIN site_videos sv ON sv.video_id = v.id AND sv.status = 'available'
      WHERE v.videoId REGEXP '^[A-Za-z0-9_-]{11}$'
        AND v.parsedArtist IS NOT NULL AND v.parsedArtist <> ''
      ORDER BY v.favourited DESC, v.views DESC, v.id ASC
    `;

    const artistBestVideo = new Map();
    for (const row of videoRows) {
      if (row.artistLow && !artistBestVideo.has(row.artistLow))
        artistBestVideo.set(row.artistLow, row.videoId);
    }

    for (const genre of missing) {
      const gLow = genre.toLowerCase();

      // Strategy 5: exact match on any genre column
      let vid = null;
      for (const [nameLow, genreTags] of artByName) {
        if (genreTags.some((tag) => tag === gLow)) {
          vid = artistBestVideo.get(nameLow);
          if (vid) break;
        }
      }

      // Strategy 6: genre column contains canonical name (e.g. "Country Rock" for "Country")
      if (!vid) {
        for (const [nameLow, genreTags] of artByName) {
          if (genreTags.some((tag) => tag.includes(gLow))) {
            vid = artistBestVideo.get(nameLow);
            if (vid) break;
          }
        }
      }

      if (vid) results.set(genre, vid);
    }
  }

  // 5. Final backfill for unresolved genres using title/description relevance.
  const stillMissing = genres.filter((g) => !results.get(g));
  if (stillMissing.length > 0) {
    console.log(`\nStrategy 7 (video text relevance) for ${stillMissing.length} genres...`);

    const textRows = await prisma.$queryRaw`
      SELECT v.videoId, v.title, v.description, v.favourited, v.views
      FROM videos v
      JOIN site_videos sv ON sv.video_id = v.id AND sv.status = 'available'
      WHERE v.videoId REGEXP '^[A-Za-z0-9_-]{11}$'
        AND v.title IS NOT NULL
      ORDER BY v.favourited DESC, v.views DESC, v.id ASC
      LIMIT 25000
    `;

    for (const genre of stillMissing) {
      let best = null;
      let bestScore = 0;

      for (const row of textRows) {
        const score = scoreVideoForGenre(genre, row.title, row.description);
        if (score > bestScore) {
          bestScore = score;
          best = row.videoId;
        }
      }

      // Guardrail to avoid very weak, random assignments.
      if (best && bestScore >= 42) {
        results.set(genre, best);
      }
    }
  }

  // 6. Report coverage
  const withThumb = [...results.values()].filter(Boolean).length;
  const total = results.size;
  const coverage = ((withThumb / total) * 100).toFixed(1);
  console.log(`\nThumbnail coverage: ${withThumb}/${total} genres (${coverage}%)`);

  if (isDryRun) {
    console.log("\n[dry-run] Sample results:");
    let n = 0;
    for (const [genre, vid] of results) {
      console.log(`  ${genre.padEnd(40)} ${vid ?? "(none)"}`);
      if (++n >= 40) { console.log("  ..."); break; }
    }
    console.log("\n[dry-run] No changes written.");
    return;
  }

  // 7. Upsert all rows into genre_cards
  console.log("\nWriting to genre_cards...");
  let written = 0;
  for (const [genre, thumbnailVideoId] of results) {
    await prisma.$executeRaw`
      INSERT INTO genre_cards (genre, thumbnail_video_id, updated_at)
      VALUES (${genre}, ${thumbnailVideoId ?? null}, NOW(3))
      ON DUPLICATE KEY UPDATE
        thumbnail_video_id = VALUES(thumbnail_video_id),
        updated_at = NOW(3)
    `;
    written++;
  }

  console.log(`Done. ${written} rows upserted into genre_cards.`);
}

main()
  .catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
