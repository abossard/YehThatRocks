#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { PrismaClient } = require("@prisma/client");

function loadDatabaseEnv() {
  const candidateEnvPaths = [
    path.resolve(process.cwd(), ".env.production"),
    path.resolve(process.cwd(), "apps/web/.env.production"),
    path.resolve(process.cwd(), ".env.local"),
    path.resolve(process.cwd(), "apps/web/.env.local"),
  ];

  for (const envPath of candidateEnvPaths) {
    if (!fs.existsSync(envPath)) {
      continue;
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
}

function parseArg(name, fallback) {
  const raw = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  if (!raw) {
    return fallback;
  }
  return raw.slice(name.length + 3);
}

function toNumber(row, key) {
  return Number(row?.[key] ?? 0);
}

async function main() {
  loadDatabaseEnv();

  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set. Add it to apps/web/.env.local or the current shell.");
    process.exit(1);
  }

  const apply = process.argv.includes("--apply");
  const sampleSize = Math.max(1, Number(parseArg("sample", "10")) || 10);
  const targetVideoId = (parseArg("video-id", "") || "").trim();
  const prisma = new PrismaClient();

  if (targetVideoId && !/^[A-Za-z0-9_-]{11}$/.test(targetVideoId)) {
    console.error("--video-id must be a valid 11-character YouTube id.");
    process.exit(1);
  }

  try {
    await prisma.$executeRawUnsafe("DROP TEMPORARY TABLE IF EXISTS ytr_duplicate_keepers");
    await prisma.$executeRawUnsafe("DROP TEMPORARY TABLE IF EXISTS ytr_duplicate_rows");

    await prisma.$executeRawUnsafe(`
      CREATE TEMPORARY TABLE ytr_duplicate_keepers (
        videoId VARCHAR(32) COLLATE utf8mb4_general_ci PRIMARY KEY,
        keep_id INT NOT NULL
      )
    `);

    await prisma.$executeRawUnsafe(`
      INSERT INTO ytr_duplicate_keepers (videoId, keep_id)
      SELECT
        d.videoId COLLATE utf8mb4_general_ci,
        (
          SELECT v2.id
          FROM videos v2
          WHERE v2.videoId COLLATE utf8mb4_general_ci = d.videoId COLLATE utf8mb4_general_ci
          ORDER BY
            CASE
              WHEN EXISTS (
                SELECT 1
                FROM site_videos sv
                WHERE sv.video_id = v2.id
                  AND sv.status = 'available'
              ) THEN 1
              ELSE 0
            END DESC,
            CASE
              WHEN TRIM(COALESCE(v2.parsedArtist, '')) <> ''
               AND TRIM(COALESCE(v2.parsedTrack, '')) <> ''
              THEN 1
              ELSE 0
            END DESC,
            COALESCE(v2.parseConfidence, 0) DESC,
            COALESCE(v2.favourited, 0) DESC,
            COALESCE(v2.views, 0) DESC,
            v2.id ASC
          LIMIT 1
        ) AS keep_id
      FROM (
        SELECT videoId
        FROM videos
        GROUP BY videoId
        HAVING COUNT(*) > 1
      ) d
    `);

    if (targetVideoId) {
      await prisma.$executeRaw`
        DELETE FROM ytr_duplicate_keepers
        WHERE videoId <> ${targetVideoId}
      `;
    }

    await prisma.$executeRawUnsafe(`
      CREATE TEMPORARY TABLE ytr_duplicate_rows (
        delete_id INT PRIMARY KEY,
        keep_id INT NOT NULL,
        videoId VARCHAR(32) COLLATE utf8mb4_general_ci NOT NULL
      )
      SELECT
        v.id AS delete_id,
        k.keep_id,
        v.videoId
      FROM videos v
      INNER JOIN ytr_duplicate_keepers k ON k.videoId = v.videoId COLLATE utf8mb4_general_ci
      WHERE v.id <> k.keep_id
    `);

    const duplicateGroups = await prisma.$queryRawUnsafe(
      "SELECT COUNT(*) AS c FROM ytr_duplicate_keepers",
    );
    const duplicateRows = await prisma.$queryRawUnsafe(
      "SELECT COUNT(*) AS c FROM ytr_duplicate_rows",
    );

    const impactedRefs = await prisma.$queryRawUnsafe(`
      SELECT 'site_videos' AS tableName, COUNT(*) AS impacted
      FROM site_videos sv
      INNER JOIN ytr_duplicate_rows d ON d.delete_id = sv.video_id
      UNION ALL
      SELECT 'playlistitems' AS tableName, COUNT(*) AS impacted
      FROM playlistitems pi
      INNER JOIN ytr_duplicate_rows d ON d.delete_id = pi.video_id
      UNION ALL
      SELECT 'favourites' AS tableName, COUNT(*) AS impacted
      FROM favourites f
      INNER JOIN ytr_duplicate_rows d ON d.delete_id = f.video_id
      UNION ALL
      SELECT 'videosbyartist' AS tableName, COUNT(*) AS impacted
      FROM videosbyartist va
      INNER JOIN ytr_duplicate_rows d ON d.delete_id = va.video_id
    `);

    const sample = await prisma.$queryRawUnsafe(
      `
        SELECT
          d.videoId,
          d.keep_id AS keepId,
          d.delete_id AS deleteId
        FROM ytr_duplicate_rows d
        ORDER BY d.videoId ASC, d.delete_id ASC
        LIMIT ${sampleSize}
      `,
    );

    console.log("Duplicate groups:", toNumber(duplicateGroups[0], "c"));
    console.log("Rows to delete:", toNumber(duplicateRows[0], "c"));
    if (targetVideoId) {
      console.log("Target videoId:", targetVideoId);
    }
    console.log("Impacted references:");
    for (const row of impactedRefs) {
      console.log(`  ${row.tableName}: ${Number(row.impacted ?? 0)}`);
    }
    console.log("Sample delete mapping:");
    for (const row of sample) {
      console.log(`  videoId=${row.videoId} keep=${row.keepId} delete=${row.deleteId}`);
    }

    if (!apply) {
      if (targetVideoId) {
        console.log(`Dry run complete for ${targetVideoId}. Re-run with --apply to execute updates/deletes.`);
      } else {
        console.log("Dry run complete. Re-run with --apply to execute updates/deletes.");
      }
      return;
    }

    await prisma.$executeRawUnsafe("START TRANSACTION");
    try {
      await prisma.$executeRawUnsafe(`
        UPDATE site_videos sv
        INNER JOIN ytr_duplicate_rows d ON d.delete_id = sv.video_id
        SET sv.video_id = d.keep_id
      `);

      await prisma.$executeRawUnsafe(`
        UPDATE playlistitems pi
        INNER JOIN ytr_duplicate_rows d ON d.delete_id = pi.video_id
        SET pi.video_id = d.keep_id
      `);

      await prisma.$executeRawUnsafe(`
        UPDATE favourites f
        INNER JOIN ytr_duplicate_rows d ON d.delete_id = f.video_id
        SET f.video_id = d.keep_id
      `);

      await prisma.$executeRawUnsafe(`
        UPDATE videosbyartist va
        INNER JOIN ytr_duplicate_rows d ON d.delete_id = va.video_id
        SET va.video_id = d.keep_id
      `);

      const deleted = await prisma.$executeRawUnsafe(`
        DELETE v
        FROM videos v
        INNER JOIN ytr_duplicate_rows d ON d.delete_id = v.id
      `);

      await prisma.$executeRawUnsafe("COMMIT");

      const remaining = await prisma.$queryRawUnsafe(
        "SELECT COUNT(*) AS c FROM (SELECT videoId FROM videos GROUP BY videoId HAVING COUNT(*) > 1) x",
      );

      console.log("Prune completed.");
      console.log("Deleted rows:", Number(deleted ?? 0));
      console.log("Remaining duplicate groups:", toNumber(remaining[0], "c"));
    } catch (error) {
      await prisma.$executeRawUnsafe("ROLLBACK");
      throw error;
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
