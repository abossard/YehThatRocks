const fs = require("node:fs");

const reportPath = process.argv[2];
const limit = Math.max(1, Number(process.argv[3] || "15") || 15);

if (!reportPath) {
  console.error("Usage: node scripts/preview-non-music-report.js <report-json-path> [limit]");
  process.exit(1);
}

const payload = JSON.parse(fs.readFileSync(reportPath, "utf8"));
console.log(`count=${payload.candidateCount}`);

for (const row of payload.candidates.slice(0, limit)) {
  console.log(`${row.score}\t${row.videoId}\t${row.title}`);
}
