#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const ROOT = process.cwd();

const files = {
  shellDynamic: path.join(ROOT, "apps/web/components/shell-dynamic.tsx"),
  playerExperience: path.join(ROOT, "apps/web/components/player-experience.tsx"),
  chatRoute: path.join(ROOT, "apps/web/app/api/chat/route.ts"),
  chatStreamRoute: path.join(ROOT, "apps/web/app/api/chat/stream/route.ts"),
  currentVideoRoute: path.join(ROOT, "apps/web/app/api/current-video/route.ts"),
  css: path.join(ROOT, "apps/web/app/globals.css"),
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

  const shellDynamicSource = read(files.shellDynamic);
  const playerExperienceSource = read(files.playerExperience);
  const chatRouteSource = read(files.chatRoute);
  const chatStreamRouteSource = read(files.chatStreamRoute);
  const currentVideoRouteSource = read(files.currentVideoRoute);
  const cssSource = read(files.css);

  // Watch Next and current-video resolver invariants.
  assertContains(shellDynamicSource, "<div className=\"railTabs rightRailTabs\">", "Shell renders right rail tabs container", failures);
  assertContains(shellDynamicSource, "Watch Next", "Shell labels a right rail tab as Watch Next", failures);
  assertContains(shellDynamicSource, "Playlist", "Shell labels a right rail tab as Playlist", failures);
  assertContains(shellDynamicSource, "const [relatedTransitionPhase, setRelatedTransitionPhase] = useState<\"idle\" | \"fading-out\" | \"loading\" | \"fading-in\">(\"idle\");", "Watch Next uses explicit transition phases", failures);
  assertContains(shellDynamicSource, "watchNextRailRef.current.scrollTop = 0;", "Watch Next resets scroll top during transition", failures);
  assertContains(currentVideoRouteSource, "const targetRelatedCount = 10;", "Current-video API targets 10 Watch Next items", failures);
  assertContains(currentVideoRouteSource, "const topVideos = await getTopVideos(100);", "Current-video API fetches Top 100 filler pool", failures);
  assertContains(currentVideoRouteSource, "const filler = shuffleVideos(fillerPool).slice(0, targetRelatedCount - relatedVideos.length);", "Current-video API randomizes sparse filler selection", failures);

  // Player invariants.
  assertContains(playerExperienceSource, "const AUTOPLAY_KEY = \"yeh-player-autoplay\";", "Player persists autoplay preference key", failures);
  assertContains(playerExperienceSource, "const RESUME_KEY = \"yeh-player-resume\";", "Player defines resume snapshot key", failures);
  assertContains(playerExperienceSource, "window.localStorage.setItem(AUTOPLAY_KEY, String(nextValue));", "Player writes autoplay preference to localStorage", failures);
  assertContains(playerExperienceSource, "const activePlaylistId = searchParams.get(\"pl\");", "Player reads playlist context from query params", failures);
  assertContains(playerExperienceSource, "const response = await fetch(`/api/playlists/${encodeURIComponent(activePlaylistId)}`, {", "Player loads playlist sequence for ordered playback", failures);
  assertContains(playerExperienceSource, "const shouldUseTopFallback =", "Player uses Top 100 fallback when Watch Next pool is small", failures);
  assertContains(playerExperienceSource, "const shouldAutoAdvance =", "Player computes auto-advance using playlist/deep-link/autoplay guard", failures);
  assertContains(playerExperienceSource, "const [showEndedChoiceOverlay, setShowEndedChoiceOverlay] = useState(false);", "Player tracks autoplay-off end chooser overlay state", failures);
  assertContains(playerExperienceSource, "setShowEndedChoiceOverlay(true);", "Player opens chooser overlay when autoplay-off playback ends", failures);
  assertContains(playerExperienceSource, "className=\"playerEndedChoiceOverlay\"", "Player renders chooser overlay container", failures);
  assertContains(playerExperienceSource, "className=\"playerEndedChoiceGrid\"", "Player renders chooser overlay grid", failures);
  assertContains(playerExperienceSource, "const maxEndedChoiceVideos = 12;", "Player caps chooser cards to 12 for larger screens", failures);
  assertContains(playerExperienceSource, "autoplayEnabledRef.current &&", "Player only auto-advances when autoplay is enabled", failures);
  assertContains(cssSource, ".playerEndedChoiceOverlay", "Chooser overlay styles are defined", failures);
  assertContains(cssSource, ".playerEndedChoiceGrid", "Chooser overlay grid styles are defined", failures);
  assertContains(cssSource, "@media (min-width: 2200px)", "Chooser overlay defines ultrawide breakpoint", failures);
  assertContains(cssSource, "grid-template-columns: repeat(6, minmax(0, 1fr));", "Chooser overlay uses 6 columns on ultrawide for two rows", failures);
  assertContains(playerExperienceSource, "const shouldAutoplaySelection = Boolean(requestedVideoId && requestedVideoId === currentVideo.id);", "Player only autoplays when requested id matches loaded video", failures);
  assertContains(playerExperienceSource, "showUnavailableOverlayMessage();", "Player shows unavailable apology overlay when runtime checks fail", failures);
  assertContains(playerExperienceSource, "const response = await fetch(\"/api/videos/unavailable\", {", "Player reports unavailable videos to API", failures);
  assertContains(playerExperienceSource, "setPlayerHostMode(\"youtube\");", "Player retries restricted videos with youtube host fallback", failures);

  // Player hover-controls recovery invariants.
  assertContains(playerExperienceSource, "playerFrameRef.current?.matches(\":hover\")", "Player checks real hover state via :hover pseudo-class after pathname change", failures);
  assertContains(playerExperienceSource, "window.setTimeout(() => {", "Player defers hover state check to allow synthetic mouseleave events to fire first", failures);
  assertContains(playerExperienceSource, "return () => window.clearTimeout(id);", "Player cleans up hover-check timeout on effect teardown", failures);

  // Denied deep-link loop guard invariants.
  assertContains(shellDynamicSource, "const deniedRequestedVideoIdRef = useRef<string | null>(null);", "Shell tracks denied requested video ids", failures);
  assertContains(shellDynamicSource, "if (deniedRequestedVideoIdRef.current === requestedVideoId) {", "Shell skips repeated denied requested video resolution", failures);
  assertContains(shellDynamicSource, "params.delete(\"v\");", "Shell clears denied video id from query params", failures);
  assertContains(shellDynamicSource, "params.delete(\"resume\");", "Shell clears resume marker when denied video id is removed", failures);

  // Chat UI invariants.
  assertContains(shellDynamicSource, "const globalEvents = new EventSource(\"/api/chat/stream?mode=global\");", "Shell subscribes to global chat stream", failures);
  assertContains(shellDynamicSource, "const videoEvents = new EventSource(`/api/chat/stream?mode=video&videoId=${encodeURIComponent(currentVideo.id)}`);", "Shell subscribes to video chat stream", failures);
  assertContains(shellDynamicSource, "const response = await fetchWithAuthRetry(`/api/chat?${params.toString()}`);", "Shell loads chat via authenticated API call", failures);
  assertContains(shellDynamicSource, "const response = await fetchWithAuthRetry(\"/api/chat\", {", "Shell posts chat messages via authenticated API call", failures);
  assertContains(shellDynamicSource, "videoId: chatMode === \"video\" ? currentVideo.id : undefined,", "Shell sends video chat context when posting", failures);
  assertContains(shellDynamicSource, "node.scrollTop = node.scrollHeight;", "Shell auto-scrolls chat list to latest message", failures);

  // Chat API invariants.
  assertContains(chatRouteSource, "const authResult = await requireApiAuth(request);", "Chat REST API requires authenticated session", failures);
  assertContains(chatRouteSource, "mode: z.enum([\"global\", \"video\", \"online\"]).default(\"global\"),", "Chat GET schema validates supported chat modes", failures);
  assertContains(chatRouteSource, "mode: z.enum([\"global\", \"video\"]),", "Chat POST schema restricts writable modes", failures);
  assertContains(chatRouteSource, "content: z.string().trim().min(1).max(200),", "Chat POST enforces message length limits", failures);
  assertContains(chatRouteSource, "chatEvents.emit(chatChannel(mode, mode === \"video\" ? (videoId ?? null) : null), mapped);", "Chat POST emits events to room channel", failures);
  assertContains(chatRouteSource, "return NextResponse.json({ ok: true, message: mapped }, { status: 201 });", "Chat POST returns created message payload", failures);

  // Chat stream API invariants.
  assertContains(chatStreamRouteSource, "const authResult = await requireApiAuth(request);", "Chat stream API requires authenticated session", failures);
  assertContains(chatStreamRouteSource, "const stream = new ReadableStream({", "Chat stream API uses SSE readable stream", failures);
  assertContains(chatStreamRouteSource, "controller.enqueue(encoder.encode(\": heartbeat\\n\\n\"));", "Chat stream API emits heartbeat comments", failures);
  assertContains(chatStreamRouteSource, "\"Content-Type\": \"text/event-stream\"", "Chat stream API sets SSE content type", failures);

  if (failures.length > 0) {
    console.error("Core experience invariant check failed.");
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }

  console.log("Core experience invariant check passed.");
}

main();
