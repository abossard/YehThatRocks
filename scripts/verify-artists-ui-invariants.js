#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const ROOT = process.cwd();

const files = {
  nav: path.join(ROOT, "apps/web/components/artists-letter-nav.tsx"),
  results: path.join(ROOT, "apps/web/components/artists-letter-results.tsx"),
  events: path.join(ROOT, "apps/web/lib/artists-letter-events.ts"),
  artistPage: path.join(ROOT, "apps/web/app/(shell)/artist/[slug]/page.tsx"),
  artistWikiPage: path.join(ROOT, "apps/web/app/(shell)/artist/[slug]/wiki/page.tsx"),
  artistLoading: path.join(ROOT, "apps/web/app/(shell)/artist/[slug]/loading.tsx"),
  artistRouting: path.join(ROOT, "apps/web/lib/artist-routing.ts"),
  artistWikiLink: path.join(ROOT, "apps/web/components/artist-wiki-link.tsx"),
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
  const artistPageSource = read(files.artistPage);
  const artistWikiPageSource = read(files.artistWikiPage);
  const artistLoadingSource = read(files.artistLoading);
  const artistRoutingSource = read(files.artistRouting);
  const artistWikiLinkSource = read(files.artistWikiLink);

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

  // Artist detail and wiki route invariants.
  assertContains(artistPageSource, 'Link href={wikiHref} className="categoryHeaderWikiLink"', "Artist detail page exposes a wiki header link", failures);
  assertContains(artistPageSource, 'withVideoContext(`/artist/${encodeURIComponent(artist.slug)}/wiki`, v, resume === "1")', "Artist detail page preserves video context when linking to wiki", failures);
  assertContains(artistWikiPageSource, 'const wiki = await getOrCreateArtistWiki(artist.name, slug);', "Artist wiki page resolves cached-or-generated wiki content", failures);
  assertContains(artistWikiPageSource, 'className="artistWikiTopRow"', "Artist wiki page renders overview and image top row", failures);
  assertContains(artistWikiPageSource, '<h2>Formation and Backstory</h2>', "Artist wiki page renders formation section", failures);
  assertContains(artistWikiPageSource, '<h2>Sources</h2>', "Artist wiki page renders sources section", failures);
  assertContains(artistLoadingSource, 'const isWikiRoute = pathname.endsWith("/wiki");', "Artist route loading detects nested wiki paths", failures);
  assertContains(artistLoadingSource, 'isWikiRoute ? "Loading wiki..." : "Loading artist videos..."', "Artist route loading shows wiki-specific loading copy", failures);
  assertContains(artistRoutingSource, 'export function getArtistWikiPath(artistName: string)', "Artist routing exposes artist wiki path helper", failures);
  assertContains(artistRoutingSource, 'return slug ? `/artist/${encodeURIComponent(slug)}/wiki` : null;', "Artist routing builds /artist/<slug>/wiki routes", failures);
  assertContains(artistWikiLinkSource, 'const targetHref = withVideoContext(href, videoId, true);', "Artist wiki link preserves current video context", failures);
  assertContains(artistWikiLinkSource, 'if (asButton) {', "Artist wiki link supports button rendering for footer controls", failures);

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
