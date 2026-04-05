#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const ROOT = process.cwd();

const files = {
  top100Page: path.join(ROOT, "apps/web/app/(shell)/top100/page.tsx"),
  top100Link: path.join(ROOT, "apps/web/components/top100-video-link.tsx"),
  shellDynamic: path.join(ROOT, "apps/web/components/shell-dynamic.tsx"),
  currentVideoRoute: path.join(ROOT, "apps/web/app/api/current-video/route.ts"),
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

function main() {
  const failures = [];

  const top100PageSource = read(files.top100Page);
  const top100LinkSource = read(files.top100Link);
  const shellDynamicSource = read(files.shellDynamic);
  const currentVideoRouteSource = read(files.currentVideoRoute);

  // Top 100 page should render warmed link component (not a plain Link card).
  assertContains(top100PageSource, 'import { Top100VideoLink } from "@/components/top100-video-link";', "Top 100 page imports warmed link component", failures);
  assertContains(top100PageSource, "<Top100VideoLink key={track.id} track={track} index={index} />", "Top 100 page renders warmed link component per item", failures);

  // Warmed handoff invariants in the top100 link component.
  assertContains(top100LinkSource, "const PENDING_VIDEO_SELECTION_KEY = \"ytr:pending-video-selection\";", "Top 100 warmed link uses pending selection cache key", failures);
  assertContains(top100LinkSource, "window.sessionStorage.setItem(", "Top 100 warmed link writes optimistic pending selection", failures);
  assertContains(top100LinkSource, "void fetch(`/api/current-video?v=${encodeURIComponent(track.id)}`", "Top 100 warmed link prefetches current-video payload", failures);
  assertContains(top100LinkSource, "href={`/?v=${track.id}&resume=1`}", "Top 100 warmed link navigates with v+resume query", failures);
  assertContains(top100LinkSource, "onMouseEnter={warmSelection}", "Top 100 warmed link warms on hover", failures);
  assertContains(top100LinkSource, "onFocus={warmSelection}", "Top 100 warmed link warms on focus", failures);
  assertContains(top100LinkSource, "onPointerDown={warmSelection}", "Top 100 warmed link warms on pointer-down", failures);
  assertContains(top100LinkSource, "onClick={warmSelection}", "Top 100 warmed link warms on click", failures);

  // Resolver deadlock fix invariants for denied responses and in-flight short-circuit guard.
  assertContains(shellDynamicSource, "if (data?.denied?.message) {", "Requested-video resolver handles denied payload branch", failures);
  assertContains(shellDynamicSource, "setIsResolvingRequestedVideo(false);", "Denied branch clears requested-video resolving state", failures);
  assertContains(shellDynamicSource, "currentVideo.id === requestedVideoId", "In-flight short-circuit guard checks current video id", failures);
  assertContains(shellDynamicSource, "!isResolvingRequestedVideo", "In-flight short-circuit guard checks resolver state", failures);

  // Watch Next rail and sparse-related fallback padding invariants.
  assertContains(shellDynamicSource, "Watch Next", "Player shell labels related rail as Watch Next", failures);
  assertContains(currentVideoRouteSource, "getTopVideos", "Current video route imports top videos for related fallback", failures);
  assertContains(currentVideoRouteSource, "relatedVideos.length < targetRelatedCount", "Current video route pads sparse related list", failures);
  assertContains(currentVideoRouteSource, "const targetRelatedCount = 10;", "Current video route pads Watch Next up to 10 items", failures);
  assertContains(currentVideoRouteSource, "new Set([currentVideo.id, ...relatedVideos.map((video) => video.id)])", "Current video route excludes current and existing related ids from filler", failures);
  assertContains(currentVideoRouteSource, "paddedRelatedVideos = [...relatedVideos, ...filler];", "Current video route appends randomized filler items", failures);
  assertContains(shellDynamicSource, "const watchNextRailRef = useRef<HTMLElement | null>(null);", "Watch Next rail has a dedicated ref for scroll control", failures);
  assertContains(shellDynamicSource, "watchNextRailRef.current.scrollTop = 0;", "Watch Next rail resets to top when reloading", failures);
  assertContains(shellDynamicSource, "ref={watchNextRailRef}", "Watch Next rail element is bound to the scroll ref", failures);

  if (failures.length > 0) {
    console.error("Top 100 UI invariant check failed.");
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }

  console.log("Top 100 UI invariant check passed.");
}

main();
