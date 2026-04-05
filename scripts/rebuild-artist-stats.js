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

loadDatabaseEnv();

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set. Add it to apps/web/.env.local or the current shell.");
  process.exit(1);
}

const HELP_TEXT = `
Usage: node scripts/rebuild-artist-stats.js [options]

Options:
  --limit=1000         Limit inserted rows for testing
  --letter=A           Rebuild only one starting letter
  --dry-run            Compute results without writing to DB
  --help               Show this help
`;

if (process.argv.includes("--help")) {
  console.log(HELP_TEXT.trim());
  process.exit(0);
}

function parseArg(name, fallback) {
  const raw = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  if (!raw) {
    return fallback;
  }
  return raw.slice(name.length + 3);
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function escapeSqlIdentifier(value) {
  return `\`${String(value).replace(/`/g, "``")}\``;
}

function normalizeArtistKey(value) {
  return typeof value === "string"
    ? value
        .trim()
        .toLowerCase()
    : "";
}

const YOUTUBE_VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
const MAX_THUMBNAIL_CANDIDATES = 24;

async function getArtistColumnMap(prisma) {
  const columns = await prisma.$queryRawUnsafe("SHOW COLUMNS FROM artists");
  const available = new Set(columns.map((column) => column.Field));

  return {
    name: available.has("artist") ? "artist" : available.has("name") ? "name" : "artist",
    country: available.has("country") ? "country" : available.has("origin") ? "origin" : null,
    genreColumns: ["genre1", "genre2", "genre3", "genre4", "genre5", "genre6"].filter((column) => available.has(column)),
  };
}

async function getArtistVideoSource(prisma) {
  try {
    const rows = await prisma.$queryRawUnsafe("SELECT EXISTS(SELECT 1 FROM videosbyartist LIMIT 1) AS hasRows");
    return Number(rows[0]?.hasRows ?? 0) > 0 ? "videosbyartist" : "parsedArtist";
  } catch {
    return "parsedArtist";
  }
}

async function getArtistVideoColumnMap(prisma) {
  const columns = await prisma.$queryRawUnsafe("SHOW COLUMNS FROM videosbyartist");
  const available = new Set(columns.map((column) => column.Field));

  const videoRef = available.has("video_id")
    ? "video_id"
    : available.has("videoId")
      ? "videoId"
      : available.has("id")
        ? "id"
        : "video_id";

  return {
    artistName: available.has("artist") ? "artist" : available.has("artistname") ? "artistname" : available.has("artist_name") ? "artist_name" : "artist",
    videoRef,
    joinsOnVideoPrimaryId: videoRef === "video_id" || videoRef === "id",
  };
}

async function main() {
  const prisma = new PrismaClient();
  const dryRun = process.argv.includes("--dry-run");
  const letter = parseArg("letter", "").trim().toUpperCase();
  const limit = Math.max(0, Number.parseInt(parseArg("limit", "0"), 10) || 0);
  const startedAt = Date.now();

  console.log("Starting artist_stats rebuild...");
  console.log(
    JSON.stringify({
      dryRun,
      letter: /^[A-Z]$/.test(letter) ? letter : "ALL",
      limit: limit > 0 ? limit : "none",
    }),
  );

  try {
    console.log("Loading schema metadata and source strategy...");
    const artistColumns = await getArtistColumnMap(prisma);
    const source = await getArtistVideoSource(prisma);
    console.log(`Using source=${source}.`);
    const nameCol = escapeSqlIdentifier(artistColumns.name);
    const countryExpr = artistColumns.country ? escapeSqlIdentifier(artistColumns.country) : "NULL";
    const genreExpr = artistColumns.genreColumns.length > 0
      ? `COALESCE(${artistColumns.genreColumns.map(escapeSqlIdentifier).join(", ")})`
      : "NULL";
    const whereLetter = /^[A-Z]$/.test(letter) ? `AND UPPER(LEFT(TRIM(${nameCol}), 1)) = ?` : "";

    console.log("Loading artists dimension rows...");
    const artistRows = await prisma.$queryRawUnsafe(
      `
        SELECT
          ${nameCol} AS name,
          ${countryExpr} AS country,
          ${genreExpr} AS genre
        FROM artists
        WHERE ${nameCol} IS NOT NULL
          AND TRIM(${nameCol}) <> ''
          ${whereLetter}
        ORDER BY ${nameCol} ASC
      `,
      ...(/^[A-Z]$/.test(letter) ? [letter] : []),
    );
    console.log(`Loaded ${artistRows.length} artist rows.`);

    let countRows;
    let thumbnailRows;
    if (source === "videosbyartist") {
      console.log("Computing playable video counts from videosbyartist...");
      const artistVideoColumns = await getArtistVideoColumnMap(prisma);
      const artistNameCol = escapeSqlIdentifier(artistVideoColumns.artistName);
      const videoRefCol = escapeSqlIdentifier(artistVideoColumns.videoRef);
      const joinVideoExpr = artistVideoColumns.joinsOnVideoPrimaryId ? "v.id" : "v.videoId";
      const countWhereLetter = /^[A-Z]$/.test(letter) ? `AND UPPER(LEFT(TRIM(${artistNameCol}), 1)) = ?` : "";
      countRows = await prisma.$queryRawUnsafe(
        `
          SELECT
            LOWER(TRIM(va.${artistNameCol})) AS artistKey,
            MIN(TRIM(va.${artistNameCol})) AS displayName,
            COUNT(DISTINCT v.videoId) AS videoCount
          FROM videosbyartist va
          INNER JOIN videos v ON ${joinVideoExpr} = va.${videoRefCol}
          WHERE va.${artistNameCol} IS NOT NULL
            AND TRIM(va.${artistNameCol}) <> ''
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
            ${countWhereLetter}
          GROUP BY LOWER(TRIM(va.${artistNameCol}))
        `,
        ...(/^[A-Z]$/.test(letter) ? [letter] : []),
      );
      console.log(`Computed ${countRows.length} count groups.`);

      console.log("Computing playable thumbnail candidates from videosbyartist...");
      thumbnailRows = await prisma.$queryRawUnsafe(
        `
          SELECT
            LOWER(TRIM(va.${artistNameCol})) AS artistKey,
            SUBSTRING_INDEX(GROUP_CONCAT(v.videoId ORDER BY v.id ASC), ',', ${MAX_THUMBNAIL_CANDIDATES}) AS thumbnailVideoIds
          FROM videosbyartist va
          INNER JOIN videos v ON ${joinVideoExpr} = va.${videoRefCol}
          WHERE va.${artistNameCol} IS NOT NULL
            AND TRIM(va.${artistNameCol}) <> ''
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
            ${countWhereLetter}
          GROUP BY LOWER(TRIM(va.${artistNameCol}))
        `,
        ...(/^[A-Z]$/.test(letter) ? [letter] : []),
      );
      console.log(`Computed ${thumbnailRows.length} thumbnail groups.`);
    } else {
      console.log("Computing playable video counts from parsedArtist...");
      const countWhereLetter = /^[A-Z]$/.test(letter) ? "AND parsedArtist LIKE ?" : "";
      countRows = await prisma.$queryRawUnsafe(
        `
          SELECT
            LOWER(TRIM(v.parsedArtist)) AS artistKey,
            MIN(TRIM(v.parsedArtist)) AS displayName,
            COUNT(DISTINCT v.videoId) AS videoCount
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
            ${countWhereLetter}
          GROUP BY LOWER(TRIM(v.parsedArtist))
        `,
        ...(/^[A-Z]$/.test(letter) ? [`${letter}%`] : []),
      );
      console.log(`Computed ${countRows.length} count groups.`);

      console.log("Computing playable thumbnail candidates from parsedArtist...");
      thumbnailRows = await prisma.$queryRawUnsafe(
        `
          SELECT
            LOWER(TRIM(parsedArtist)) AS artistKey,
            SUBSTRING_INDEX(GROUP_CONCAT(videoId ORDER BY id ASC), ',', ${MAX_THUMBNAIL_CANDIDATES}) AS thumbnailVideoIds
          FROM videos v
          WHERE parsedArtist IS NOT NULL
            AND TRIM(parsedArtist) <> ''
            AND videoId REGEXP '^[A-Za-z0-9_-]{11}$'
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
            ${countWhereLetter}
          GROUP BY LOWER(TRIM(v.parsedArtist))
        `,
        ...(/^[A-Z]$/.test(letter) ? [`${letter}%`] : []),
      );
      console.log(`Computed ${thumbnailRows.length} thumbnail groups.`);
    }

    console.log("Aggregating count and thumbnail maps...");
    const countByArtist = new Map();
    const displayNameByArtist = new Map();
    for (const row of countRows) {
      const key = normalizeArtistKey(row.artistKey);
      if (!key) {
        continue;
      }
      countByArtist.set(key, Number(row.videoCount ?? 0));
      const displayName = typeof row.displayName === "string" ? row.displayName.trim() : "";
      if (displayName && !displayNameByArtist.has(key)) {
        displayNameByArtist.set(key, displayName);
      }
    }

    const thumbnailCandidatesByArtist = new Map();
    for (const row of thumbnailRows) {
      const key = normalizeArtistKey(row.artistKey);
      const rawCandidates = typeof row.thumbnailVideoIds === "string" ? row.thumbnailVideoIds : "";
      if (!key || !rawCandidates) {
        continue;
      }

      const parsedCandidates = Array.from(
        new Set(
          rawCandidates
            .split(",")
            .map((candidate) => candidate.trim())
            .filter((candidate) => YOUTUBE_VIDEO_ID_PATTERN.test(candidate)),
        ),
      );

      if (parsedCandidates.length > 0) {
        thumbnailCandidatesByArtist.set(key, parsedCandidates);
      }
    }

    const statsByArtist = new Map();
    for (const row of artistRows) {
        const normalizedArtist = normalizeArtistKey(row.name);
        if (!normalizedArtist) {
          continue;
        }

        const videoCount = countByArtist.get(normalizedArtist) ?? 0;
        if (videoCount <= 0) {
          continue;
        }

        const current = statsByArtist.get(normalizedArtist);
        const nextRow = {
          normalizedArtist,
          displayName: String(row.name).trim(),
          slug: slugify(row.name),
          firstLetter: String(row.name).trim().charAt(0).toUpperCase(),
          country: row.country ? String(row.country) : null,
          genre: row.genre ? String(row.genre) : null,
          thumbnailVideoId: null,
          videoCount,
          source,
        };

        if (!current) {
          statsByArtist.set(normalizedArtist, nextRow);
          continue;
        }

        if (!current.country && nextRow.country) {
          current.country = nextRow.country;
        }
        if (!current.genre && nextRow.genre) {
          current.genre = nextRow.genre;
        }
        if (nextRow.displayName.length < current.displayName.length) {
          current.displayName = nextRow.displayName;
          current.slug = nextRow.slug;
          current.firstLetter = nextRow.firstLetter;
        }
        current.videoCount = Math.max(current.videoCount, nextRow.videoCount);
      }

    // Include discovered playable artists that are not present in the artists table yet.
    for (const [normalizedArtist, videoCount] of countByArtist.entries()) {
      if (videoCount <= 0 || statsByArtist.has(normalizedArtist)) {
        continue;
      }

      const displayName = displayNameByArtist.get(normalizedArtist) ?? normalizedArtist;
      statsByArtist.set(normalizedArtist, {
        normalizedArtist,
        displayName,
        slug: slugify(displayName),
        firstLetter: displayName.charAt(0).toUpperCase(),
        country: null,
        genre: null,
        thumbnailVideoId: null,
        videoCount,
        source,
      });
    }

    const statsRows = Array.from(statsByArtist.values());
    const prioritizedRows = [...statsRows].sort((left, right) => {
      const countDiff = Number(right.videoCount ?? 0) - Number(left.videoCount ?? 0);
      if (countDiff !== 0) {
        return countDiff;
      }

      return left.displayName.localeCompare(right.displayName);
    });
    const usedThumbnailIds = new Set();
    let dedupedThumbnailSelections = 0;

    for (const row of prioritizedRows) {
      const candidates = thumbnailCandidatesByArtist.get(row.normalizedArtist) ?? [];
      if (candidates.length === 0) {
        row.thumbnailVideoId = null;
        continue;
      }

      const primary = candidates[0];
      const uniqueCandidate = candidates.find((candidate) => !usedThumbnailIds.has(candidate));
      const selected = uniqueCandidate ?? primary;

      if (selected && selected !== primary) {
        dedupedThumbnailSelections += 1;
      }

      row.thumbnailVideoId = selected ?? null;
      if (selected) {
        usedThumbnailIds.add(selected);
      }
    }

    console.log(`Assigned thumbnails with ${dedupedThumbnailSelections} duplicate avoidance substitutions.`);
    console.log(`Aggregated ${statsRows.length} candidate artist_stats rows.`);

    const limitedRows = limit > 0 ? statsRows.slice(0, limit) : statsRows;

    console.log(`Computed ${limitedRows.length} artist_stats rows from source=${source}${letter ? ` for letter=${letter}` : ""}.`);

    if (dryRun) {
      console.log("Dry run only; no database writes performed.");
      console.log(`Completed in ${Date.now() - startedAt}ms.`);
      return;
    }

    console.log(/^[A-Z]$/.test(letter)
      ? `Deleting existing rows for first_letter=${letter}...`
      : "Truncating existing artist_stats table...");
    if (/^[A-Z]$/.test(letter)) {
      await prisma.$executeRawUnsafe("DELETE FROM artist_stats WHERE first_letter = ?", letter);
    } else {
      await prisma.$executeRawUnsafe("TRUNCATE TABLE artist_stats");
    }
    console.log("Existing rows cleared.");

    const thumbnailColumnRows = await prisma.$queryRawUnsafe(
      "SHOW COLUMNS FROM artist_stats LIKE 'thumbnail_video_id'",
    );
    const hasThumbnailColumn = thumbnailColumnRows.length > 0;
    console.log(`Detected thumbnail column: ${hasThumbnailColumn ? "yes" : "no"}.`);

    const chunkSize = 1000;
    const totalChunks = Math.max(1, Math.ceil(limitedRows.length / chunkSize));
    console.log(`Writing ${limitedRows.length} rows in ${totalChunks} chunk(s)...`);
    for (let index = 0; index < limitedRows.length; index += chunkSize) {
      const chunk = limitedRows.slice(index, index + chunkSize);
      const chunkNumber = Math.floor(index / chunkSize) + 1;
      const chunkStart = index + 1;
      const chunkEnd = index + chunk.length;
      console.log(`Inserting chunk ${chunkNumber}/${totalChunks} (rows ${chunkStart}-${chunkEnd})...`);
      const placeholders = chunk
        .map(() => (hasThumbnailColumn ? "(?, ?, ?, ?, ?, ?, ?, ?, ?)" : "(?, ?, ?, ?, ?, ?, ?, ?)"))
        .join(", ");
      const params = chunk.flatMap((row) =>
        hasThumbnailColumn
          ? [
              row.normalizedArtist,
              row.displayName,
              row.slug,
              row.firstLetter,
              row.country,
              row.genre,
              row.thumbnailVideoId,
              row.videoCount,
              row.source,
            ]
          : [
              row.normalizedArtist,
              row.displayName,
              row.slug,
              row.firstLetter,
              row.country,
              row.genre,
              row.videoCount,
              row.source,
            ],
      );

      const insertColumns = hasThumbnailColumn
        ? `
            normalized_artist,
            display_name,
            slug,
            first_letter,
            country,
            genre,
            thumbnail_video_id,
            video_count,
            source
          `
        : `
            normalized_artist,
            display_name,
            slug,
            first_letter,
            country,
            genre,
            video_count,
            source
          `;

      await prisma.$executeRawUnsafe(
        `
          INSERT INTO artist_stats (
            ${insertColumns}
          )
          VALUES ${placeholders}
        `,
        ...params,
      );

      console.log(`Chunk ${chunkNumber}/${totalChunks} inserted.`);
    }

    console.log(`Wrote ${limitedRows.length} rows to artist_stats.`);
    console.log(`Completed in ${Date.now() - startedAt}ms.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
