#!/usr/bin/env node
"use strict";

function readArg(name, fallback) {
  const raw = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  if (!raw) {
    return fallback;
  }

  const value = raw.slice(name.length + 3);
  return value || fallback;
}

function asNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function isYouTubeId(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{11}$/.test(value);
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

async function fetchJson(url, init, timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      cache: "no-store",
      ...init,
      signal: controller.signal,
      headers: {
        "Cache-Control": "no-cache",
        ...(init?.headers || {}),
      },
    });

    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    return { response, payload };
  } finally {
    clearTimeout(timeoutId);
  }
}

function uniqueById(videos) {
  const seen = new Set();
  const unique = [];

  for (const video of videos) {
    const id = video?.id;
    if (!isYouTubeId(id) || seen.has(id)) {
      continue;
    }

    seen.add(id);
    unique.push(video);
  }

  return unique;
}

async function main() {
  const baseUrl = readArg("base-url", "http://localhost:3000").replace(/\/$/, "");
  const timeoutMs = Math.max(800, asNumber(readArg("timeout-ms", "5500"), 5500));
  const failures = [];

  console.log("Core experience API smoke checks\n");
  console.log(`baseUrl=${baseUrl} timeoutMs=${timeoutMs}\n`);

  // 1) Top videos feed should be responsive and shape-safe.
  const topUrl = `${baseUrl}/api/videos/top?count=12`;
  const topResult = await fetchJson(topUrl, { method: "GET" }, timeoutMs).catch((error) => ({ error }));

  if (topResult?.error) {
    assertInvariant(false, "Top videos endpoint reachable", String(topResult.error), failures);
  } else {
    const { response, payload } = topResult;
    const videos = Array.isArray(payload?.videos) ? payload.videos : [];

    assertInvariant(response.ok, "Top videos endpoint returns 2xx", `status=${response.status}`, failures);
    assertInvariant(videos.length > 0, "Top videos endpoint returns at least one item", `count=${videos.length}`, failures);
    assertInvariant(videos.length <= 12, "Top videos endpoint respects requested count upper bound", `count=${videos.length}`, failures);
    assertInvariant(videos.every((video) => isYouTubeId(video?.id)), "Top videos payload contains valid YouTube IDs", "invalid video.id values found", failures);
  }

  // 2) Random top endpoint should return a selected id and de-duplicated related list.
  const randomUrl = `${baseUrl}/api/videos/top/random`;
  const randomResult = await fetchJson(randomUrl, { method: "GET" }, timeoutMs).catch((error) => ({ error }));

  let selectedVideoId = null;
  if (randomResult?.error) {
    assertInvariant(false, "Random top endpoint reachable", String(randomResult.error), failures);
  } else {
    const { response, payload } = randomResult;
    const selected = payload?.video ?? null;
    const relatedVideos = Array.isArray(payload?.relatedVideos) ? payload.relatedVideos : [];
    const uniqueRelated = uniqueById(relatedVideos);

    selectedVideoId = isYouTubeId(selected?.id) ? selected.id : null;

    assertInvariant(response.ok, "Random top endpoint returns 2xx", `status=${response.status}`, failures);
    assertInvariant(Boolean(selectedVideoId), "Random top endpoint returns valid selected video id", `video.id=${String(selected?.id)}`, failures);
    assertInvariant(relatedVideos.length === uniqueRelated.length, "Random top related list has no duplicate ids", `related=${relatedVideos.length} unique=${uniqueRelated.length}`, failures);
    if (selectedVideoId) {
      const containsSelected = uniqueRelated.some((video) => video.id === selectedVideoId);
      assertInvariant(!containsSelected, "Random top related list excludes selected video", `selected=${selectedVideoId}`, failures);
    }
  }

  // 3) Current-video resolver should return stable contract.
  const currentUrl = selectedVideoId
    ? `${baseUrl}/api/current-video?v=${encodeURIComponent(selectedVideoId)}`
    : `${baseUrl}/api/current-video`;

  const currentResult = await fetchJson(currentUrl, { method: "GET" }, timeoutMs).catch((error) => ({ error }));

  if (currentResult?.error) {
    assertInvariant(false, "Current-video endpoint reachable", String(currentResult.error), failures);
  } else {
    const { response, payload } = currentResult;

    assertInvariant(response.ok, "Current-video endpoint returns 2xx", `status=${response.status}`, failures);

    if (payload?.pending === true) {
      assertInvariant(true, "Current-video endpoint supports pending payload path", "", failures);
    } else {
      const currentVideoId = payload?.currentVideo?.id;
      const relatedVideos = Array.isArray(payload?.relatedVideos) ? payload.relatedVideos : [];
      const uniqueRelated = uniqueById(relatedVideos);
      const hasCurrent = isYouTubeId(currentVideoId);

      assertInvariant(hasCurrent, "Current-video payload includes valid currentVideo.id", `currentVideo.id=${String(currentVideoId)}`, failures);
      assertInvariant(relatedVideos.length === uniqueRelated.length, "Current-video relatedVideos has unique ids", `related=${relatedVideos.length} unique=${uniqueRelated.length}`, failures);
      assertInvariant(relatedVideos.length <= 10, "Current-video relatedVideos does not exceed Watch Next cap", `related=${relatedVideos.length}`, failures);

      if (hasCurrent) {
        const selfIncluded = uniqueRelated.some((video) => video.id === currentVideoId);
        assertInvariant(!selfIncluded, "Current-video relatedVideos excludes current video id", `currentVideo.id=${currentVideoId}`, failures);
      }
    }
  }

  // 4) Chat endpoints must reject unauthenticated requests.
  const chatGetUrl = `${baseUrl}/api/chat?mode=global`;
  const chatPostUrl = `${baseUrl}/api/chat`;
  const chatStreamUrl = `${baseUrl}/api/chat/stream?mode=global`;

  const chatGet = await fetch(chatGetUrl, { method: "GET", cache: "no-store" }).catch((error) => ({ error }));
  if (chatGet?.error) {
    assertInvariant(false, "Chat GET endpoint reachable", String(chatGet.error), failures);
  } else {
    assertInvariant(
      chatGet.status === 401 || chatGet.status === 403,
      "Chat GET requires authentication",
      `status=${chatGet.status}`,
      failures,
    );
  }

  const chatPost = await fetch(chatPostUrl, {
    method: "POST",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ mode: "global", content: "smoke-test" }),
  }).catch((error) => ({ error }));

  if (chatPost?.error) {
    assertInvariant(false, "Chat POST endpoint reachable", String(chatPost.error), failures);
  } else {
    assertInvariant(
      chatPost.status === 401 || chatPost.status === 403,
      "Chat POST requires authentication",
      `status=${chatPost.status}`,
      failures,
    );
  }

  const chatStream = await fetch(chatStreamUrl, { method: "GET", cache: "no-store" }).catch((error) => ({ error }));
  if (chatStream?.error) {
    assertInvariant(false, "Chat stream endpoint reachable", String(chatStream.error), failures);
  } else {
    assertInvariant(
      chatStream.status === 401 || chatStream.status === 403,
      "Chat stream requires authentication",
      `status=${chatStream.status}`,
      failures,
    );
  }

  if (failures.length > 0) {
    console.error(`\nCore experience API smoke check failed: ${failures.length} issue(s).`);
    process.exit(1);
  }

  console.log("\nCore experience API smoke check passed.");
}

main().catch((error) => {
  console.error("Fatal error in core experience API smoke checker:", error);
  process.exit(1);
});
