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
  const videoId = process.argv[2];
  if (!videoId) {
    throw new Error("Usage: node scripts/inspect-video-classification.js <videoId>");
  }

  loadDatabaseEnv();
  const prisma = new PrismaClient();

  try {
    const rows = await prisma.$queryRawUnsafe(
      "SELECT id, videoId, title, parsedArtist, parsedTrack, parsedVideoType, parseMethod, parseReason, parseConfidence, description FROM videos WHERE videoId = ? ORDER BY updatedAt DESC, id DESC LIMIT 5",
      videoId,
    );
    console.log("videos rows:");
    console.log(JSON.stringify(rows, null, 2));

    const statusRows = await prisma.$queryRawUnsafe(
      "SELECT sv.id, sv.video_id, sv.status, sv.title, sv.created_at FROM site_videos sv INNER JOIN videos v ON v.id = sv.video_id WHERE v.videoId = ? ORDER BY sv.id DESC LIMIT 10",
      videoId,
    );
    console.log("site_videos rows:");
    console.log(JSON.stringify(statusRows, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
