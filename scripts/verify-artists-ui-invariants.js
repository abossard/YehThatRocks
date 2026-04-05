#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const ROOT = process.cwd();

const files = {
  nav: path.join(ROOT, "apps/web/components/artists-letter-nav.tsx"),
  results: path.join(ROOT, "apps/web/components/artists-letter-results.tsx"),
  events: path.join(ROOT, "apps/web/lib/artists-letter-events.ts"),
};

function read(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing file: ${path.relative(ROOT, filePath)}`);
  }
  return fs.readFileSync(filePath, "utf8");
}

function assertContains(source, needle, description, failures) {
  if (!source.includes(needle)) {
    failures.push(`${description} (missing: ${needle})`);
  }
}

function assertMatches(source, pattern, description, failures) {
  if (!pattern.test(source)) {
    failures.push(`${description} (pattern: ${pattern})`);
  }
}

function main() {
  const failures = [];

  const navSource = read(files.nav);
  const resultsSource = read(files.results);
  const eventsSource = read(files.events);

  // Event contract exists and is shared.
  assertContains(eventsSource, "ARTISTS_LETTER_CHANGE_EVENT", "Shared letter-change event constant exists", failures);
  assertContains(eventsSource, "dispatchArtistsLetterChange", "Shared letter-change dispatch helper exists", failures);

  // Letter nav must do client-side in-place updates and dispatch an event.
  assertContains(navSource, "window.history.replaceState", "Letter nav updates URL in place (no full route transition)", failures);
  assertContains(navSource, "dispatchArtistsLetterChange", "Letter nav dispatches client-side letter-change event", failures);
  assertContains(navSource, "onClick={(event) => onLetterClick(event, letter)}", "Letter nav intercepts link click for smooth in-place change", failures);

  // Results must consume letter-change event and fetch letter data directly.
  assertContains(resultsSource, "window.addEventListener(ARTISTS_LETTER_CHANGE_EVENT", "Results listens for client letter-change event", failures);
  assertContains(resultsSource, "fetch(`/api/artists?${params.toString()}`", "Results fetches artists API directly on letter switch", failures);
  assertContains(resultsSource, "setCurrentLetter(nextLetter)", "Results swaps active letter state in place", failures);

  // Scroll reset invariant for letter changes.
  assertContains(resultsSource, "function scrollResultsToTop()", "Results exposes scroll-to-top helper", failures);
  assertContains(resultsSource, "scrollResultsToTop();", "Results invokes scroll-to-top after letter switch", failures);
  assertContains(resultsSource, "scrollNearestContainer", "Results targets nearest scrollable container when resetting top", failures);

  // Infinite-scroll behavior invariants.
  assertContains(resultsSource, "artists.length >= pageSize * 2", "Initial one-chunk-ahead preload guard is present", failures);
  assertContains(resultsSource, "chunkTriggerIndex", "Chunk trigger index logic is present", failures);
  assertContains(resultsSource, "loadMore(nextOffsetRef.current, { background: true })", "Chunk/sentinel background loading path is present", failures);

  // Ensure we do not reintroduce empty placeholder sockets for chunk triggers.
  assertMatches(
    resultsSource,
    /ref=\{index === chunkTriggerIndex \? \(element\) => setChunkTriggerElement\(chunkTriggerRef, element\) : undefined\}/,
    "Chunk trigger binds to an existing card element",
    failures,
  );
  assertContains(resultsSource, "<Fragment key={artist.slug}>", "Artist list rendering remains keyed and stable", failures);

  if (failures.length > 0) {
    console.error("Artists UI invariant check failed.");
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }

  console.log("Artists UI invariant check passed.");
}

main();
