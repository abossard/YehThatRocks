"use client";

import { ChangeEvent, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import type { VideoRecord } from "@/lib/catalog";
import { buildSharedVideoMessage } from "@/lib/chat-shared-video";
import { ArtistWikiLink } from "@/components/artist-wiki-link";
import { buildCanonicalShareUrl } from "@/lib/share-metadata";

type PlayerExperienceProps = {
  currentVideo: VideoRecord;
  queue: VideoRecord[];
  isLoggedIn: boolean;
};

type PlaylistPayload = {
  id: string;
  videos: VideoRecord[];
};

type NextChoiceVideo = VideoRecord;

type YouTubePlayerStateChangeEvent = {
  data: number;
};

type YouTubePlayerErrorEvent = {
  data: number;
};

type YouTubePlayerReadyEvent = {
  target: YouTubePlayer;
};

type YouTubePlayer = {
  destroy: () => void;
  cueVideoById?: (videoId: string) => void;
  cueVideoByUrl?: (url: string) => void;
  getCurrentTime: () => number;
  getDuration: () => number;
  getPlayerState: () => number;
  getVolume: () => number;
  isMuted: () => boolean;
  loadVideoById: (videoId: string) => void;
  loadVideoByUrl?: (url: string) => void;
  mute: () => void;
  pauseVideo: () => void;
  playVideo: () => void;
  seekTo: (seconds: number, allowSeekAhead: boolean) => void;
  setVolume: (volume: number) => void;
  unMute: () => void;
};

type YouTubeNamespace = {
  Player: new (
    element: HTMLDivElement,
    config: {
      videoId: string;
      host?: string;
      playerVars?: Record<string, number | string>;
      events?: {
        onReady?: (event: YouTubePlayerReadyEvent) => void;
        onStateChange?: (event: YouTubePlayerStateChangeEvent) => void;
        onError?: (event: YouTubePlayerErrorEvent) => void;
      };
    }
  ) => YouTubePlayer;
  PlayerState: {
    ENDED: number;
    PAUSED: number;
    PLAYING: number;
  };
};

declare global {
  interface Window {
    YT?: YouTubeNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

const AUTOPLAY_KEY = "yeh-player-autoplay";
const HISTORY_KEY = "yeh-player-history";
const RESUME_KEY = "yeh-player-resume";
const HISTORY_LIMIT = 20;
const RANDOM_NEXT_RECENT_EXCLUSION = 6;
const RANDOM_NEXT_MIN_WATCH_NEXT_POOL = 5;
const UNAVAILABLE_PLAYER_CODES = new Set([5, 100, 101, 150]);
const PLAYER_DEBUG_ENABLED = process.env.NODE_ENV === "development" && process.env.NEXT_PUBLIC_DEBUG_PLAYER === "1";
const FLOW_DEBUG_ENABLED = process.env.NODE_ENV === "development" && process.env.NEXT_PUBLIC_DEBUG_FLOW === "1";
const UNAVAILABLE_OVERLAY_MESSAGE = "Sorry, this video is no longer available. Please choose another track.";
const PLAYLISTS_UPDATED_EVENT = "ytr:playlists-updated";

if (process.env.NODE_ENV === "development" && typeof window !== "undefined") {
  const consoleWithPatchState = console as typeof console & {
    __ytrWarnPatched?: boolean;
  };

  if (!consoleWithPatchState.__ytrWarnPatched) {
    const originalWarn = console.warn.bind(console);
    consoleWithPatchState.__ytrWarnPatched = true;

    console.warn = (...args: unknown[]) => {
      const first = args[0];
      const message = typeof first === "string" ? first : "";

      // YouTube widget emits this repeatedly in some browsers; hide this known non-actionable warning.
      if (message.includes("Unrecognized feature: 'web-share'.")) {
        return;
      }

      originalWarn(...args);
    };
  }
}

function logPlayerDebug(event: string, detail?: Record<string, unknown>) {
  if (!PLAYER_DEBUG_ENABLED) {
    return;
  }

  const payload = detail ? ` ${JSON.stringify(detail)}` : "";
  console.log(`[player] ${event}${payload}`);
}

function logFlow(event: string, detail?: Record<string, unknown>) {
  if (!FLOW_DEBUG_ENABLED) {
    return;
  }

  const payload = detail ? ` ${JSON.stringify(detail)}` : "";
  console.log(`[flow/player] ${event}${payload}`);
}

function toSafeNumber(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function formatPlaybackTime(value: number) {
  const safeValue = Math.max(0, Math.floor(toSafeNumber(value, 0)));
  const hours = Math.floor(safeValue / 3600);
  const minutes = Math.floor((safeValue % 3600) / 60);
  const seconds = safeValue % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function switchPlayerVideo(player: YouTubePlayer, videoId: string) {
  const playerWithFallbacks = player as YouTubePlayer & {
    cueVideoById?: (id: string) => void;
    loadVideoByUrl?: (url: string) => void;
    cueVideoByUrl?: (url: string) => void;
  };

  if (typeof playerWithFallbacks.loadVideoById === "function") {
    playerWithFallbacks.loadVideoById(videoId);
    return true;
  }

  if (typeof playerWithFallbacks.cueVideoById === "function") {
    playerWithFallbacks.cueVideoById(videoId);
    return true;
  }

  const watchUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;

  if (typeof playerWithFallbacks.loadVideoByUrl === "function") {
    playerWithFallbacks.loadVideoByUrl(watchUrl);
    return true;
  }

  if (typeof playerWithFallbacks.cueVideoByUrl === "function") {
    playerWithFallbacks.cueVideoByUrl(watchUrl);
    return true;
  }

  return false;
}

export function PlayerExperience({ currentVideo, queue, isLoggedIn }: PlayerExperienceProps) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedVideoId = searchParams.get("v");
  const activePlaylistId = searchParams.get("pl");
  const rawPlaylistItemIndex = searchParams.get("pli");
  const activePlaylistItemIndex =
    rawPlaylistItemIndex !== null && /^\d+$/.test(rawPlaylistItemIndex)
      ? Number(rawPlaylistItemIndex)
      : null;
  const playerElementRef = useRef<HTMLDivElement | null>(null);
  const playerFrameRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<YouTubePlayer | null>(null);
  const overlayTimeoutRef = useRef<number | null>(null);
  const unavailableOverlayTimeoutRef = useRef<number | null>(null);
  const initialRequestedVideoIdRef = useRef<string | null>(requestedVideoId);
  const hasLeftInitialRequestedVideoRef = useRef(false);
  const isBootstrappingHistoryRef = useRef(true);
  const previousVideoIdRef = useRef<string | null>(null);
  const favouriteSaveTimeoutRef = useRef<number | null>(null);
  const shareToChatResetTimeoutRef = useRef<number | null>(null);
  const [autoplayEnabled, setAutoplayEnabled] = useState(false);
  const [copied, setCopied] = useState(false);
  const [shareToChatState, setShareToChatState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [favouriteSaveState, setFavouriteSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [historyStack, setHistoryStack] = useState<string[]>([]);
  const [showNowPlayingOverlay, setShowNowPlayingOverlay] = useState(false);
  const [unavailableOverlayMessage, setUnavailableOverlayMessage] = useState<string | null>(null);
  const [showEndedChoiceOverlay, setShowEndedChoiceOverlay] = useState(false);
  const [overlayInstance, setOverlayInstance] = useState(0);
  const [playerHostMode, setPlayerHostMode] = useState<"nocookie" | "youtube">("nocookie");
  const [isPlayerReady, setIsPlayerReady] = useState(false);
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [volume, setVolume] = useState(100);
    const [isMuted, setIsMuted] = useState(false);
    const [showControls, setShowControls] = useState(false);
    const [hasPlaybackStarted, setHasPlaybackStarted] = useState(false);
    const [showShareMenu, setShowShareMenu] = useState(false);
    const [showShareModal, setShowShareModal] = useState(false);
    const [shareModalCopied, setShareModalCopied] = useState(false);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [isScrubbing, setIsScrubbing] = useState(false);
    const progressIntervalRef = useRef<number | null>(null);
    const nowPlayingShownForVideoRef = useRef<string | null>(null);
    const reportedUnavailableVideoIdRef = useRef<string | null>(null);
    const autoplaySuppressedVideoIdRef = useRef<string | null>(null);
    const playAttemptedAtRef = useRef<number | null>(null);
    const nextVideoIdRef = useRef<string>(currentVideo.id);
    const nextPlaylistIndexRef = useRef<number | null>(null);
    const activePlaylistIdRef = useRef<string | null>(activePlaylistId);
  const [playlistQueueIds, setPlaylistQueueIds] = useState<string[]>([]);
  const [playlistRefreshTick, setPlaylistRefreshTick] = useState(0);
  const [topFallbackVideos, setTopFallbackVideos] = useState<VideoRecord[]>([]);
  const autoplayEnabledRef = useRef(autoplayEnabled);
  const hasActivePlaylistSequenceRef = useRef(false);
  autoplayEnabledRef.current = autoplayEnabled;
  activePlaylistIdRef.current = activePlaylistId;

  function handleFullscreenToggle() {
    if (!document.fullscreenElement) {
      playerFrameRef.current?.requestFullscreen();
    } else {
      document.exitFullscreen();
    }
  }

  useEffect(() => {
    function onFullscreenChange() {
      setIsFullscreen(!!document.fullscreenElement);
    }
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  useEffect(() => {
    return () => {
      if (shareToChatResetTimeoutRef.current !== null) {
        window.clearTimeout(shareToChatResetTimeoutRef.current);
        shareToChatResetTimeoutRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!showShareModal) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setShowShareModal(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [showShareModal]);

  const playlistCurrentIndex = playlistQueueIds.findIndex((videoId) => videoId === currentVideo.id);
  const effectivePlaylistIndex =
    activePlaylistItemIndex !== null &&
    activePlaylistItemIndex >= 0 &&
    activePlaylistItemIndex < playlistQueueIds.length
      ? activePlaylistItemIndex
      : playlistCurrentIndex >= 0
        ? playlistCurrentIndex
        : null;
  const hasActivePlaylistSequence = Boolean(
    activePlaylistId &&
      playlistQueueIds.length > 0 &&
      effectivePlaylistIndex !== null,
  );
  hasActivePlaylistSequenceRef.current = hasActivePlaylistSequence;

  useEffect(() => {
    let cancelled = false;

    async function loadTopFallbackPool() {
      try {
        const response = await fetch("/api/videos/top?count=100", {
          cache: "no-store",
        });

        if (!response.ok) {
          return;
        }

        const payload = (await response.json().catch(() => null)) as
          | {
              videos?: VideoRecord[];
            }
          | null;

        const ids = Array.isArray(payload?.videos)
          ? payload.videos.filter((video): video is VideoRecord => Boolean(video?.id))
          : [];

        if (!cancelled) {
          setTopFallbackVideos(ids);
        }
      } catch {
        // Keep existing fallback pool if loading fails.
      }
    }

    void loadTopFallbackPool();

    return () => {
      cancelled = true;
    };
  }, []);

  function getRandomWatchNextId() {
    const candidateIds = Array.from(new Set(queue.map((video) => video.id))).filter(
      (videoId) => videoId !== currentVideo.id,
    );

    // Avoid recently played videos when possible so random-next feels fresh.
    const recentIds = Array.from(new Set([...historyStack].reverse()))
      .filter((videoId) => videoId !== currentVideo.id)
      .slice(0, RANDOM_NEXT_RECENT_EXCLUSION);
    const recentIdSet = new Set(recentIds);
    const topFallbackVideoIds = Array.from(new Set(topFallbackVideos.map((video) => video.id))).filter(Boolean);

    const shouldUseTopFallback =
      candidateIds.length > 0 && candidateIds.length < RANDOM_NEXT_MIN_WATCH_NEXT_POOL && topFallbackVideoIds.length > 0;

    const topFallbackCandidateIds = shouldUseTopFallback
      ? topFallbackVideoIds.filter((videoId) => videoId !== currentVideo.id)
      : [];

    const freshCandidateIds = candidateIds.filter((videoId) => !recentIdSet.has(videoId));
    const freshTopFallbackIds = topFallbackCandidateIds.filter((videoId) => !recentIdSet.has(videoId));

    const selectionPool = shouldUseTopFallback
      ? (freshTopFallbackIds.length > 0 ? freshTopFallbackIds : topFallbackCandidateIds)
      : (freshCandidateIds.length > 0 ? freshCandidateIds : candidateIds);

    if (selectionPool.length === 0) {
      return null;
    }

    const randomIndex = Math.floor(Math.random() * selectionPool.length);
    return selectionPool[randomIndex] ?? null;
  }

  function resolveNextTarget() {
    if (hasActivePlaylistSequence && effectivePlaylistIndex !== null) {
      const nextIndex = (effectivePlaylistIndex + 1) % playlistQueueIds.length;
      const nextId = playlistQueueIds[nextIndex] ?? null;

      if (nextId) {
        return {
          videoId: nextId,
          playlistItemIndex: nextIndex,
          clearPlaylist: false,
        };
      }
    }

    const randomWatchNextId = getRandomWatchNextId();

    if (!randomWatchNextId) {
      return null;
    }

    return {
      videoId: randomWatchNextId,
      playlistItemIndex: null,
      clearPlaylist: true,
    };
  }

  const resolvedNextTarget = resolveNextTarget();
  nextVideoIdRef.current = resolvedNextTarget?.videoId ?? currentVideo.id;
  nextPlaylistIndexRef.current = resolvedNextTarget?.playlistItemIndex ?? null;

  const hasPreviousTrack = hasActivePlaylistSequence
    ? playlistQueueIds.length > 1
    : historyStack.length >= 2;
  const safeDuration = Math.max(0, toSafeNumber(duration, 0));
  const safeCurrentTime = Math.max(0, Math.min(toSafeNumber(currentTime, 0), safeDuration || Number.MAX_SAFE_INTEGER));
  const progressPercent = safeDuration > 0 ? Math.min(100, Math.max(0, (safeCurrentTime / safeDuration) * 100)) : 0;
  const elapsedLabel = formatPlaybackTime(safeCurrentTime);
  const durationLabel = formatPlaybackTime(safeDuration);
  const shareUrl = buildCanonicalShareUrl(currentVideo.id);
  const hasArtistName = Boolean(currentVideo.channelTitle && currentVideo.channelTitle.trim().length > 0);
  const socialShareTargets = [
    {
      id: "x",
      label: "Share on X",
      href: `https://twitter.com/intent/tweet?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(currentVideo.title)}`,
    },
    {
      id: "facebook",
      label: "Share on Facebook",
      href: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}`,
    },
    {
      id: "reddit",
      label: "Share on Reddit",
      href: `https://www.reddit.com/submit?url=${encodeURIComponent(shareUrl)}&title=${encodeURIComponent(currentVideo.title)}`,
    },
    {
      id: "linkedin",
      label: "Share on LinkedIn",
      href: `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(shareUrl)}`,
    },
    {
      id: "whatsapp",
      label: "Share on WhatsApp",
      href: `https://api.whatsapp.com/send?text=${encodeURIComponent(`${currentVideo.title} ${shareUrl}`)}`,
    },
    {
      id: "telegram",
      label: "Share on Telegram",
      href: `https://t.me/share/url?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(currentVideo.title)}`,
    },
    {
      id: "email",
      label: "Share by Email",
      href: `mailto:?subject=${encodeURIComponent(currentVideo.title)}&body=${encodeURIComponent(`Check this out: ${shareUrl}`)}`,
    },
  ] as const;
  const shouldAutoplaySelection = Boolean(requestedVideoId && requestedVideoId === currentVideo.id);
  const endedChoiceVideos = (() => {
    const maxEndedChoiceVideos = 12;
    const deduped = new Map<string, NextChoiceVideo>();

    for (const video of [...queue, ...topFallbackVideos]) {
      if (!video?.id || video.id === currentVideo.id || deduped.has(video.id)) {
        continue;
      }

      deduped.set(video.id, video);

      if (deduped.size >= maxEndedChoiceVideos) {
        break;
      }
    }

    return [...deduped.values()];
  })();

  useEffect(() => {
    const initialRequestedVideoId = initialRequestedVideoIdRef.current;

    if (!initialRequestedVideoId) {
      return;
    }

    if (currentVideo.id !== initialRequestedVideoId) {
      hasLeftInitialRequestedVideoRef.current = true;
    }
  }, [currentVideo.id]);

  useEffect(() => {
    const handlePlaylistsUpdated = () => {
      setPlaylistRefreshTick((current) => current + 1);
    };

    window.addEventListener(PLAYLISTS_UPDATED_EVENT, handlePlaylistsUpdated);

    return () => {
      window.removeEventListener(PLAYLISTS_UPDATED_EVENT, handlePlaylistsUpdated);
    };
  }, []);

  useEffect(() => {
    if (!isLoggedIn || !activePlaylistId) {
      setPlaylistQueueIds([]);
      return;
    }

    const playlistId = activePlaylistId;

    let cancelled = false;

    async function loadPlaylistSequence() {
      try {
        const response = await fetch(`/api/playlists/${encodeURIComponent(playlistId)}`, {
          cache: "no-store",
        });

        if (!response.ok) {
          if (!cancelled) {
            setPlaylistQueueIds([]);
          }
          return;
        }

        const payload = (await response.json().catch(() => null)) as PlaylistPayload | null;

        if (!payload || !Array.isArray(payload.videos)) {
          if (!cancelled) {
            setPlaylistQueueIds([]);
          }
          return;
        }

        const sequenceIds = payload.videos
          .map((video) => video.id)
          .filter((id): id is string => Boolean(id));

        if (!cancelled) {
          setPlaylistQueueIds(sequenceIds);
        }
      } catch {
        if (!cancelled) {
          setPlaylistQueueIds([]);
        }
      }
    }

    void loadPlaylistSequence();

    return () => {
      cancelled = true;
    };
  }, [activePlaylistId, isLoggedIn, playlistRefreshTick]);

  function persistResumeSnapshot(wasPlaying: boolean, explicitTime?: number) {
    if (typeof window === "undefined") {
      return;
    }

    const runtimePlayer = playerRef.current;
    const canReadTime = typeof runtimePlayer?.getCurrentTime === "function";

    const time =
      explicitTime ??
      (canReadTime ? runtimePlayer.getCurrentTime() : undefined) ??
      currentTime;

    window.sessionStorage.setItem(
      RESUME_KEY,
      JSON.stringify({
        savedAt: Date.now(),
        time,
        videoId: currentVideo.id,
        wasPlaying,
      }),
    );
  }

  function triggerNowPlayingOverlay() {
    if (overlayTimeoutRef.current) {
      window.clearTimeout(overlayTimeoutRef.current);
    }

    setOverlayInstance((value) => value + 1);
    setShowNowPlayingOverlay(true);

    overlayTimeoutRef.current = window.setTimeout(() => {
      setShowNowPlayingOverlay(false);
    }, 3200);
  }

  function showUnavailableOverlayMessage() {
    if (unavailableOverlayTimeoutRef.current) {
      window.clearTimeout(unavailableOverlayTimeoutRef.current);
    }

    setUnavailableOverlayMessage(UNAVAILABLE_OVERLAY_MESSAGE);

    unavailableOverlayTimeoutRef.current = window.setTimeout(() => {
      setUnavailableOverlayMessage(null);
      unavailableOverlayTimeoutRef.current = null;
    }, 6200);
  }

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const savedAutoplay = window.localStorage.getItem(AUTOPLAY_KEY);
    const savedHistory = window.sessionStorage.getItem(HISTORY_KEY);

    setAutoplayEnabled(savedAutoplay === "true");

    if (savedHistory) {
      try {
        const parsedHistory = JSON.parse(savedHistory) as string[];
        setHistoryStack(parsedHistory);
      } catch {
        window.sessionStorage.removeItem(HISTORY_KEY);
      }
    }

    isBootstrappingHistoryRef.current = false;
  }, []);

  useEffect(() => {
    if (isBootstrappingHistoryRef.current) {
      return;
    }

    setHistoryStack((currentHistory) => {
      if (currentHistory[currentHistory.length - 1] === currentVideo.id) {
        previousVideoIdRef.current = currentVideo.id;
        return currentHistory;
      }

      const nextHistory = [...currentHistory, currentVideo.id].slice(-HISTORY_LIMIT);
      window.sessionStorage.setItem(HISTORY_KEY, JSON.stringify(nextHistory));
      previousVideoIdRef.current = currentVideo.id;
      return nextHistory;
    });
  }, [currentVideo.id]);

  useEffect(() => {
    nowPlayingShownForVideoRef.current = null;
    reportedUnavailableVideoIdRef.current = null;
    autoplaySuppressedVideoIdRef.current = null;
    playAttemptedAtRef.current = null;
    setUnavailableOverlayMessage(null);
    setShowEndedChoiceOverlay(false);
    setHasPlaybackStarted(false);
    setShowControls(false);
    logFlow("current-video:changed", {
      currentVideoId: currentVideo.id,
      queueSize: queue.length,
    });
  }, [currentVideo.id]);

  useEffect(() => {
    // When an overlay page closes, the pointer may already be over the player.
    // Defer until after synthetic mouseleave events from removed DOM nodes have fired,
    // then check real hover state so we only show controls if the mouse is actually there.
    if (pathname === "/") {
      const id = window.setTimeout(() => {
        if (playerFrameRef.current?.matches(":hover")) {
          setShowControls(true);
        }
      }, 0);
      return () => window.clearTimeout(id);
    }
  }, [pathname]);

  useEffect(() => {
    if (!isPlayerReady || isPlaying || !playAttemptedAtRef.current) {
      return;
    }

    const timeoutId = window.setTimeout(async () => {
      const player = playerRef.current;
      const attemptedAt = playAttemptedAtRef.current;

      if (!player || !attemptedAt || isPlaying) {
        return;
      }

      const state = typeof player.getPlayerState === "function" ? player.getPlayerState() : -1;
      const durationValue =
        typeof player.getDuration === "function" ? toSafeNumber(player.getDuration(), 0) : 0;
      const stillBlocked = state !== window.YT?.PlayerState.PLAYING && durationValue <= 0;

      if (!stillBlocked) {
        return;
      }

      const shouldSkip = await reportUnavailableFromPlayer("yt-player-runtime-blocked-or-age-restricted");

      logPlayerDebug("runtime-block-check", {
        videoId: currentVideo.id,
        playerHostMode,
        shouldSkip,
        durationValue,
        state,
      });

      if (shouldSkip) {
        autoplaySuppressedVideoIdRef.current = currentVideo.id;
        playAttemptedAtRef.current = null;
        showUnavailableOverlayMessage();
      }
    }, 4500);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [currentVideo.id, isPlayerReady, isPlaying, playerHostMode]);

  async function reportUnavailableFromPlayer(reason: string) {
    if (reportedUnavailableVideoIdRef.current === currentVideo.id) {
      logPlayerDebug("report-unavailable:already-reported", {
        videoId: currentVideo.id,
        reason,
      });
      return false;
    }

    reportedUnavailableVideoIdRef.current = currentVideo.id;

    try {
      const response = await fetch("/api/videos/unavailable", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          videoId: currentVideo.id,
          reason,
        }),
      });

      const payload = (await response.json().catch(() => null)) as
        | {
            ok?: boolean;
            skipped?: boolean;
            reason?: string;
          }
        | null;

      logPlayerDebug("report-unavailable:response", {
        videoId: currentVideo.id,
        reason,
        httpStatus: response.status,
        responseOk: response.ok,
        payload,
      });

      return Boolean(response.ok && payload?.ok && payload?.skipped !== true);
    } catch {
      // best-effort runtime reporting
      logPlayerDebug("report-unavailable:network-error", {
        videoId: currentVideo.id,
        reason,
      });
      return false;
    }
  }

  useEffect(() => {
    setIsPlayerReady(false);
    setIsPlaying(false);
    setCurrentTime(0);

    logPlayerDebug("player-effect:start", {
      videoId: currentVideo.id,
      playerHostMode,
      queueSize: queue.length,
    });

    if (typeof window === "undefined" || !playerElementRef.current) {
      return;
    }

    let cancelled = false;
    const embedOrigin = window.location.origin;

    const createPlayer = () => {
      if (!window.YT || !playerElementRef.current || cancelled) {
        return;
      }

      if (playerRef.current) {
        const didSwitch = switchPlayerVideo(playerRef.current, currentVideo.id);

        logFlow("player:switch-existing", {
          currentVideoId: currentVideo.id,
          didSwitch,
        });

        if (didSwitch) {
          setIsPlayerReady(true);

          if (typeof playerRef.current.getDuration === "function") {
            setDuration(toSafeNumber(playerRef.current.getDuration(), 0));
          }

          if (typeof playerRef.current.getVolume === "function") {
            setVolume(toSafeNumber(playerRef.current.getVolume(), 100));
          }

          if (typeof playerRef.current.isMuted === "function") {
            setIsMuted(Boolean(playerRef.current.isMuted()));
          }

          if (shouldAutoplaySelection && autoplaySuppressedVideoIdRef.current !== currentVideo.id) {
            playAttemptedAtRef.current = Date.now();
            window.setTimeout(() => {
              if (!cancelled && playerRef.current) {
                playerRef.current.playVideo();
              }
            }, 0);
          }

          return;
        }

        if (typeof playerRef.current.destroy === "function") {
          playerRef.current.destroy();
        }

        playerRef.current = null;
      }

      playerRef.current = new window.YT.Player(playerElementRef.current, {
        host: playerHostMode === "nocookie" ? "https://www.youtube-nocookie.com" : "https://www.youtube.com",
        videoId: currentVideo.id,
        playerVars: {
          autoplay: 0,
          controls: 0,
          disablekb: 1,
          enablejsapi: 1,
          fs: 0,
          iv_load_policy: 3,
          modestbranding: 1,
          origin: embedOrigin,
          playsinline: 1,
          rel: 0,
        },
        events: {
          onReady: (event) => {
            logFlow("player:onReady", {
              currentVideoId: currentVideo.id,
            });
            setIsPlayerReady(true);
            setVolume(toSafeNumber(event.target.getVolume(), 100));
            setDuration(toSafeNumber(event.target.getDuration(), 0));

            logPlayerDebug("onReady", {
              videoId: currentVideo.id,
              playerHostMode,
              duration: toSafeNumber(event.target.getDuration(), 0),
              volume: toSafeNumber(event.target.getVolume(), 100),
            });

            const shouldResume = searchParams.get("resume") === "1";

            if (shouldResume) {
              const rawSnapshot = window.sessionStorage.getItem(RESUME_KEY);

              if (rawSnapshot) {
                try {
                  const parsed = JSON.parse(rawSnapshot) as {
                    savedAt?: number;
                    time?: number;
                    videoId?: string;
                    wasPlaying?: boolean;
                  };

                  if (parsed.videoId === currentVideo.id) {
                    const safeTime = Math.max(0, Math.min(parsed.time ?? 0, event.target.getDuration() || 0));

                    if (safeTime > 0) {
                      event.target.seekTo(safeTime, true);
                      setCurrentTime(safeTime);
                    }

                    if (parsed.wasPlaying) {
                      event.target.playVideo();
                    }
                  }
                } catch {
                  window.sessionStorage.removeItem(RESUME_KEY);
                }
              }

              const params = new URLSearchParams(searchParams.toString());
              params.delete("resume");
              router.replace(`${pathname}?${params.toString()}`);
            }

            if (shouldAutoplaySelection && autoplaySuppressedVideoIdRef.current !== currentVideo.id) {
              playAttemptedAtRef.current = Date.now();
              event.target.playVideo();
            }
          },
          onStateChange: (event) => {
            logFlow("player:onStateChange", {
              currentVideoId: currentVideo.id,
              state: event.data,
            });
            const playing = event.data === window.YT?.PlayerState.PLAYING;
            setIsPlaying(playing);

            if (playerRef.current) {
              const latestTime = toSafeNumber(playerRef.current.getCurrentTime(), 0);
              setCurrentTime(latestTime);
              persistResumeSnapshot(playing, latestTime);
            }

            if (playing) {
              playAttemptedAtRef.current = null;
              setHasPlaybackStarted(true);
              if (nowPlayingShownForVideoRef.current !== currentVideo.id) {
                triggerNowPlayingOverlay();
                nowPlayingShownForVideoRef.current = currentVideo.id;
              }
              if (progressIntervalRef.current) window.clearInterval(progressIntervalRef.current);
              progressIntervalRef.current = window.setInterval(() => {
                if (playerRef.current) {
                  const liveTime = toSafeNumber(playerRef.current.getCurrentTime(), 0);
                  setCurrentTime(liveTime);
                  setDuration(toSafeNumber(playerRef.current.getDuration(), 0));
                  persistResumeSnapshot(true, liveTime);
                }
              }, 500);
            } else {
              if (progressIntervalRef.current) {
                window.clearInterval(progressIntervalRef.current);
                progressIntervalRef.current = null;
              }
            }

            if (event.data === window.YT?.PlayerState.ENDED) {
              const isInitialDeepLinkedVideo = Boolean(
                initialRequestedVideoIdRef.current &&
                  !hasLeftInitialRequestedVideoRef.current &&
                  currentVideo.id === initialRequestedVideoIdRef.current,
              );

              const shouldAutoAdvance =
                autoplayEnabledRef.current &&
                (hasActivePlaylistSequenceRef.current || !isInitialDeepLinkedVideo);

              if (shouldAutoAdvance) {
                navigateToVideo(nextVideoIdRef.current, {
                  clearPlaylist: nextPlaylistIndexRef.current === null,
                  playlistId: activePlaylistIdRef.current,
                  playlistItemIndex: nextPlaylistIndexRef.current,
                });
              } else {
                setShowEndedChoiceOverlay(true);
                setShowControls(true);
                setShowShareMenu(false);
              }
            }
          },
          onError: async (event) => {
            logPlayerDebug("onError", {
              videoId: currentVideo.id,
              playerHostMode,
              errorCode: event.data,
            });

            if (!UNAVAILABLE_PLAYER_CODES.has(event.data)) {
              return;
            }

            if (playerHostMode === "nocookie") {
              // Some videos fail under youtube-nocookie for specific client contexts.
              // Retry once with the standard YouTube host before treating as unavailable.
              if (playerRef.current && typeof playerRef.current.destroy === "function") {
                playerRef.current.destroy();
                playerRef.current = null;
              }

              setIsPlayerReady(false);
              setPlayerHostMode("youtube");
              logPlayerDebug("onError:host-fallback", {
                videoId: currentVideo.id,
                from: "nocookie",
                to: "youtube",
                errorCode: event.data,
              });
              return;
            }

            const reason =
              event.data === 101 || event.data === 150
                ? `yt-player-age-or-owner-restricted-${event.data}`
                : `yt-player-error-${event.data}`;

            const shouldSkip = await reportUnavailableFromPlayer(reason);

            logPlayerDebug("onError:shouldSkip", {
              videoId: currentVideo.id,
              reason,
              shouldSkip,
            });

            if (shouldSkip) {
              autoplaySuppressedVideoIdRef.current = currentVideo.id;
              playAttemptedAtRef.current = null;
              showUnavailableOverlayMessage();
            }
          },
        },
      });
    };

    if (window.YT?.Player) {
      createPlayer();
    } else {
      const existingScript = document.querySelector('script[src="https://www.youtube.com/iframe_api"]');

      if (!existingScript) {
        const script = document.createElement("script");
        script.src = "https://www.youtube.com/iframe_api";
        document.body.appendChild(script);
      }

      const previousReady = window.onYouTubeIframeAPIReady;

      window.onYouTubeIframeAPIReady = () => {
        previousReady?.();
        createPlayer();
      };
    }

    return () => {
      cancelled = true;
    };
  }, [currentVideo.id, playerHostMode]);

  useEffect(() => {
    return () => {
      if (overlayTimeoutRef.current) {
        window.clearTimeout(overlayTimeoutRef.current);
      }

      if (unavailableOverlayTimeoutRef.current) {
        window.clearTimeout(unavailableOverlayTimeoutRef.current);
      }

      if (progressIntervalRef.current) {
        window.clearInterval(progressIntervalRef.current);
      }

      if (playerRef.current) {
        const canReadState = typeof playerRef.current.getPlayerState === "function";
        const wasPlaying = canReadState
          ? playerRef.current.getPlayerState() === window.YT?.PlayerState.PLAYING
          : false;
        persistResumeSnapshot(wasPlaying);
      }

      playerRef.current?.destroy();
      playerRef.current = null;
    };
  }, []);

  function navigateToVideo(
    videoId: string,
    options?: {
      clearPlaylist?: boolean;
      playlistId?: string | null;
      playlistItemIndex?: number | null;
    },
  ) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("v", videoId);

    if (options?.clearPlaylist) {
      params.delete("pl");
      params.delete("pli");
    } else if (options?.playlistId && options.playlistItemIndex !== null && options.playlistItemIndex !== undefined) {
      params.set("pl", options.playlistId);
      params.set("pli", String(options.playlistItemIndex));
    }

    router.push(`${pathname}?${params.toString()}`);
  }

  function handleEndedChoiceSelect(videoId: string) {
    const playlistIndex = playlistQueueIds.findIndex((candidateId) => candidateId === videoId);

    setShowEndedChoiceOverlay(false);
    navigateToVideo(videoId, {
      clearPlaylist: playlistIndex < 0,
      playlistId: playlistIndex >= 0 ? activePlaylistId : null,
      playlistItemIndex: playlistIndex >= 0 ? playlistIndex : null,
    });
  }

  function handlePrevious() {
    if (hasActivePlaylistSequence && effectivePlaylistIndex !== null) {
      const previousIndex = (effectivePlaylistIndex - 1 + playlistQueueIds.length) % playlistQueueIds.length;
      const previousId = playlistQueueIds[previousIndex] ?? null;

      if (previousId) {
        navigateToVideo(previousId, {
          playlistId: activePlaylistId,
          playlistItemIndex: previousIndex,
        });
      }

      return;
    }

    const previousId = historyStack.at(-2);

    if (!previousId) {
      return;
    }

    const trimmedHistory = historyStack.slice(0, -1);
    setHistoryStack(trimmedHistory);
    window.sessionStorage.setItem(HISTORY_KEY, JSON.stringify(trimmedHistory));
    router.push(
      `${pathname}?${new URLSearchParams({ ...Object.fromEntries(searchParams.entries()), v: previousId }).toString()}`,
    );
  }

  function handleNext() {
    const nextTarget = resolveNextTarget();

    if (!nextTarget) {
      return;
    }

    navigateToVideo(nextTarget.videoId, {
      clearPlaylist: nextTarget.clearPlaylist,
      playlistId: activePlaylistId,
      playlistItemIndex: nextTarget.playlistItemIndex,
    });
  }

  function handleToggleAutoplay() {
    setAutoplayEnabled((currentValue) => {
      const nextValue = !currentValue;
      window.localStorage.setItem(AUTOPLAY_KEY, String(nextValue));
      return nextValue;
    });
  }

  async function handleAddFavourite() {
    setFavouriteSaveState("saving");
    try {
      const response = await fetch("/api/favourites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoId: currentVideo.id, action: "add" }),
      });

      if (response.ok) {
        window.dispatchEvent(new Event("ytr:favourites-updated"));
      }

      setFavouriteSaveState(response.ok ? "saved" : "error");
    } catch {
      setFavouriteSaveState("error");
    }
    if (favouriteSaveTimeoutRef.current !== null) {
      window.clearTimeout(favouriteSaveTimeoutRef.current);
    }
    favouriteSaveTimeoutRef.current = window.setTimeout(() => {
      setFavouriteSaveState("idle");
      favouriteSaveTimeoutRef.current = null;
    }, 2000);
  }

  async function handleCopyShareLink() {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(shareUrl);
    } else {
      window.prompt("Copy this link", shareUrl);
    }

    setCopied(true);

    window.setTimeout(() => {
      setCopied(false);
    }, 1600);
  }

      async function handleShareToChat() {
        if (!isLoggedIn) {
          await handleCopyShareLink();
          setShowShareMenu(false);
          return;
        }

        const content = buildSharedVideoMessage(currentVideo.id);
        if (!content) {
          setShareToChatState("error");
          return;
        }

        setShareToChatState("sending");
        try {
          const response = await fetch("/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              mode: "global",
              content,
            }),
          });

          if (!response.ok) {
            throw new Error(`share-chat-failed:${response.status}`);
          }

          setShareToChatState("sent");
        } catch {
          setShareToChatState("error");
        }

        if (shareToChatResetTimeoutRef.current !== null) {
          window.clearTimeout(shareToChatResetTimeoutRef.current);
        }

        shareToChatResetTimeoutRef.current = window.setTimeout(() => {
          setShareToChatState("idle");
          shareToChatResetTimeoutRef.current = null;
        }, 1800);

        setShowShareMenu(false);
      }

      async function handleShareToSocials() {
        setShareModalCopied(false);
        setShowShareModal(true);
        setShowShareMenu(false);
      }

      function handleShareTargetOpen(targetUrl: string) {
        window.open(targetUrl, "_blank", "noopener,noreferrer");
      }

      async function handleCopyShareUrlForModal() {
        await handleCopyShareLink();
        setShareModalCopied(true);

        window.setTimeout(() => {
          setShareModalCopied(false);
        }, 1600);
      }

      function handlePlayPause() {
        if (!playerRef.current) return;
        setShowEndedChoiceOverlay(false);
        if (isPlaying) {
          playerRef.current.pauseVideo();
        } else {
          playAttemptedAtRef.current = Date.now();
          playerRef.current.playVideo();
        }
      }

      function handleSeek(e: ChangeEvent<HTMLInputElement>) {
        if (!playerRef.current) return;
        const seconds = toSafeNumber(Number(e.target.value), 0);
        playerRef.current.seekTo(seconds, true);
        setCurrentTime(seconds);
      }

      function handleVolumeChange(e: ChangeEvent<HTMLInputElement>) {
        if (!playerRef.current) return;
        const vol = toSafeNumber(Number(e.target.value), 0);
        playerRef.current.setVolume(vol);
        setVolume(vol);
        if (vol > 0 && isMuted) {
          playerRef.current.unMute();
          setIsMuted(false);
        }
      }

      function handleMuteToggle() {
        if (!playerRef.current) return;
        if (isMuted) {
          playerRef.current.unMute();
          setIsMuted(false);
        } else {
          playerRef.current.mute();
          setIsMuted(true);
        }
      }

      return (
        <>
          <div
            ref={playerFrameRef}
            className={isPlayerReady ? "playerFrame playerFrameLoaded" : "playerFrame"}
            onMouseEnter={() => setShowControls(true)}
            onMouseLeave={() => {
              if (isPlaying) {
                setShowControls(false);
                setShowShareMenu(false);
              }
            }}
          >
            <div ref={playerElementRef} className="playerMount" />

            {!isPlayerReady ? (
              <div className="playerBootLoader" role="status" aria-live="polite" aria-label="Loading video player">
                <div className="playerBootBars" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                  <span />
                </div>
                <p>Loading player...</p>
              </div>
            ) : null}

            {isPlayerReady && (
              <div className={!hasPlaybackStarted || !isPlaying || showControls ? "playerOverlay playerOverlayVisible" : "playerOverlay"}>
                <div className="overlayTop">
                  <p className="overlayTitle">{currentVideo.title}</p>
                  <div className="shareMenuWrap">
                    <button
                      type="button"
                      className="overlayIconBtn"
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowShareMenu((v) => !v);
                      }}
                      aria-label="Share"
                    >
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
                        <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" /><line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
                      </svg>
                    </button>
                    {showShareMenu && (
                      <div className="shareMenu">
                        <button type="button" onClick={handleShareToChat}>
                          {isLoggedIn
                            ? shareToChatState === "sending"
                              ? "Sharing..."
                              : shareToChatState === "sent"
                                ? "Shared to Global Chat"
                                : shareToChatState === "error"
                                  ? "Could not share"
                                  : "Share to Global Chat"
                            : copied
                              ? "Link Copied!"
                              : "Copy Share Link"}
                        </button>
                        <button type="button" onClick={handleShareToSocials}>
                          Share to Socials
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                <div className="overlayCenter">
                  <button
                    type="button"
                    className="overlayPlayBtn"
                    onClick={handlePlayPause}
                    aria-label={isPlaying ? "Pause" : "Play"}
                  >
                    {isPlaying ? (
                      <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
                        <rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" />
                      </svg>
                    ) : (
                      <svg className="overlayPlayIcon" width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
                        <polygon points="5,3 19,12 5,21" />
                      </svg>
                    )}
                  </button>
                </div>

                <div className="overlayBottom">
                  <div className="overlayProgressWrap">
                    {isScrubbing ? (
                      <div
                        className="overlayProgressIndicator"
                        style={{ left: `${progressPercent}%` }}
                        aria-hidden="true"
                      >
                        {elapsedLabel}
                      </div>
                    ) : null}
                    <input
                      type="range"
                      className="overlayProgress"
                      min={0}
                      max={Math.max(1, safeDuration)}
                      step={0.5}
                      value={safeCurrentTime}
                      onChange={handleSeek}
                      onMouseDown={() => setIsScrubbing(true)}
                      onMouseUp={() => setIsScrubbing(false)}
                      onTouchStart={() => setIsScrubbing(true)}
                      onTouchEnd={() => setIsScrubbing(false)}
                      onFocus={() => setIsScrubbing(true)}
                      onBlur={() => setIsScrubbing(false)}
                      aria-label={`Seek position ${elapsedLabel} of ${durationLabel}`}
                    />
                  </div>
                  <div className="overlayVolume">
                    <button
                      type="button"
                      className="overlayIconBtn"
                      onClick={handleMuteToggle}
                      aria-label={isMuted ? "Unmute" : "Mute"}
                    >
                      {isMuted || volume === 0 ? (
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                          <line x1="23" y1="9" x2="17" y2="15" /><line x1="17" y1="9" x2="23" y2="15" />
                        </svg>
                      ) : (
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                          <path d="M15.54 8.46a5 5 0 0 1 0 7.07" /><path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                        </svg>
                      )}
                    </button>
                    <input
                      type="range"
                      className="overlayVolumeSlider"
                      min={0}
                      max={100}
                      value={isMuted ? 0 : Math.max(0, Math.min(100, toSafeNumber(volume, 100)))}
                      onChange={handleVolumeChange}
                      aria-label="Volume"
                    />
                    <div className="overlayTimeMeta" aria-label={`Playback time ${elapsedLabel} of ${durationLabel}`}>
                      <span>{elapsedLabel}</span>
                      <span>/</span>
                      <span>{durationLabel}</span>
                    </div>
                    <button
                      type="button"
                      className="overlayIconBtn overlayFullscreenBtn"
                      onClick={handleFullscreenToggle}
                      aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
                    >
                      {isFullscreen ? (
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="8 3 3 3 3 8" /><polyline points="21 8 21 3 16 3" />
                          <polyline points="3 16 3 21 8 21" /><polyline points="16 21 21 21 21 16" />
                        </svg>
                      ) : (
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" />
                          <line x1="21" y1="3" x2="14" y2="10" /><line x1="3" y1="21" x2="10" y2="14" />
                        </svg>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {showNowPlayingOverlay ? (
              <div key={`${currentVideo.id}-${overlayInstance}`} className="nowPlayingOverlay nowPlayingOverlayAnimate">
                <p className="statusLabel">Now playing</p>
                <strong>{currentVideo.title}</strong>
              </div>
            ) : null}

            {unavailableOverlayMessage ? (
              <div className="videoUnavailableOverlay" role="status" aria-live="polite">
                <p>Apologies</p>
                <strong>{unavailableOverlayMessage}</strong>
              </div>
            ) : null}

          </div>

          {showEndedChoiceOverlay && endedChoiceVideos.length > 0 ? (
            <div className="playerEndedChoiceOverlay" role="dialog" aria-modal="false" aria-label="Choose the next video">
              <div className="playerEndedChoiceGrid">
                {endedChoiceVideos.map((video) => (
                  <button
                    key={video.id}
                    type="button"
                    className="playerEndedChoiceCard"
                    onClick={() => handleEndedChoiceSelect(video.id)}
                  >
                    <img
                      src={`https://i.ytimg.com/vi/${video.id}/mqdefault.jpg`}
                      alt=""
                      className="playerEndedChoiceThumb"
                      loading="lazy"
                    />
                    <span className="playerEndedChoiceMeta">
                      <span className="playerEndedChoiceTitle">{video.title}</span>
                      <span className="playerEndedChoiceChannel">
                        <ArtistWikiLink artistName={video.channelTitle} videoId={video.id} className="artistInlineLink">
                          {video.channelTitle}
                        </ArtistWikiLink>
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {showShareModal ? (
            <div
              className="shareModalBackdrop"
              role="dialog"
              aria-modal="true"
              aria-label="Share this video"
              onClick={() => setShowShareModal(false)}
            >
              <div className="shareModal" onClick={(event) => event.stopPropagation()}>
                <div className="shareModalHeader">
                  <strong>Share This Video</strong>
                  <button
                    type="button"
                    className="overlayIconBtn"
                    onClick={() => setShowShareModal(false)}
                    aria-label="Close share modal"
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>

                <p className="shareModalSubtitle">Choose a platform, or copy the URL to share anywhere.</p>

                <div className="shareModalGrid">
                  {socialShareTargets.map((target) => (
                    <button
                      key={target.id}
                      type="button"
                      className="shareModalTarget"
                      onClick={() => handleShareTargetOpen(target.href)}
                    >
                      {target.label}
                    </button>
                  ))}
                </div>

                <div className="shareModalUrlRow">
                  <label htmlFor="share-modal-url" className="shareUrlLabel">Share URL</label>
                  <input
                    id="share-modal-url"
                    type="text"
                    className="shareUrlInput"
                    readOnly
                    value={shareUrl}
                    onFocus={(event) => event.currentTarget.select()}
                    onClick={(event) => event.currentTarget.select()}
                  />
                  <button type="button" onClick={handleCopyShareUrlForModal}>
                    {shareModalCopied ? "Copied!" : "Copy Link"}
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          <div className="primaryActions">
            <div className="shareUrlField">
              <label htmlFor="share-url" className="shareUrlLabel">Share URL</label>
              <input
                id="share-url"
                type="text"
                className="shareUrlInput"
                size={Math.min(Math.max(shareUrl.length, 24), 48)}
                style={{ width: `calc(${Math.min(Math.max(shareUrl.length, 24), 48)}ch - 7px)` }}
                readOnly
                value={shareUrl}
                onFocus={(event) => event.currentTarget.select()}
                onClick={(event) => event.currentTarget.select()}
                aria-label="Share URL"
              />
            </div>
            {isLoggedIn && (
              <div className="primaryActionIconButtonWrap">
                {favouriteSaveState === "saved" && (
                  <div className="favouriteSavedToast" role="status" aria-live="polite">Favourite Saved!</div>
                )}
                {favouriteSaveState === "error" && (
                  <div className="favouriteSavedToast favouriteSavedToastError" role="status" aria-live="polite">Could not save</div>
                )}
                <button
                  type="button"
                  className="primaryActionIconButton"
                  aria-label="Add to favourites"
                  title="Add to favourites"
                  disabled={favouriteSaveState === "saving"}
                  onClick={handleAddFavourite}
                >
                  <span className="navFavouritesGlyph" aria-hidden="true">❤️</span>
                </button>
              </div>
            )}
            <button
              type="button"
              className="primaryActionNavIconButton"
              onClick={handlePrevious}
              disabled={!hasPreviousTrack}
              aria-label="Previous"
              title="Previous"
            >
              <span className="primaryNavGlyph" aria-hidden="true">⇤</span>
            </button>
            <button
              type="button"
              className="primaryActionNavIconButton"
              onClick={handleNext}
              aria-label="Next"
              title="Next"
            >
              <span className="primaryNavGlyph" aria-hidden="true">⇥</span>
            </button>
            {hasArtistName ? (
              <ArtistWikiLink
                artistName={currentVideo.channelTitle}
                videoId={currentVideo.id}
                asButton
                className="primaryActionToggleButton"
                title={`Open ${currentVideo.channelTitle} wiki`}
              >
                <span className="primaryActionGlyph" aria-hidden="true">📖</span>
                <span>Artist Wiki</span>
              </ArtistWikiLink>
            ) : null}
            <button
              type="button"
              className={autoplayEnabled ? "primaryActionToggleButton primaryActionToggleButtonActive" : "primaryActionToggleButton"}
              onClick={handleToggleAutoplay}
              aria-label={autoplayEnabled ? "Disable autoplay" : "Enable autoplay"}
              title={autoplayEnabled ? "Disable autoplay" : "Enable autoplay"}
            >
              <span className="primaryActionGlyph" aria-hidden="true">⇮</span>
              <span>Autoplay: {autoplayEnabled ? "On" : "Off"}</span>
            </button>
          </div>
        </>
      );
    }
