#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const ROOT = process.cwd();

const files = {
  searchPage: path.join(ROOT, "apps/web/app/(shell)/search/page.tsx"),
  searchRoute: path.join(ROOT, "apps/web/app/api/search/route.ts"),
  catalogData: path.join(ROOT, "apps/web/lib/catalog-data.ts"),
  globalCss: path.join(ROOT, "apps/web/app/globals.css"),
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

function assertNotContains(source, needle, description, failures) {
  if (source.includes(needle)) {
    failures.push(`${description} (unexpected: ${needle})`);
  }
}

function main() {
  const failures = [];

  const searchPageSource = read(files.searchPage);
  const searchRouteSource = read(files.searchRoute);
  const catalogDataSource = read(files.catalogData);
  const globalCssSource = read(files.globalCss);

  // --- Search page: server-side rendering ---
  assertContains(searchPageSource, "searchCatalog(query)", "Search page calls searchCatalog server-side", failures);
  assertContains(searchPageSource, "resolvedSearchParams?.q", "Search page reads query from searchParams.q", failures);

  // Deduplication before render
  assertContains(searchPageSource, "new Map(results.artists.map((artist) => [artist.slug, artist])).values()", "Search page deduplicates artists by slug", failures);
  assertContains(searchPageSource, "new Set(results.genres)", "Search page deduplicates genres using Set", failures);

  // Results: videos linked with resume flag
  assertContains(searchPageSource, "/?v=${video.id}&resume=1", "Search page video links include resume=1 flag", failures);

  // Results: artists and genres rendered
  assertContains(searchPageSource, "/artist/${artist.slug}", "Search page artist links route to /artist/<slug>", failures);
  assertContains(searchPageSource, "/categories/${getGenreSlug(genre)}", "Search page genre links route to /categories/<slug>", failures);

  // --- Search API route: public, no authentication required ---
  assertNotContains(searchRouteSource, "requireApiAuth", "Search GET route does not require authentication (public endpoint)", failures);
  assertContains(searchRouteSource, "searchCatalog(query)", "Search API delegates to searchCatalog", failures);
  assertContains(searchRouteSource, "searchParams.get(\"q\")", "Search API reads query from searchParams.q", failures);
  assertContains(searchRouteSource, "NextResponse.json({", "Search API returns JSON response", failures);
  assertContains(searchRouteSource, "query,", "Search API response includes query echo", failures);
  assertContains(searchRouteSource, "...results", "Search API spreads catalog results into response", failures);

  // --- searchCatalog data logic: full-text boolean mode ---
  assertContains(catalogDataSource, "BOOLEAN MODE", "searchCatalog uses MySQL full-text BOOLEAN MODE for prefix matching", failures);
  assertContains(catalogDataSource, "+${w}*", "searchCatalog appends + prefix and * wildcard to each word token", failures);
  assertContains(catalogDataSource, "MATCH(title, parsedArtist, parsedTrack) AGAINST", "searchCatalog queries full-text index on title, parsedArtist, parsedTrack", failures);

  // Empty query returns top videos (not empty/error)
  assertContains(catalogDataSource, "if (!normalized) {", "searchCatalog handles empty query explicitly", failures);
  assertContains(catalogDataSource, "videos: await getTopVideos(),", "searchCatalog returns top videos for empty query", failures);
  assertContains(catalogDataSource, "artists: await getArtists(),", "searchCatalog returns all artists for empty query", failures);

  // Fallback to seed data on DB failure
  assertContains(catalogDataSource, "searchSeedCatalog(query)", "searchCatalog falls back to seed catalog when DB query fails", failures);
  assertContains(catalogDataSource, "console.error(\"[searchCatalog] query failed, falling back to seed:\"", "searchCatalog logs DB query failure before falling back", failures);

  // Partial fallback: seed used only when DB returns empty results
  assertContains(catalogDataSource, "videos.length > 0 ? videos.map(mapVideo) : searchSeedCatalog(query).videos", "searchCatalog falls back to seed videos when DB returns zero results", failures);
  assertContains(catalogDataSource, "artists.length > 0 ? artists.map(mapArtist) : searchSeedCatalog(query).artists", "searchCatalog falls back to seed artists when DB returns zero results", failures);

  // Result limit: capped at 12
  assertContains(catalogDataSource, "LIMIT 12", "searchCatalog caps video results to 12 per query", failures);

  if (failures.length > 0) {
    console.error("Search invariant check failed.");
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }

  console.log("Search invariant check passed.");
}

main();
