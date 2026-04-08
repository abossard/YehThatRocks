const fs = require("node:fs");
const path = require("node:path");
const { PrismaClient } = require("@prisma/client");

function loadEnv() {
  const envs = [".env.local", "apps/web/.env.local", ".env.production", "apps/web/.env.production"];
  for (const rel of envs) {
    const filePath = path.resolve(process.cwd(), rel);
    if (!fs.existsSync(filePath)) continue;
    const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
    for (const line of lines) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const m = t.match(/^([A-Z0-9_]+)=(.*)$/);
      if (!m) continue;
      const [, k, v] = m;
      if (!process.env[k]) process.env[k] = v.replace(/^"/, "").replace(/"$/, "");
    }
  }
}

async function main() {
  loadEnv();
  const prisma = new PrismaClient();
  try {
    const rows = await prisma.$queryRawUnsafe(`
      SELECT COUNT(*) AS c
      FROM videos v
      WHERE EXISTS (
        SELECT 1 FROM site_videos sv
        WHERE sv.video_id = v.id
          AND sv.status = 'available'
      )
      AND (
        LOWER(v.title) REGEXP 'instagram|tiktok|facebook|whatsapp|snapchat|podcast|interview|prank|challenge|reaction|vlog|tutorial|gameplay|livestream|stream highlights?|news|fails?|compilation|meme|shorts?'
        OR LOWER(COALESCE(v.description, '')) REGEXP 'instagram|tiktok|facebook|whatsapp|snapchat|podcast|interview|prank|challenge|reaction|vlog|tutorial|gameplay|livestream|stream highlights?|news|fails?|compilation|meme|shorts?'
      )
    `);
    console.log(`non_music_keyword_available=${Number(rows[0].c)}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
