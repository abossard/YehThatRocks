const { PrismaClient } = require("@prisma/client");

async function main() {
  const prisma = new PrismaClient();
  try {
    const videos = await prisma.$queryRawUnsafe("SHOW COLUMNS FROM videos");
    const siteVideos = await prisma.$queryRawUnsafe("SHOW COLUMNS FROM site_videos");
    const related = await prisma.$queryRawUnsafe("SHOW COLUMNS FROM related");

    console.log("videos:", videos.map((c) => c.Field).join(","));
    console.log("site_videos:", siteVideos.map((c) => c.Field).join(","));
    console.log("related:", related.map((c) => c.Field).join(","));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
