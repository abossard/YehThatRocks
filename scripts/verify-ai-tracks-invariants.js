#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const ROOT = process.cwd();

const files = {
  aiListPage: path.join(ROOT, "apps/web/app/(shell)/ai/page.tsx"),
  aiDetailPage: path.join(ROOT, "apps/web/app/(shell)/ai/[id]/page.tsx"),
  aiListRoute: path.join(ROOT, "apps/web/app/api/ai/route.ts"),
  aiDetailRoute: path.join(ROOT, "apps/web/app/api/ai/[id]/route.ts"),
  aiVoteRoute: path.join(ROOT, "apps/web/app/api/ai/[id]/vote/route.ts"),
  aiVoteControls: path.join(ROOT, "apps/web/components/ai-vote-controls.tsx"),
  apiSchemas: path.join(ROOT, "apps/web/lib/api-schemas.ts"),
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

  const aiListPageSource = read(files.aiListPage);
  const aiDetailPageSource = read(files.aiDetailPage);
  const aiListRouteSource = read(files.aiListRoute);
  const aiDetailRouteSource = read(files.aiDetailRoute);
  const aiVoteRouteSource = read(files.aiVoteRoute);
  const aiVoteControlsSource = read(files.aiVoteControls);
  const apiSchemasSource = read(files.apiSchemas);
  const globalCssSource = read(files.globalCss);

  // --- AI list page ---
  assertContains(aiListPageSource, "getAiTracks()", "AI list page loads tracks via getAiTracks server-side", failures);
  assertContains(aiListPageSource, "/ai/${track.id}", "AI list page links each track to its detail route", failures);
  assertContains(aiListPageSource, "aiTrackCard", "AI list page renders tracks with aiTrackCard CSS class", failures);
  assertContains(aiListPageSource, "track.tool", "AI list page shows the generation tool for each track", failures);
  assertContains(aiListPageSource, "track.score", "AI list page shows the score for each track", failures);
  assertContains(aiListPageSource, "track.playCount", "AI list page shows play count for each track", failures);
  assertContains(aiListPageSource, "track.prompt", "AI list page shows a prompt preview for each track", failures);

  // --- AI detail page ---
  assertContains(aiDetailPageSource, "getAiTrackById(id)", "AI detail page loads track by ID server-side", failures);
  assertContains(aiDetailPageSource, "notFound()", "AI detail page calls notFound() for missing tracks", failures);
  assertContains(aiDetailPageSource, "<AiVoteControls", "AI detail page renders AiVoteControls component", failures);
  assertContains(aiDetailPageSource, "trackId={track.id}", "AI detail page passes track ID to AiVoteControls", failures);
  assertContains(aiDetailPageSource, "/api/ai/{track.id}/vote", "AI detail page documents the vote API endpoint in the UI", failures);
  assertContains(aiDetailPageSource, "track.prompt", "AI detail page renders prompt text for transparency", failures);
  assertContains(aiDetailPageSource, "audioPlaceholder", "AI detail page reserves audio player placeholder section", failures);

  // --- AI list API route: public GET ---
  assertContains(aiListRouteSource, "getAiTracks()", "AI list API route delegates to getAiTracks", failures);
  assertContains(aiListRouteSource, "NextResponse.json({ tracks })", "AI list API route returns tracks array", failures);
  assertNotContains(aiListRouteSource, "requireApiAuth", "AI list API route is public (no auth required)", failures);

  // --- AI detail API route: GET by ID ---
  assertContains(aiDetailRouteSource, "getAiTrackById(id)", "AI detail API route delegates to getAiTrackById", failures);
  assertContains(aiDetailRouteSource, "{ status: 404 }", "AI detail API route returns 404 for missing track", failures);
  assertContains(aiDetailRouteSource, "context.params", "AI detail API route resolves id from route context params", failures);
  assertNotContains(aiDetailRouteSource, "requireApiAuth", "AI detail API route is public (no auth required)", failures);

  // --- AI vote route: anonymous voting ---
  assertNotContains(aiVoteRouteSource, "requireApiAuth", "AI vote API route allows anonymous votes (no auth required)", failures);
  assertContains(aiVoteRouteSource, "aiVoteSchema.safeParse(bodyResult.data)", "AI vote route validates body against aiVoteSchema", failures);
  assertContains(aiVoteRouteSource, "submitAiVote(id, parsed.data.vote)", "AI vote route delegates to submitAiVote with correct arguments", failures);
  assertContains(aiVoteRouteSource, "{ status: 404 }", "AI vote route returns 404 for unrecognised track ID", failures);

  // --- AiVoteControls component ---
  assertContains(aiVoteControlsSource, "`/api/ai/${trackId}/vote`", "AiVoteControls posts vote to /api/ai/<id>/vote", failures);
  assertContains(aiVoteControlsSource, "method: \"POST\"", "AiVoteControls uses POST method for vote submission", failures);
  assertContains(aiVoteControlsSource, "vote: 1", "AiVoteControls sends vote=1 for upvote", failures);
  assertContains(aiVoteControlsSource, "submitVote(-1)", "AiVoteControls calls submitVote(-1) for downvote", failures);
  assertContains(aiVoteControlsSource, "disabled={isPending}", "AiVoteControls disables both buttons while a vote is in-flight", failures);
  assertContains(aiVoteControlsSource, "Upvote recorded.", "AiVoteControls shows success message after upvote", failures);
  assertContains(aiVoteControlsSource, "Downvote recorded.", "AiVoteControls shows success message after downvote", failures);
  assertContains(aiVoteControlsSource, "Vote failed. Try again.", "AiVoteControls shows error message on failed vote", failures);
  assertContains(aiVoteControlsSource, "router.refresh()", "AiVoteControls refreshes the page after successful vote", failures);

  // --- aiVoteSchema schema ---
  assertContains(apiSchemasSource, "export const aiVoteSchema", "api-schemas exports aiVoteSchema", failures);
  assertContains(apiSchemasSource, "z.literal(1)", "aiVoteSchema allows vote=1", failures);
  assertContains(apiSchemasSource, "z.literal(-1)", "aiVoteSchema allows vote=-1", failures);
  assertContains(apiSchemasSource, "z.union([z.literal(1), z.literal(-1)])", "aiVoteSchema rejects values other than 1 or -1 via union", failures);

  // --- CSS: AI track classes ---
  assertContains(globalCssSource, ".aiTrackCard", "globals.css defines .aiTrackCard style", failures);
  assertContains(globalCssSource, ".promptPreview", "globals.css defines .promptPreview style for prompt text", failures);
  assertContains(globalCssSource, ".audioPlaceholder", "globals.css defines .audioPlaceholder style", failures);

  if (failures.length > 0) {
    console.error("AI tracks invariant check failed.");
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }

  console.log("AI tracks invariant check passed.");
}

main();
