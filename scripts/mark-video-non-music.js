const fs = require("node:fs");
const path = require("node:path");
const { PrismaClient } = require("@prisma/client");

function loadDatabaseEnv() {
  const candidateEnvPaths = [
    path.resolve(process.cwd(), ".env.local"),
    path.resolve(process.cwd(), "apps/web/.env.local"),
    path.resolve(process.cwd(), ".env.production"),
    path.resolve(process.cwd(), "apps/web/.env.production"),
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

async function main() {
  const videoId = (process.argv[2] || "").trim();
  if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) {
    throw new Error("Usage: node scripts/mark-video-non-music.js <11-char-video-id>");
  }

  loadDatabaseEnv();
  const prisma = new PrismaClient();

  try {
    const videos = await prisma.$queryRawUnsafe(
      "SELECT id FROM videos WHERE videoId = ? ORDER BY updatedAt DESC, id DESC",
      videoId,
    );

    if (!videos.length) {
      console.log("No matching video found.");
      return;
    }

    for (const row of videos) {
      await prisma.$executeRaw`
        UPDATE videos
        SET
          parsedArtist = ${null},
          parsedTrack = ${null},
          parsedVideoType = ${"unknown"},
          parseMethod = ${"manual-review"},
          parseReason = ${"Manual non-music override"},
          parseConfidence = ${0},
          parsedAt = ${new Date()}
        WHERE id = ${row.id}
      `;

      await prisma.$executeRaw`
        UPDATE site_videos
        SET status = ${"unavailable"}
        WHERE video_id = ${row.id}
      `;
    }

    console.log(`Updated ${videos.length} video row(s) and related site_videos status.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
