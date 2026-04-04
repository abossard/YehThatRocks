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

const HELP_TEXT = `
Usage: node scripts/enrich-video-metadata.js [options]

Options:
  --all                 Reprocess rows even if parsed metadata already exists
  --until-done          Keep processing batch windows until no matching rows remain
  --limit=100           Number of rows to process
  --offset=0            Number of eligible rows to skip before processing
  --concurrency=2       Concurrent LLM requests
  --batch-size=25       Titles per LLM call (default 25)
  --timeout-ms=30000    Request timeout per Groq call
  --retries=4           Retry count for transient fetch/API failures
  --retry-base-ms=750   Base backoff delay used between retries
  --min-confidence=0.65 Minimum confidence required to keep a row
  --keep-unclassified   Keep rows that fail/miss metadata instead of deleting
  --videoId=<id>        Process a single videoId
  --model=<name>        Override GROQ model name
  --dry-run             Do not write DB updates
  --help                Show this help
`;

if (process.argv.includes("--help")) {
  console.log(HELP_TEXT.trim());
  process.exit(0);
}

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set. Add it to apps/web/.env.local or the current shell.");
  process.exit(1);
}

if (!process.env.GROQ_API_KEY) {
  console.error("GROQ_API_KEY is not set. Add it to apps/web/.env.local or the current shell.");
  process.exit(1);
}

const prisma = new PrismaClient();
const groqModel = parseArg("model", process.env.GROQ_MODEL || "llama-3.1-8b-instant");
const includeAll = process.argv.includes("--all");
const untilDone = process.argv.includes("--until-done");
const dryRun = process.argv.includes("--dry-run");
const limit = Math.max(1, Number(parseArg("limit", "100")));
const offset = Math.max(0, Number(parseArg("offset", "0")));
const concurrency = Math.max(1, Number(parseArg("concurrency", "2")));
const batchSize = Math.max(1, Number(parseArg("batch-size", "25")));
const singleVideoId = parseArg("videoId", "").trim() || undefined;
const requestTimeoutMs = Math.max(1_000, Number(parseArg("timeout-ms", "30000")));
const maxRetries = Math.max(0, Number(parseArg("retries", "4")));
const retryBaseDelayMs = Math.max(100, Number(parseArg("retry-base-ms", "750")));
const minConfidence = Math.max(0, Math.min(1, Number(parseArg("min-confidence", "0.65"))));
const keepUnclassified = process.argv.includes("--keep-unclassified");

function parseArg(name, fallback) {
  const raw = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  if (!raw) {
    return fallback;
  }
  return raw.slice(name.length + 3);
}

function truncate(value, maxLength) {
  if (!value) {
    return null;
  }

  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

function normalizeParsedString(value, maxLength) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed || trimmed.toLowerCase() === "unknown" || trimmed.toLowerCase() === "null") {
    return null;
  }

  return truncate(trimmed, maxLength);
}

function normalizeConfidence(value) {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }

  return Math.max(0, Math.min(1, numeric));
}

function normalizeBoolean(value) {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "yes", "1", "music", "musical"].includes(normalized)) {
      return true;
    }
    if (["false", "no", "0", "non-music", "nonmusic", "not-music"].includes(normalized)) {
      return false;
    }
  }

  if (typeof value === "number") {
    if (value === 1) {
      return true;
    }
    if (value === 0) {
      return false;
    }
  }

  return null;
}

function oneLine(value) {
  if (value == null) {
    return "";
  }

  return String(value).replace(/\s+/g, " ").trim();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getRetryDelayMs(attempt, retryAfterHeader) {
  if (retryAfterHeader) {
    const seconds = Number(retryAfterHeader);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.ceil(seconds * 1000);
    }
  }

  const backoff = retryBaseDelayMs * Math.pow(2, attempt - 1);
  const jitter = Math.floor(Math.random() * retryBaseDelayMs);
  return Math.min(20_000, backoff + jitter);
}

function classifyFetchError(error) {
  const message = oneLine(error instanceof Error ? error.message : String(error));
  const cause = error && typeof error === "object" ? error.cause : null;
  const causeCode = cause && typeof cause === "object" && "code" in cause ? String(cause.code) : "";
  const timeoutLike = message.toLowerCase().includes("aborted") || message.toLowerCase().includes("timeout");
  const transientCode = ["ECONNRESET", "ETIMEDOUT", "ECONNREFUSED", "EAI_AGAIN", "ENOTFOUND", "UND_ERR_CONNECT_TIMEOUT"].includes(causeCode);

  return {
    message,
    causeCode,
    retryable: timeoutLike || transientCode || message.toLowerCase().includes("fetch failed"),
  };
}

async function callGroqWithRetry(requestBody) {
  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);

    try {
      const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        const retryableStatus = response.status === 408 || response.status === 409 || response.status === 429 || (response.status >= 500 && response.status <= 599);
        if (retryableStatus && attempt <= maxRetries + 1 - 1) {
          const delayMs = getRetryDelayMs(attempt, response.headers.get("retry-after"));
          console.warn(`[groq:retry] attempt=${attempt} status=${response.status} delayMs=${delayMs}`);
          await sleep(delayMs);
          continue;
        }

        throw new Error(`Groq API error ${response.status}: ${body.slice(0, 400)}`);
      }

      return response.json();
    } catch (error) {
      const { message, causeCode, retryable } = classifyFetchError(error);
      if (!retryable || attempt > maxRetries) {
        const suffix = causeCode ? ` cause=${causeCode}` : "";
        throw new Error(`${message}${suffix}`);
      }

      const delayMs = getRetryDelayMs(attempt);
      console.warn(`[groq:retry] attempt=${attempt} reason="${message}"${causeCode ? ` cause=${causeCode}` : ""} delayMs=${delayMs}`);
      await sleep(delayMs);
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error("Groq call retry loop exhausted unexpectedly");
}

function extractJsonObject(content) {
  if (typeof content !== "string") {
    throw new Error("Model returned non-string content");
  }

  const trimmed = content.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");

    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }

    throw new Error(`Unable to parse JSON response: ${trimmed.slice(0, 240)}`);
  }
}

async function ensureMetadataColumns() {
  const columns = await prisma.$queryRawUnsafe("SHOW COLUMNS FROM videos");
  const existing = new Set(columns.map((column) => column.Field));
  const missing = [];

  if (!existing.has("parsedArtist")) {
    missing.push("ADD COLUMN parsedArtist VARCHAR(255) NULL");
  }
  if (!existing.has("parsedTrack")) {
    missing.push("ADD COLUMN parsedTrack VARCHAR(255) NULL");
  }
  if (!existing.has("parsedVideoType")) {
    missing.push("ADD COLUMN parsedVideoType VARCHAR(50) NULL");
  }
  if (!existing.has("parseMethod")) {
    missing.push("ADD COLUMN parseMethod VARCHAR(50) NULL");
  }
  if (!existing.has("parseReason")) {
    missing.push("ADD COLUMN parseReason VARCHAR(500) NULL");
  }
  if (!existing.has("parseConfidence")) {
    missing.push("ADD COLUMN parseConfidence FLOAT NULL");
  }
  if (!existing.has("parsedAt")) {
    missing.push("ADD COLUMN parsedAt DATETIME NULL");
  }

  if (missing.length > 0) {
    await prisma.$executeRawUnsafe(`ALTER TABLE videos ${missing.join(", ")}`);
  }
}

function buildPrompt(row) {
  return [
    "Classify whether a YouTube video is a music track and extract music metadata only if it is music.",
    "Return JSON only with these keys:",
    '{"isMusic":boolean,"artist":string|null,"track":string|null,"videoType":"official"|"lyric"|"live"|"cover"|"remix"|"fan"|"unknown","confidence":number,"reason":string}',
    "Rules:",
    "- Set isMusic=false for podcasts, interviews, commentary, gaming, meditation-only, speeches, tutorials, memes, politics, or other non-song content.",
    "- If isMusic=false then artist and track must be null.",
    "- Prefer the performing artist for artist.",
    "- Prefer the song name for track.",
    "- Do not include venue names, years, Official Video, HD, lyrics, remaster, or live qualifiers in artist or track.",
    "- If the title is ambiguous, use nulls and a lower confidence.",
    "- Example: Master of Puppets - Metallica Live Abu Dhabi => artist Metallica, track Master of Puppets, videoType live.",
    "- Never return markdown fences.",
    "",
    `videoId: ${row.videoId || ""}`,
    `rawTitle: ${row.title || ""}`,
  ].join("\n");
}

async function classifyVideo(row) {
  const payload = await callGroqWithRetry({
    model: groqModel,
    temperature: 0.1,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "You are a strict music metadata extraction service. Output valid JSON only, with no prose or markdown.",
      },
      {
        role: "user",
        content: buildPrompt(row),
      },
    ],
  });
  const content = payload?.choices?.[0]?.message?.content;
  const parsed = extractJsonObject(content);

  return {
    isMusic: normalizeBoolean(parsed.isMusic),
    artist: normalizeParsedString(parsed.artist, 255),
    track: normalizeParsedString(parsed.track, 255),
    videoType: normalizeParsedString(parsed.videoType, 50),
    confidence: normalizeConfidence(parsed.confidence),
    reason: normalizeParsedString(parsed.reason, 500),
  };
}

function chunkArray(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

function buildBatchPrompt(rows) {
  const lines = [
    "Classify whether each YouTube title is music and extract metadata only for music items.",
    "Return JSON as {\"results\":[...]} with one object per item, in the same order.",
    "Each object: {\"index\":number,\"isMusic\":boolean,\"artist\":string|null,\"track\":string|null,\"videoType\":\"official\"|\"lyric\"|\"live\"|\"cover\"|\"remix\"|\"fan\"|\"unknown\",\"confidence\":number,\"reason\":string}",
    "Rules:",
    "- Set isMusic=false for podcasts, interviews, commentary, gaming, meditation-only, speeches, tutorials, memes, politics, or other non-song content.",
    "- If isMusic=false then artist and track must be null.",
    "- Prefer the performing artist for artist.",
    "- Prefer the song name for track.",
    "- Do not include venue names, years, Official Video, HD, lyrics, remaster, or live qualifiers in artist or track.",
    "- If the title is ambiguous, use nulls and a lower confidence.",
    "- Example: Master of Puppets - Metallica Live Abu Dhabi => artist Metallica, track Master of Puppets, videoType live.",
    "- Return exactly one results entry per input item, in the same order.",
    "- index must match the input item number.",
    "- Never return markdown fences.",
    "",
    "Items:",
  ];

  for (let i = 0; i < rows.length; i++) {
    lines.push(`${i}: ${oneLine(rows[i].title || "")}`);
  }

  return lines.join("\n");
}

async function classifyVideoBatch(rows) {
  const payload = await callGroqWithRetry({
    model: groqModel,
    temperature: 0.1,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "You are a strict music metadata extraction service. Output valid JSON only. When processing multiple items return {\"results\":[...]} with one entry per item.",
      },
      {
        role: "user",
        content: buildBatchPrompt(rows),
      },
    ],
  });
  const content = payload?.choices?.[0]?.message?.content;
  const parsed = extractJsonObject(content);

  const rawArray = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed.results)
      ? parsed.results
      : Array.isArray(parsed.items)
        ? parsed.items
        : null;

  if (!rawArray) {
    throw new Error(`Batch response did not contain a results array: ${String(content).slice(0, 240)}`);
  }

  let aligned = rawArray;
  if (rawArray.length !== rows.length) {
    const byIndex = new Map();
    for (const item of rawArray) {
      const rawIndex =
        typeof item?.index === "number"
          ? item.index
          : typeof item?.i === "number"
            ? item.i
            : Number(item?.index);
      if (Number.isInteger(rawIndex) && rawIndex >= 0 && rawIndex < rows.length && !byIndex.has(rawIndex)) {
        byIndex.set(rawIndex, item);
      }
    }

    if (byIndex.size === rows.length) {
      aligned = Array.from({ length: rows.length }, (_, i) => byIndex.get(i));
      console.warn(`[batch:aligned] used index mapping expected=${rows.length} received=${rawArray.length}`);
    } else if (rawArray.length > rows.length) {
      aligned = rawArray.slice(0, rows.length);
      console.warn(`[batch:aligned] truncated oversized batch expected=${rows.length} received=${rawArray.length}`);
    } else {
      throw new Error(`Batch response length mismatch: expected ${rows.length}, got ${rawArray.length}`);
    }
  }

  return aligned.map((item) => ({
    isMusic: normalizeBoolean(item.isMusic),
    artist: normalizeParsedString(item.artist, 255),
    track: normalizeParsedString(item.track, 255),
    videoType: normalizeParsedString(item.videoType, 50),
    confidence: normalizeConfidence(item.confidence),
    reason: normalizeParsedString(item.reason, 500),
  }));
}

async function fetchTargetRows() {
  if (singleVideoId) {
    return prisma.$queryRawUnsafe(
      `SELECT id, videoId, title, description, parsedArtist, parsedTrack FROM videos WHERE videoId = ? LIMIT 1`,
      singleVideoId,
    );
  }

  const whereClause = includeAll
    ? "WHERE videoId IS NOT NULL AND title IS NOT NULL"
    : "WHERE videoId IS NOT NULL AND title IS NOT NULL AND (parsedArtist IS NULL OR parsedTrack IS NULL)";

  return prisma.$queryRawUnsafe(
    `SELECT id, videoId, title, description, parsedArtist, parsedTrack
     FROM videos
     ${whereClause}
     ORDER BY id ASC
     LIMIT ? OFFSET ?`,
    limit,
    offset,
  );
}

async function fetchTargetRowsByCursor(lastId, batchLimit) {
  if (singleVideoId) {
    return fetchTargetRows();
  }

  const whereClause = includeAll
    ? "WHERE id > ? AND videoId IS NOT NULL AND title IS NOT NULL"
    : "WHERE id > ? AND videoId IS NOT NULL AND title IS NOT NULL AND (parsedArtist IS NULL OR parsedTrack IS NULL)";

  return prisma.$queryRawUnsafe(
    `SELECT id, videoId, title, description, parsedArtist, parsedTrack
     FROM videos
     ${whereClause}
     ORDER BY id ASC
     LIMIT ?`,
    lastId,
    batchLimit,
  );
}

async function fetchTargetCount() {
  if (singleVideoId) {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*) AS total FROM videos WHERE videoId = ? LIMIT 1`,
      singleVideoId,
    );
    return Number(rows?.[0]?.total || 0);
  }

  const whereClause = includeAll
    ? "WHERE videoId IS NOT NULL AND title IS NOT NULL"
    : "WHERE videoId IS NOT NULL AND title IS NOT NULL AND (parsedArtist IS NULL OR parsedTrack IS NULL)";

  const rows = await prisma.$queryRawUnsafe(`SELECT COUNT(*) AS total FROM videos ${whereClause}`);
  return Number(rows?.[0]?.total || 0);
}

async function updateRow(rowId, result) {
  if (dryRun) {
    return;
  }

  await prisma.$executeRawUnsafe(
    `UPDATE videos
     SET parsedArtist = ?,
         parsedTrack = ?,
         parsedVideoType = ?,
         parseMethod = ?,
         parseReason = ?,
         parseConfidence = ?,
         parsedAt = NOW()
     WHERE id = ?`,
    result.artist,
    result.track,
    result.videoType,
    "groq-llm",
    result.reason,
    result.confidence,
    rowId,
  );
}

const tableColumnsCache = new Map();

async function getTableColumns(tx, table) {
  const cached = tableColumnsCache.get(table);
  if (cached) {
    return cached;
  }

  const rows = await tx.$queryRawUnsafe(`SHOW COLUMNS FROM ${table}`);
  const columns = new Set(rows.map((row) => row.Field));
  tableColumnsCache.set(table, columns);
  return columns;
}

async function deleteByPossibleColumns(tx, table, columnValuePairs) {
  const columns = await getTableColumns(tx, table);
  const targetPair = columnValuePairs.find((pair) => columns.has(pair.column));
  if (!targetPair) {
    return;
  }

  await tx.$executeRawUnsafe(`DELETE FROM ${table} WHERE ${targetPair.column} = ?`, targetPair.value);
}

async function deleteRelatedRowsByVideoId(tx, youtubeVideoId) {
  const columns = await getTableColumns(tx, "related");
  const predicates = [];
  const params = [];

  if (columns.has("videoId")) {
    predicates.push("videoId = ?");
    params.push(youtubeVideoId);
  } else if (columns.has("video_id")) {
    predicates.push("video_id = ?");
    params.push(youtubeVideoId);
  }

  if (columns.has("related")) {
    predicates.push("related = ?");
    params.push(youtubeVideoId);
  }

  if (!predicates.length) {
    return;
  }

  await tx.$executeRawUnsafe(`DELETE FROM related WHERE ${predicates.join(" OR ")}`, ...params);
}

async function deleteRowAndDependents(rowId, youtubeVideoId) {
  if (dryRun) {
    return;
  }

  await prisma.$transaction(async (tx) => {
    // Integer FK-style links to videos.id
    // Mixed schemas exist in this project history: support both snake_case and camelCase keys.
    await deleteByPossibleColumns(tx, "favourites", [
      { column: "video_id", value: rowId },
      { column: "videoId", value: youtubeVideoId },
    ]);
    await deleteByPossibleColumns(tx, "playlistitems", [
      { column: "video_id", value: rowId },
      { column: "videoId", value: youtubeVideoId },
    ]);
    await deleteByPossibleColumns(tx, "videosbyartist", [
      { column: "video_id", value: rowId },
      { column: "videoId", value: youtubeVideoId },
    ]);
    await deleteByPossibleColumns(tx, "site_videos", [
      { column: "video_id", value: rowId },
      { column: "videoId", value: youtubeVideoId },
    ]);

    // String keyed links by YouTube id
    await deleteByPossibleColumns(tx, "messages", [
      { column: "video_id", value: youtubeVideoId },
      { column: "videoId", value: youtubeVideoId },
    ]);
    await deleteRelatedRowsByVideoId(tx, youtubeVideoId);

    await tx.$executeRawUnsafe(`DELETE FROM videos WHERE id = ?`, rowId);
  });
}

function classifyResultStatus(result) {
  const isMusic = result?.isMusic === true;
  const hasArtist = Boolean(result?.artist && String(result.artist).trim());
  const hasTrack = Boolean(result?.track && String(result.track).trim());
  const confidence = result?.confidence;
  const confidenceOk = typeof confidence === "number" && Number.isFinite(confidence)
    ? confidence >= minConfidence
    : false;

  return {
    keep: isMusic && hasArtist && hasTrack && confidenceOk,
    isMusic,
    hasArtist,
    hasTrack,
    confidence: confidence == null ? null : Number(confidence),
    confidenceOk,
  };
}

async function runPool(items, worker, maxConcurrency) {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(maxConcurrency, items.length) }, async () => {
    while (queue.length > 0) {
      const item = queue.shift();
      if (!item) {
        return;
      }
      await worker(item);
    }
  });

  await Promise.all(workers);
}

async function main() {
  await ensureMetadataColumns();
  const targetCount = await fetchTargetCount();

  if (targetCount === 0) {
    console.log("No matching video rows found.");
    return;
  }

  console.log(
    JSON.stringify(
      {
        event: "video-metadata-enrichment:start",
        targetCount,
        model: groqModel,
        dryRun,
        includeAll,
        untilDone,
        limit,
        concurrency,
        minConfidence,
        keepUnclassified,
        singleVideoId: singleVideoId || null,
      },
      null,
      2,
    ),
  );

  let processed = 0;
  let deleted = 0;
  let failed = 0;
  let totalAttempted = 0;
  const startedAt = Date.now();

  const processRows = async (rows) => {
    const chunks = chunkArray(rows, singleVideoId ? 1 : batchSize);

    await runPool(
      chunks,
      async (chunk) => {
        let results;
        if (singleVideoId) {
          try {
            results = [await classifyVideo(chunk[0])];
          } catch (err) {
            const row = chunk[0];
            const title = oneLine(row.title);
            const message = oneLine(err instanceof Error ? err.message : String(err));
            try {
              if (!keepUnclassified) {
                await deleteRowAndDependents(row.id, row.videoId);
                deleted += 1;
                totalAttempted += 1;
                console.warn(`[row:deleted] id=${row.id} videoId=${row.videoId} title="${title}" reason="classification-error" detail="${message}"`);
              } else {
                failed += 1;
                totalAttempted += 1;
                console.error(`[row:error] id=${row.id} videoId=${row.videoId} title="${title}" message="${message}"`);
              }
            } catch (deleteError) {
              failed += 1;
              totalAttempted += 1;
              const deleteMessage = oneLine(deleteError instanceof Error ? deleteError.message : String(deleteError));
              console.error(`[row:error] id=${row.id} videoId=${row.videoId} title="${title}" message="delete-failed: ${deleteMessage}"`);
            }
            return;
          }
        } else {
          try {
            results = await classifyVideoBatch(chunk);
          } catch (batchError) {
            const message = oneLine(batchError instanceof Error ? batchError.message : String(batchError));
            console.warn(`[batch:fallback] chunk size=${chunk.length} reason="${message}" — falling back to individual calls`);
            results = [];
            for (const row of chunk) {
              try {
                results.push(await classifyVideo(row));
              } catch (rowError) {
                const title = oneLine(row.title);
                const msg = oneLine(rowError instanceof Error ? rowError.message : String(rowError));
                try {
                  if (!keepUnclassified) {
                    await deleteRowAndDependents(row.id, row.videoId);
                    deleted += 1;
                    totalAttempted += 1;
                    console.warn(`[row:deleted] id=${row.id} videoId=${row.videoId} title="${title}" reason="classification-error" detail="${msg}"`);
                  } else {
                    failed += 1;
                    totalAttempted += 1;
                    console.error(`[row:error] id=${row.id} videoId=${row.videoId} title="${title}" message="${msg}"`);
                  }
                } catch (deleteError) {
                  failed += 1;
                  totalAttempted += 1;
                  const deleteMessage = oneLine(deleteError instanceof Error ? deleteError.message : String(deleteError));
                  console.error(`[row:error] id=${row.id} videoId=${row.videoId} title="${title}" message="delete-failed: ${deleteMessage}"`);
                }
                results.push(null);
              }
            }
          }
        }

        for (let i = 0; i < chunk.length; i++) {
          const row = chunk[i];
          const result = results[i];
          if (result === null) {
            // already counted/deleted during individual fallback
            continue;
          }

          const status = classifyResultStatus(result);
          if (!status.keep) {
            const title = oneLine(row.title);
            const confidenceText = status.confidence == null ? "null" : status.confidence.toFixed(2);
            const reason = !status.isMusic
              ? "non-music"
              : !status.hasArtist
              ? "missing-artist"
              : !status.hasTrack
                ? "missing-track"
                : `low-confidence(<${minConfidence.toFixed(2)})`;

            try {
              if (!keepUnclassified) {
                await deleteRowAndDependents(row.id, row.videoId);
                deleted += 1;
                totalAttempted += 1;
                console.warn(`[row:deleted] id=${row.id} videoId=${row.videoId} title="${title}" reason="${reason}" confidence=${confidenceText}`);
              } else {
                failed += 1;
                totalAttempted += 1;
                console.error(`[row:error] id=${row.id} videoId=${row.videoId} title="${title}" message="classification-incomplete reason=${reason} confidence=${confidenceText}"`);
              }
            } catch (deleteError) {
              failed += 1;
              totalAttempted += 1;
              const deleteMessage = oneLine(deleteError instanceof Error ? deleteError.message : String(deleteError));
              console.error(`[row:error] id=${row.id} videoId=${row.videoId} title="${title}" message="delete-failed: ${deleteMessage}"`);
            }

            continue;
          }

          try {
            await updateRow(row.id, result);
            processed += 1;
            totalAttempted += 1;
            const title = oneLine(row.title);
            const artist = oneLine(result.artist || "?");
            const track = oneLine(result.track || "?");
            const videoType = oneLine(result.videoType || "unknown");
            const confidence = result.confidence == null ? "?" : result.confidence.toFixed(2);
            const isMusic = result.isMusic === true ? "yes" : result.isMusic === false ? "no" : "?";
            console.log(
              `[row] id=${row.id} videoId=${row.videoId} title="${title}" => isMusic=${isMusic} artist="${artist}" track="${track}" type=${videoType} conf=${confidence}`,
            );
          } catch (error) {
            failed += 1;
            totalAttempted += 1;
            const title = oneLine(row.title);
            const message = oneLine(error instanceof Error ? error.message : String(error));
            console.error(
              `[row:error] id=${row.id} videoId=${row.videoId} title="${title}" message="${message}"`,
            );
          }
        }
      },
      concurrency,
    );

    const elapsedSeconds = Math.max(1, Math.floor((Date.now() - startedAt) / 1000));
    const perMinute = (totalAttempted / elapsedSeconds) * 60;
    const remaining = Math.max(0, targetCount - totalAttempted);
    const etaSeconds = perMinute > 0 ? Math.ceil((remaining / perMinute) * 60) : null;

    console.log(
      JSON.stringify(
        {
          event: "video-metadata-enrichment:progress",
          attempted: totalAttempted,
          processed,
          deleted,
          failed,
          targetCount,
          remaining,
          elapsedSeconds,
          ratePerMinute: Number(perMinute.toFixed(2)),
          etaSeconds,
        },
        null,
        2,
      ),
    );
  };

  if (!untilDone || singleVideoId) {
    const rows = await fetchTargetRows();
    if (!rows.length) {
      console.log("No matching video rows found.");
      return;
    }

    await processRows(rows);
  } else {
    let lastId = 0;

    while (true) {
      const rows = await fetchTargetRowsByCursor(lastId, limit);
      if (!rows.length) {
        break;
      }

      await processRows(rows);
      lastId = Number(rows[rows.length - 1].id);

      if (rows.length < limit) {
        break;
      }
    }
  }

  console.log(
    JSON.stringify(
      {
        event: "video-metadata-enrichment:complete",
        processed,
        deleted,
        failed,
        attempted: totalAttempted,
        targetCount,
        dryRun,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });