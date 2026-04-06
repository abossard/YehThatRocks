"use client";

import Link from "next/link";
import Image from "next/image";
import { FormEvent, Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { CSSProperties } from "react";

import { AuthLoginForm } from "@/components/auth-login-form";
import { ArtistWikiLink } from "@/components/artist-wiki-link";
import { ArtistsLetterNav } from "@/components/artists-letter-nav";
import { PlayerExperience } from "@/components/player-experience";
import { navItems, type VideoRecord } from "@/lib/catalog";
import { parseSharedVideoMessage } from "@/lib/chat-shared-video";

if (process.env.NODE_ENV === "development" && typeof window !== "undefined") {
  const perfWithPatchState = performance as Performance & {
    __ytrMeasurePatched?: boolean;
  };

  if (!perfWithPatchState.__ytrMeasurePatched) {
    const originalMeasure = performance.measure.bind(performance);
    perfWithPatchState.__ytrMeasurePatched = true;

    performance.measure = ((...args: Parameters<Performance["measure"]>) => {
      try {
        return originalMeasure(...args);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // React dev profiling can sporadically emit invalid ranges; avoid hard-crashing route render.
        if (message.includes("negative time stamp")) {
          return undefined as unknown as ReturnType<Performance["measure"]>;
        }

        throw error;
      }
    }) as Performance["measure"];
  }
}

type ChatMode = "global" | "video" | "online";

type ChatMessage = {
  id: number;
  content: string;
  createdAt: string | null;
  room: string;
  videoId: string | null;
  user: {
    id: number | null;
    name: string;
    avatarUrl: string | null;
  };
};

type OnlineUser = {
  id: number;
  name: string;
  avatarUrl: string | null;
  lastSeen: string | null;
  isOnline?: boolean;
};

type CurrentVideoResolvePayload = {
  currentVideo?: VideoRecord;
  relatedVideos?: VideoRecord[];
  pending?: boolean;
  denied?: { message?: string };
};

type RightRailMode = "watch-next" | "playlist";

type PlaylistRailVideo = {
  id: string;
  title: string;
  channelTitle: string;
  thumbnail?: string | null;
};

type PlaylistRailPayload = {
  id: string;
  name: string;
  videos: PlaylistRailVideo[];
  itemCount?: number;
};

type PlaylistRailSummary = {
  id: string;
  name: string;
  itemCount: number;
  leadVideoId: string;
};

type FlashableChatMode = "global" | "video";

type SharedVideoPreview = {
  id: string;
  title: string;
  channelTitle: string;
};

function formatChatTimestamp(value: string | null) {
  if (!value) {
    return "Now";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "Now";
  }

  return parsed.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function buildYouTubeThumbnail(videoId: string) {
  return `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/hqdefault.jpg`;
}

function SharedVideoMessageCard({ videoId }: { videoId: string }) {
  const [preview, setPreview] = useState<SharedVideoPreview | null>(null);

  useEffect(() => {
    let isCancelled = false;

    async function loadPreview() {
      try {
        const response = await fetch(`/api/videos/share-preview?v=${encodeURIComponent(videoId)}`);
        if (!response.ok) {
          return;
        }

        const payload = (await response.json()) as {
          video?: {
            id: string;
            title: string;
            channelTitle: string;
          };
        };

        if (isCancelled || !payload.video?.id) {
          return;
        }

        setPreview({
          id: payload.video.id,
          title: payload.video.title,
          channelTitle: payload.video.channelTitle,
        });
      } catch {
        // Keep generic card if preview fetch fails.
      }
    }

    void loadPreview();

    return () => {
      isCancelled = true;
    };
  }, [videoId]);

  const resolvedId = preview?.id ?? videoId;

  return (
    <Link
      href={`/?v=${encodeURIComponent(resolvedId)}`}
      className="chatSharedVideoCard"
      onClick={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <Image
        src={buildYouTubeThumbnail(resolvedId)}
        alt=""
        width={84}
        height={48}
        className="chatSharedVideoThumb"
      />
      <span className="chatSharedVideoMeta">
        <strong>{preview?.title ?? "Shared video"}</strong>
        <span>
          {preview?.channelTitle ? (
            <ArtistWikiLink artistName={preview.channelTitle} videoId={resolvedId} className="artistInlineLink">
              {preview.channelTitle}
            </ArtistWikiLink>
          ) : "Tap to open"}
        </span>
      </span>
    </Link>
  );
}

type ShellDynamicProps = {
  initialVideo: VideoRecord;
  initialRelatedVideos: VideoRecord[];
  isLoggedIn: boolean;
  children: ReactNode;
};

const FLOW_DEBUG_ENABLED = process.env.NODE_ENV === "development" && process.env.NEXT_PUBLIC_DEBUG_FLOW === "1";
const LAST_RANDOM_START_VIDEO_ID_KEY = "ytr:last-random-start-video-id";
const PENDING_VIDEO_SELECTION_KEY = "ytr:pending-video-selection";
const CURRENT_VIDEO_PREFETCH_TTL_MS = 25_000;
const RELATED_FADE_STAGGER_MS = 46;
const RELATED_FADE_OUT_BASE_MS = 210;
const RELATED_FADE_IN_BASE_MS = 230;
const STARTUP_RETRY_FAST_ATTEMPTS = 4;
const STARTUP_RETRY_SLOW_DELAY_MS = 8_000;
const STARTUP_RETRY_MAX_ATTEMPTS = 8;
const PREFETCH_FAILURE_BASE_BACKOFF_MS = 1_500;
const PREFETCH_FAILURE_MAX_BACKOFF_MS = 20_000;
const PLAYLISTS_UPDATED_EVENT = "ytr:playlists-updated";

function dedupeVideoList(videos: VideoRecord[]) {
  return videos.filter(
    (video, index, all) => all.findIndex((candidate) => candidate.id === video.id) === index,
  );
}

function dedupeRelatedRailVideos(videos: VideoRecord[], currentVideoId: string) {
  return dedupeVideoList(videos).filter((video) => video.id !== currentVideoId);
}

function logFlow(event: string, detail?: Record<string, unknown>) {
  if (!FLOW_DEBUG_ENABLED) {
    return;
  }

  const payload = detail ? ` ${JSON.stringify(detail)}` : "";
  console.log(`[flow/shell] ${event}${payload}`);
}

function isRouteActive(href: string, pathname: string) {
  if (href === pathname) return true;
  // /artists nav item should also highlight for /artist/[slug]
  if (href === "/artists" && pathname.startsWith("/artist/")) return true;
  // all other nav items: highlight for sub-paths
  if (href !== "/" && pathname.startsWith(href + "/")) return true;
  return false;
}

function isProtectedOverlayPath(pathname: string) {
  return pathname === "/favourites"
    || pathname === "/account"
    || pathname === "/playlists"
    || pathname.startsWith("/playlists/");
}

function ShellDynamicInner({
  initialVideo,
  isLoggedIn,
  children,
}: ShellDynamicProps) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const searchParamsKey = searchParams.toString();
  const requestedVideoId = searchParams.get("v");
  const activePlaylistId = searchParams.get("pl");

  const [currentVideo, setCurrentVideo] = useState(initialVideo);
  const [relatedVideos, setRelatedVideos] = useState<VideoRecord[]>([]);
  const [displayedRelatedVideos, setDisplayedRelatedVideos] = useState<VideoRecord[]>([]);
  const [relatedTransitionPhase, setRelatedTransitionPhase] = useState<"idle" | "fading-out" | "loading" | "fading-in">("idle");
  const activeVideoId = requestedVideoId ?? currentVideo.id;
  const [isAuthenticated, setIsAuthenticated] = useState(isLoggedIn);
  const [deniedPlaybackMessage, setDeniedPlaybackMessage] = useState<string | null>(null);
  const [chatMode, setChatMode] = useState<ChatMode>("global");
  const [rightRailMode, setRightRailMode] = useState<RightRailMode>("watch-next");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [onlineUsers, setOnlineUsers] = useState<OnlineUser[]>([]);
  const [chatDraft, setChatDraft] = useState("");
  const [chatError, setChatError] = useState<string | null>(null);
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [playlistRailData, setPlaylistRailData] = useState<PlaylistRailPayload | null>(null);
  const [isPlaylistRailLoading, setIsPlaylistRailLoading] = useState(false);
  const [playlistRailError, setPlaylistRailError] = useState<string | null>(null);
  const [playlistRailSummaries, setPlaylistRailSummaries] = useState<PlaylistRailSummary[]>([]);
  const [isPlaylistSummaryLoading, setIsPlaylistSummaryLoading] = useState(false);
  const [playlistSummaryError, setPlaylistSummaryError] = useState<string | null>(null);
  const [playlistRefreshTick, setPlaylistRefreshTick] = useState(0);
  const [playlistMutationMessage, setPlaylistMutationMessage] = useState<string | null>(null);
  const [playlistMutationTone, setPlaylistMutationTone] = useState<"info" | "success" | "error">("info");
  const [playlistMutationPendingVideoId, setPlaylistMutationPendingVideoId] = useState<string | null>(null);
  const [isChatSubmitting, setIsChatSubmitting] = useState(false);
  const [flashingChatTabs, setFlashingChatTabs] = useState<Record<FlashableChatMode, boolean>>({
    global: false,
    video: false,
  });
  const [isResolvingInitialVideo, setIsResolvingInitialVideo] = useState(!requestedVideoId);
  const [isResolvingRequestedVideo, setIsResolvingRequestedVideo] = useState(Boolean(requestedVideoId));
  const refreshPromiseRef = useRef<Promise<boolean> | null>(null);
  const lastVideoIdRef = useRef<string | null>(null);
  const deniedRequestedVideoIdRef = useRef<string | null>(null);
  const hasResolvedInitialVideoRef = useRef(Boolean(requestedVideoId));
  const startupHydratedVideoIdRef = useRef<string | null>(null);
  const prefetchedRelatedIdsRef = useRef<Set<string>>(new Set());
  const prefetchedCurrentVideoPayloadRef = useRef<Map<string, { expiresAt: number; payload: CurrentVideoResolvePayload }>>(new Map());
  const inFlightCurrentVideoPrefetchRef = useRef<Set<string>>(new Set());
  const prefetchBlockedUntilRef = useRef(0);
  const prefetchFailureCountRef = useRef(0);
  const prewarmedThumbnailIdsRef = useRef<Set<string>>(new Set());
  const pendingRelatedVideosRef = useRef<VideoRecord[] | null>(null);
  const relatedTransitionTimeoutRef = useRef<number | null>(null);
  const watchNextRailRef = useRef<HTMLElement | null>(null);
  const chatListRef = useRef<HTMLDivElement | null>(null);
  const favouritesBlindInnerRef = useRef<HTMLDivElement | null>(null);
  const flashTimeoutRef = useRef<Record<FlashableChatMode, number | null>>({
    global: null,
    video: null,
  });

  // Search autocomplete
  type SearchSuggestion = { type: "artist" | "track" | "genre"; label: string; url: string };
  const [searchValue, setSearchValue] = useState("");
  const [suggestions, setSuggestions] = useState<SearchSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [activeSuggestionIdx, setActiveSuggestionIdx] = useState(-1);
  const suggestDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suggestAbortRef = useRef<AbortController | null>(null);
  const latestSuggestQueryRef = useRef("");
  const searchComboboxRef = useRef<HTMLDivElement | null>(null);
  // Refs to reliably access current state in event handlers
  const suggestionsRef = useRef<SearchSuggestion[]>([]);
  const showSuggestionsRef = useRef(false);
  const activeSuggestionIdxRef = useRef(-1);

  const isOverlayRoute = pathname !== "/";
  const disableOverlayDropAnimation =
    pathname === "/categories"
    || pathname.startsWith("/categories/")
    || pathname === "/playlists"
    || pathname.startsWith("/playlists/");
  const shouldRunChat = isAuthenticated && !isOverlayRoute;
  const isArtistsIndexRoute = pathname === "/artists";
  const artistLetterParam = searchParams.get("letter");
  const activeArtistLetter =
    artistLetterParam && /^[A-Za-z]$/.test(artistLetterParam)
      ? artistLetterParam.toUpperCase()
      : "A";
  const resumeParam = searchParams.get("resume") ?? undefined;
  const overlayRouteKey = (() => {
    if (disableOverlayDropAnimation) {
      if (pathname === "/playlists" || pathname.startsWith("/playlists/")) {
        return "playlists-overlay";
      }

      if (pathname === "/categories" || pathname.startsWith("/categories/")) {
        return "categories-overlay";
      }
    }

    const filteredParams = new URLSearchParams();

    for (const [key, value] of searchParams.entries()) {
      if (key === "v" || key === "resume") {
        continue;
      }

      filteredParams.append(key, value);
    }

    const filteredQuery = filteredParams.toString();
    return filteredQuery ? `${pathname}?${filteredQuery}` : pathname;
  })();
  const routeLoadingLabel = pathname.endsWith("/wiki") ? "Loading wiki" : "Loading video";

  useEffect(() => {
    if (!isAuthenticated && rightRailMode === "playlist") {
      setRightRailMode("watch-next");
    }
  }, [isAuthenticated, rightRailMode]);

  useEffect(() => {
    setIsAuthenticated(isLoggedIn);
  }, [isLoggedIn]);

  useEffect(() => {
    if (pathname !== "/top100") {
      return;
    }

    const node = favouritesBlindInnerRef.current;
    if (!node) {
      return;
    }

    node.scrollTop = 0;
    const frameId = window.requestAnimationFrame(() => {
      if (favouritesBlindInnerRef.current) {
        favouritesBlindInnerRef.current.scrollTop = 0;
      }
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [pathname]);

  useEffect(() => {
    if (requestedVideoId) {
      return;
    }

    // Don't re-run startup if we already resolved a video in this session
    // (e.g. user navigated to a route without ?v= after startup completed)
    if (hasResolvedInitialVideoRef.current) {
      return;
    }

    let cancelled = false;
    setIsResolvingInitialVideo(true);
    const previousVideoId = window.sessionStorage.getItem(LAST_RANDOM_START_VIDEO_ID_KEY);

    const navigateToVideo = (nextVideoId: string | undefined, source: string) => {
      if (!nextVideoId || cancelled) {
        logFlow("startup-selection:skipped", {
          source,
          nextVideoId,
          cancelled,
        });
        return;
      }

      window.sessionStorage.setItem(LAST_RANDOM_START_VIDEO_ID_KEY, nextVideoId);
      logFlow("startup-selection:navigate", {
        source,
        nextVideoId,
        previousVideoId,
      });
      router.replace(`${pathname}?${new URLSearchParams({ ...Object.fromEntries(searchParams.entries()), v: nextVideoId }).toString()}`);
    };

    const resolveStartupCandidate = (selectedVideo: VideoRecord, relatedVideos: VideoRecord[], source: string) => {
      setCurrentVideo(selectedVideo);
      setRelatedVideos(relatedVideos);
      setIsResolvingInitialVideo(false);
      hasResolvedInitialVideoRef.current = true;
      startupHydratedVideoIdRef.current = selectedVideo.id;

      navigateToVideo(selectedVideo.id, source);
      return true;
    };

    let retryTimeoutId: number | null = null;
    let activeController: AbortController | null = null;

    const tryResolveStartupVideo = async (attempt = 1): Promise<void> => {
      try {
        const controller = new AbortController();
        activeController = controller;
        const timeoutId = window.setTimeout(() => controller.abort(), 4000);
        const response = await fetch(`/api/videos/top/random${previousVideoId ? `?exclude=${encodeURIComponent(previousVideoId)}` : ""}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        window.clearTimeout(timeoutId);
        activeController = null;

        if (!response.ok || cancelled) {
          throw new Error("Failed to load startup random video");
        }

        const data = (await response.json()) as {
          video?: VideoRecord;
          relatedVideos?: VideoRecord[];
        };

        if (data.video && typeof data.video.id === "string") {
          const related = Array.isArray(data.relatedVideos) ? data.relatedVideos : [];
          logFlow("startup-selection:api-success", {
            selectedVideoId: data.video.id,
            relatedCount: related.length,
            attempt,
          });
          resolveStartupCandidate(data.video, related, "api-random");
          return;
        }

        const currentVideoResponse = await fetch("/api/current-video", {
          cache: "no-store",
          signal: controller.signal,
        });

        if (currentVideoResponse.ok) {
          const currentVideoPayload = (await currentVideoResponse.json()) as CurrentVideoResolvePayload;
          if (currentVideoPayload.currentVideo?.id) {
            logFlow("startup-selection:current-video-success", {
              selectedVideoId: currentVideoPayload.currentVideo.id,
              relatedCount: Array.isArray(currentVideoPayload.relatedVideos)
                ? currentVideoPayload.relatedVideos.length
                : 0,
              attempt,
            });

            resolveStartupCandidate(
              currentVideoPayload.currentVideo,
              Array.isArray(currentVideoPayload.relatedVideos) ? currentVideoPayload.relatedVideos : [],
              "api-current-video",
            );
            return;
          }
        }

        throw new Error("Startup random and current resolver returned no video id");
      } catch (error) {
        activeController = null;
        if (cancelled) {
          return;
        }

        if (attempt >= STARTUP_RETRY_MAX_ATTEMPTS) {
          logFlow("startup-selection:halted", {
            attempt,
            error: error instanceof Error ? error.message : String(error),
          });
          setIsResolvingInitialVideo(false);
          return;
        }

        logFlow("startup-selection:retry", {
          attempt,
          error: error instanceof Error ? error.message : String(error),
        });

        const delayMs = attempt <= STARTUP_RETRY_FAST_ATTEMPTS
          ? Math.min(2400, 350 * attempt)
          : STARTUP_RETRY_SLOW_DELAY_MS;
        retryTimeoutId = window.setTimeout(() => {
          void tryResolveStartupVideo(attempt + 1);
        }, delayMs);
      }
    };

    void tryResolveStartupVideo();

    return () => {
      cancelled = true;
      activeController?.abort();
      if (retryTimeoutId !== null) {
        window.clearTimeout(retryTimeoutId);
      }
    };
  }, [pathname, requestedVideoId, router, searchParamsKey]);

  useEffect(() => {
    logFlow("requested-video:effect", {
      requestedVideoId,
      lastRequestedVideoId: lastVideoIdRef.current,
      currentVideoId: currentVideo.id,
    });

    if (!requestedVideoId) {
      deniedRequestedVideoIdRef.current = null;
      setIsResolvingRequestedVideo(false);
      return;
    }

    if (deniedRequestedVideoIdRef.current === requestedVideoId) {
      setIsResolvingRequestedVideo(false);
      return;
    }

    // Guard against duplicate effect executions for the same requested id
    // while a resolve is already in flight (can happen during rapid rerenders).
    if (requestedVideoId === lastVideoIdRef.current && isResolvingRequestedVideo) {
      return;
    }

    if (
      requestedVideoId === lastVideoIdRef.current &&
      currentVideo.id === requestedVideoId &&
      !isResolvingRequestedVideo
    ) {
      return;
    }

    // Startup already hydrated this selected ID from /api/videos/top payload.
    // Skip one redundant /api/current-video resolve request.
    if (startupHydratedVideoIdRef.current === requestedVideoId) {
      startupHydratedVideoIdRef.current = null;
      lastVideoIdRef.current = requestedVideoId;
      setIsResolvingRequestedVideo(false);
      return;
    }

    let ignore = false;
    let retryTimeoutId: number | null = null;
    lastVideoIdRef.current = requestedVideoId;
    setIsResolvingRequestedVideo(true);
    let hasOptimisticVideo = false;

    setDeniedPlaybackMessage(null);

    if (typeof window !== "undefined") {
      const rawPendingSelection = window.sessionStorage.getItem(PENDING_VIDEO_SELECTION_KEY);
      if (rawPendingSelection) {
        try {
          const pendingSelection = JSON.parse(rawPendingSelection) as Partial<VideoRecord> & { id?: string };
          if (pendingSelection.id === requestedVideoId) {
            setCurrentVideo((previousVideo) => ({
              ...previousVideo,
              id: requestedVideoId,
              title: typeof pendingSelection.title === "string" ? pendingSelection.title : previousVideo.title,
              channelTitle:
                typeof pendingSelection.channelTitle === "string"
                  ? pendingSelection.channelTitle
                  : previousVideo.channelTitle,
              genre: typeof pendingSelection.genre === "string" ? pendingSelection.genre : previousVideo.genre,
              favourited:
                typeof pendingSelection.favourited === "number"
                  ? pendingSelection.favourited
                  : previousVideo.favourited,
              description:
                typeof pendingSelection.description === "string"
                  ? pendingSelection.description
                  : previousVideo.description,
            }));
            hasOptimisticVideo = true;
            setIsResolvingRequestedVideo(false);
            window.sessionStorage.removeItem(PENDING_VIDEO_SELECTION_KEY);
          }
        } catch {
          window.sessionStorage.removeItem(PENDING_VIDEO_SELECTION_KEY);
        }
      }
    }

    if (!hasOptimisticVideo) {
      const relatedMatch = relatedVideos.find((video) => video.id === requestedVideoId);
      if (relatedMatch) {
        setCurrentVideo(relatedMatch);
        hasOptimisticVideo = true;
        setIsResolvingRequestedVideo(false);
      }
    }

    if (!hasOptimisticVideo) {
      const cached = prefetchedCurrentVideoPayloadRef.current.get(requestedVideoId);
      if (cached && cached.expiresAt > Date.now() && cached.payload.currentVideo?.id === requestedVideoId) {
        setCurrentVideo(cached.payload.currentVideo);
        setRelatedVideos(cached.payload.relatedVideos ?? []);
        hasOptimisticVideo = true;
        setIsResolvingRequestedVideo(false);
      }
    }

    const resolveRequestedVideo = async (attempt = 1): Promise<void> => {
      try {
        const response = await fetch(`/api/current-video?v=${encodeURIComponent(requestedVideoId)}`);
        const data = response.ok ? ((await response.json()) as CurrentVideoResolvePayload) : null;

        if (ignore) {
          return;
        }

        logFlow("requested-video:response", {
          requestedVideoId,
          resolvedVideoId: data?.currentVideo?.id,
          denied: Boolean(data?.denied),
          ok: response.ok,
          attempt,
        });

        if (data?.denied?.message) {
          setDeniedPlaybackMessage(String(data.denied.message));
          deniedRequestedVideoIdRef.current = requestedVideoId;
          setIsResolvingRequestedVideo(false);
          if (!hasResolvedInitialVideoRef.current) {
            hasResolvedInitialVideoRef.current = true;
            setIsResolvingInitialVideo(false);
          }

          return;
        }

        if (data?.currentVideo?.id) {
          prefetchedCurrentVideoPayloadRef.current.set(requestedVideoId, {
            expiresAt: Date.now() + CURRENT_VIDEO_PREFETCH_TTL_MS,
            payload: data,
          });
          setDeniedPlaybackMessage(null);
          setCurrentVideo(data.currentVideo);
          setRelatedVideos(data.relatedVideos ?? []);
          setIsResolvingRequestedVideo(false);
          if (!hasResolvedInitialVideoRef.current) {
            hasResolvedInitialVideoRef.current = true;
            setIsResolvingInitialVideo(false);
          }
          return;
        }
      } catch (error) {
        if (ignore) {
          return;
        }

        logFlow("requested-video:error", {
          requestedVideoId,
          error: error instanceof Error ? error.message : String(error),
          attempt,
        });
      }

      if (ignore) {
        return;
      }

      const delayMs = Math.min(2400, 350 * attempt);
      retryTimeoutId = window.setTimeout(() => {
        void resolveRequestedVideo(attempt + 1);
      }, delayMs);
    };

    void resolveRequestedVideo();

    return () => {
      ignore = true;
      if (retryTimeoutId !== null) {
        window.clearTimeout(retryTimeoutId);
      }
    };
  }, [requestedVideoId]);

  useEffect(() => {
    if (!deniedPlaybackMessage) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setDeniedPlaybackMessage(null);
    }, 7000);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [deniedPlaybackMessage]);

  useEffect(() => {
    setDeniedPlaybackMessage(null);
  }, [pathname, searchParamsKey]);

  const refreshAuthSession = useCallback(async () => {
    if (refreshPromiseRef.current) {
      return refreshPromiseRef.current;
    }

    const refreshPromise = (async () => {
      try {
        const response = await fetch("/api/auth/refresh", {
          method: "POST",
          credentials: "same-origin",
          headers: {
            "Content-Type": "application/json",
          },
          body: "{}",
        });

        return response.ok;
      } catch {
        return false;
      }
    })();

    refreshPromiseRef.current = refreshPromise;
    try {
      return await refreshPromise;
    } finally {
      refreshPromiseRef.current = null;
    }
  }, []);

  const fetchWithAuthRetry = useCallback(
    async (input: string, init?: RequestInit) => {
      const requestInit: RequestInit = {
        credentials: "same-origin",
        ...init,
      };

      let response = await fetch(input, requestInit);

      if (response.status !== 401 && response.status !== 403) {
        return response;
      }

      const didRefresh = await refreshAuthSession();

      if (!didRefresh) {
        return response;
      }

      response = await fetch(input, requestInit);
      return response;
    },
    [refreshAuthSession],
  );

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
    if (rightRailMode !== "playlist") {
      return;
    }

    if (!activePlaylistId) {
      setPlaylistRailData(null);
      setPlaylistRailError(null);
      setIsPlaylistRailLoading(false);
      return;
    }

    let cancelled = false;

    const loadPlaylistRail = async () => {
      setIsPlaylistRailLoading(true);
      setPlaylistRailError(null);

      try {
        const response = await fetchWithAuthRetry(`/api/playlists/${encodeURIComponent(activePlaylistId)}`);

        if (cancelled) {
          return;
        }

        if (response.status === 401 || response.status === 403) {
          setIsAuthenticated(false);
          setPlaylistRailData(null);
          setPlaylistRailError("Sign in to view playlist tracks.");
          return;
        }

        if (!response.ok) {
          setPlaylistRailData(null);
          setPlaylistRailError("Could not load playlist tracks.");
          return;
        }

        const payload = (await response.json()) as PlaylistRailPayload;
        if (!cancelled) {
          setPlaylistRailData(payload);
        }
      } catch {
        if (!cancelled) {
          setPlaylistRailData(null);
          setPlaylistRailError("Could not load playlist tracks.");
        }
      } finally {
        if (!cancelled) {
          setIsPlaylistRailLoading(false);
        }
      }
    };

    void loadPlaylistRail();

    return () => {
      cancelled = true;
    };
  }, [activePlaylistId, fetchWithAuthRetry, pathname, playlistRefreshTick, rightRailMode, searchParamsKey]);

  useEffect(() => {
    if (rightRailMode !== "playlist") {
      return;
    }

    let cancelled = false;

    const loadPlaylistSummaries = async () => {
      setIsPlaylistSummaryLoading(true);
      setPlaylistSummaryError(null);

      try {
        const response = await fetchWithAuthRetry("/api/playlists");

        if (cancelled) {
          return;
        }

        if (response.status === 401 || response.status === 403) {
          setIsAuthenticated(false);
          setPlaylistRailSummaries([]);
          setPlaylistSummaryError("Sign in to view playlists.");
          return;
        }

        if (!response.ok) {
          setPlaylistRailSummaries([]);
          setPlaylistSummaryError("Could not load playlists.");
          return;
        }

        const payload = (await response.json()) as { playlists?: PlaylistRailSummary[] };
        if (!cancelled) {
          setPlaylistRailSummaries(Array.isArray(payload.playlists) ? payload.playlists : []);
        }
      } catch {
        if (!cancelled) {
          setPlaylistRailSummaries([]);
          setPlaylistSummaryError("Could not load playlists.");
        }
      } finally {
        if (!cancelled) {
          setIsPlaylistSummaryLoading(false);
        }
      }
    };

    void loadPlaylistSummaries();

    return () => {
      cancelled = true;
    };
  }, [activePlaylistId, fetchWithAuthRetry, playlistRefreshTick, rightRailMode]);

  function triggerChatTabFlash(mode: FlashableChatMode) {
    const existingTimeoutId = flashTimeoutRef.current[mode];
    if (existingTimeoutId !== null) {
      window.clearTimeout(existingTimeoutId);
    }

    // Toggle off first so repeated arrivals retrigger the animation.
    setFlashingChatTabs((current) => ({
      ...current,
      [mode]: false,
    }));

    window.requestAnimationFrame(() => {
      setFlashingChatTabs((current) => ({
        ...current,
        [mode]: true,
      }));
    });

    flashTimeoutRef.current[mode] = window.setTimeout(() => {
      setFlashingChatTabs((current) => ({
        ...current,
        [mode]: false,
      }));
      flashTimeoutRef.current[mode] = null;
    }, 900);
  }

  // Load chat history whenever mode / video / auth changes.
  // For "online" mode we also keep a 30 s refresh so presence stays current.
  useEffect(() => {
    if (!shouldRunChat) {
      return;
    }

    let cancelled = false;

    const loadChat = async () => {
      setIsChatLoading(true);
      setChatError(null);

      try {
        const params = new URLSearchParams({ mode: chatMode });
        if (chatMode === "video") {
          params.set("videoId", currentVideo.id);
        }

        const response = await fetchWithAuthRetry(`/api/chat?${params.toString()}`);

        if (response.status === 401 || response.status === 403) {
          if (!cancelled) {
            setIsAuthenticated(false);
            setChatError(null);
          }
          return;
        }

        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as { error?: string } | null;
          if (!cancelled) {
            setChatError(payload?.error ?? "Chat failed to load.");
          }
          return;
        }

        const payload = (await response.json()) as { messages?: ChatMessage[]; onlineUsers?: OnlineUser[] };
        if (!cancelled) {
          setChatMessages(Array.isArray(payload.messages) ? payload.messages : []);
          setOnlineUsers(Array.isArray(payload.onlineUsers) ? payload.onlineUsers : []);
        }
      } catch {
        if (!cancelled) {
          setChatError("Chat failed to load.");
        }
      } finally {
        if (!cancelled) {
          setIsChatLoading(false);
        }
      }
    };

    void loadChat();

    // Only the "online" presence tab needs periodic refresh.
    const intervalId =
      chatMode === "online"
        ? window.setInterval(() => { void loadChat(); }, 30_000)
        : undefined;

    return () => {
      cancelled = true;
      if (intervalId !== undefined) window.clearInterval(intervalId);
    };
  }, [chatMode, currentVideo.id, fetchWithAuthRetry, shouldRunChat]);

  // Real-time SSE subscriptions for global + current video chat.
  useEffect(() => {
    if (!shouldRunChat) {
      return;
    }

    const handleIncomingMessage = (event: MessageEvent<string>) => {
      try {
        const message = JSON.parse(event.data) as ChatMessage;

        const isGlobalMessage = message.room === "global";
        const isVideoMessage = message.room === "video" && message.videoId === currentVideo.id;
        const incomingMode: FlashableChatMode | null = isGlobalMessage
          ? "global"
          : isVideoMessage
            ? "video"
            : null;

        if (!incomingMode) {
          return;
        }

        if (chatMode !== incomingMode) {
          triggerChatTabFlash(incomingMode);
          return;
        }

        setChatMessages((current) => {
          // Deduplicate: the sender already added this via the POST response.
          if (current.some((m) => m.id === message.id)) return current;
          return [...current, message];
        });
      } catch {
        // ignore malformed events
      }
    };

    const globalEvents = new EventSource("/api/chat/stream?mode=global");
    const videoEvents = new EventSource(`/api/chat/stream?mode=video&videoId=${encodeURIComponent(currentVideo.id)}`);

    globalEvents.onmessage = handleIncomingMessage;
    videoEvents.onmessage = handleIncomingMessage;

    globalEvents.onerror = () => {
      // EventSource auto-reconnects; nothing to do here.
    };

    videoEvents.onerror = () => {
      // EventSource auto-reconnects; nothing to do here.
    };

    return () => {
      globalEvents.close();
      videoEvents.close();
    };
  }, [chatMode, currentVideo.id, shouldRunChat]);

  useEffect(() => {
    return () => {
      for (const mode of ["global", "video"] as const) {
        const timeoutId = flashTimeoutRef.current[mode];
        if (timeoutId !== null) {
          window.clearTimeout(timeoutId);
        }
      }
    };
  }, []);

  useEffect(() => {
    if (shouldRunChat) {
      return;
    }

    setChatDraft("");
    setChatError(null);
    setChatMessages([]);
    setOnlineUsers([]);
    setIsChatLoading(false);
    setIsChatSubmitting(false);
    setChatMode("global");
  }, [isAuthenticated]);

  useEffect(() => {
    const node = chatListRef.current;
    if (!node) {
      return;
    }

    node.scrollTop = node.scrollHeight;
  }, [chatMessages]);

  const sourceRelatedVideos = dedupeVideoList(relatedVideos);
  const uniqueRelatedVideos = dedupeRelatedRailVideos(sourceRelatedVideos, currentVideo.id);
  const displayedRenderableRelatedVideos = dedupeRelatedRailVideos(displayedRelatedVideos, currentVideo.id);
  const activePlaylistSummary = activePlaylistId
    ? playlistRailSummaries.find((playlist) => playlist.id === activePlaylistId) ?? null
    : null;
  const activePlaylistTrackCount = playlistRailData
    ? Math.max(playlistRailData.videos.length, playlistRailData.itemCount ?? activePlaylistSummary?.itemCount ?? 0)
    : (activePlaylistSummary?.itemCount ?? 0);

  useEffect(() => {
    const currentSignature = displayedRelatedVideos.map((video) => video.id).join("|");
    const nextSignature = sourceRelatedVideos.map((video) => video.id).join("|");

    if (currentSignature === nextSignature) {
      return;
    }

    if (displayedRelatedVideos.length === 0) {
      setDisplayedRelatedVideos(sourceRelatedVideos);
      setRelatedTransitionPhase("idle");
      return;
    }

    pendingRelatedVideosRef.current = sourceRelatedVideos;

    if (relatedTransitionPhase === "loading") {
      setDisplayedRelatedVideos(sourceRelatedVideos);
      pendingRelatedVideosRef.current = null;
      setRelatedTransitionPhase("fading-in");
      return;
    }

    if (relatedTransitionPhase === "idle") {
      setRelatedTransitionPhase("fading-out");
    }
  }, [displayedRelatedVideos, sourceRelatedVideos, relatedTransitionPhase]);

  useEffect(() => {
    if (relatedTransitionTimeoutRef.current !== null) {
      window.clearTimeout(relatedTransitionTimeoutRef.current);
      relatedTransitionTimeoutRef.current = null;
    }

    if (relatedTransitionPhase === "fading-out") {
      if (watchNextRailRef.current) {
        watchNextRailRef.current.scrollTop = 0;
      }
      const delayMs = RELATED_FADE_OUT_BASE_MS + RELATED_FADE_STAGGER_MS * Math.max(0, displayedRelatedVideos.length - 1);
      relatedTransitionTimeoutRef.current = window.setTimeout(() => {
        const next = pendingRelatedVideosRef.current;
        if (next) {
          setDisplayedRelatedVideos(next);
          pendingRelatedVideosRef.current = null;
          setRelatedTransitionPhase("fading-in");
          return;
        }

        setDisplayedRelatedVideos([]);
        setRelatedTransitionPhase("loading");
      }, delayMs);
      return;
    }

    if (relatedTransitionPhase === "fading-in") {
      const delayMs = RELATED_FADE_IN_BASE_MS + RELATED_FADE_STAGGER_MS * Math.max(0, displayedRelatedVideos.length - 1);
      relatedTransitionTimeoutRef.current = window.setTimeout(() => {
        setRelatedTransitionPhase("idle");
      }, delayMs);
    }

    return () => {
      if (relatedTransitionTimeoutRef.current !== null) {
        window.clearTimeout(relatedTransitionTimeoutRef.current);
        relatedTransitionTimeoutRef.current = null;
      }
    };
  }, [displayedRelatedVideos.length, relatedTransitionPhase]);

  const visibleNavItems = (
    isAuthenticated
      ? navItems
      : navItems.filter(
          (item) =>
            !["/favourites", "/playlists", "/account"].includes(item.href),
        )
  ).filter((item) => item.href !== "/" && item.href !== "/ai");

  function getNavHref(href: string) {
    const params = new URLSearchParams();
    params.set("v", currentVideo.id);
    params.set("resume", "1");

    if (href === "/artists") {
      params.set("letter", activeArtistLetter);
    }

    return `${href}?${params.toString()}`;
  }

  function getRelatedThumbnail(id: string) {
    return `https://i.ytimg.com/vi/${encodeURIComponent(id)}/mqdefault.jpg`;
  }

  function getActivatePlaylistHref(playlistId: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("v", currentVideo.id);
    params.set("resume", "1");
    params.set("pl", playlistId);
    params.delete("pli");
    return `/?${params.toString()}`;
  }

  function getClosePlaylistHref() {
    const params = new URLSearchParams(searchParams.toString());
    params.set("v", currentVideo.id);
    params.set("resume", "1");
    params.delete("pl");
    params.delete("pli");
    const query = params.toString();
    return query.length > 0 ? `/?${query}` : "/";
  }

  function prewarmRelatedThumbnail(videoId: string) {
    if (typeof window === "undefined") {
      return;
    }

    if (prewarmedThumbnailIdsRef.current.has(videoId)) {
      return;
    }

    prewarmedThumbnailIdsRef.current.add(videoId);
    const img = new window.Image();
    img.decoding = "async";
    img.src = getRelatedThumbnail(videoId);
  }

  function prefetchCurrentVideoPayload(videoId: string) {
    if (Date.now() < prefetchBlockedUntilRef.current) {
      return;
    }

    const cached = prefetchedCurrentVideoPayloadRef.current.get(videoId);
    if (cached && cached.expiresAt > Date.now()) {
      return;
    }

    if (inFlightCurrentVideoPrefetchRef.current.has(videoId)) {
      return;
    }

    inFlightCurrentVideoPrefetchRef.current.add(videoId);
    void fetch(`/api/current-video?v=${encodeURIComponent(videoId)}`, {
      cache: "no-store",
    })
      .then(async (response) => {
        if (!response.ok) {
          prefetchFailureCountRef.current = Math.min(prefetchFailureCountRef.current + 1, 6);
          const backoffMs = Math.min(
            PREFETCH_FAILURE_MAX_BACKOFF_MS,
            PREFETCH_FAILURE_BASE_BACKOFF_MS * (2 ** prefetchFailureCountRef.current),
          );
          prefetchBlockedUntilRef.current = Date.now() + backoffMs;
          return;
        }

        const data = (await response.json()) as CurrentVideoResolvePayload;
        if (!data.currentVideo?.id) {
          prefetchFailureCountRef.current = Math.min(prefetchFailureCountRef.current + 1, 6);
          const backoffMs = Math.min(
            PREFETCH_FAILURE_MAX_BACKOFF_MS,
            PREFETCH_FAILURE_BASE_BACKOFF_MS * (2 ** prefetchFailureCountRef.current),
          );
          prefetchBlockedUntilRef.current = Date.now() + backoffMs;
          return;
        }

        if (data.currentVideo?.id === videoId) {
          prefetchFailureCountRef.current = 0;
          prefetchBlockedUntilRef.current = 0;
          prefetchedCurrentVideoPayloadRef.current.set(videoId, {
            expiresAt: Date.now() + CURRENT_VIDEO_PREFETCH_TTL_MS,
            payload: data,
          });

          for (const related of (data.relatedVideos ?? []).slice(0, 6)) {
            prewarmRelatedThumbnail(related.id);
          }
        }
      })
      .catch(() => {
        prefetchFailureCountRef.current = Math.min(prefetchFailureCountRef.current + 1, 6);
        const backoffMs = Math.min(
          PREFETCH_FAILURE_MAX_BACKOFF_MS,
          PREFETCH_FAILURE_BASE_BACKOFF_MS * (2 ** prefetchFailureCountRef.current),
        );
        prefetchBlockedUntilRef.current = Date.now() + backoffMs;
      })
      .finally(() => {
        inFlightCurrentVideoPrefetchRef.current.delete(videoId);
      });
  }

  function prefetchRelatedSelection(video: VideoRecord) {
    prewarmRelatedThumbnail(video.id);

    if (!prefetchedRelatedIdsRef.current.has(video.id)) {
      prefetchedRelatedIdsRef.current.add(video.id);
      prefetchCurrentVideoPayload(video.id);
    }

    if (typeof window !== "undefined") {
      window.sessionStorage.setItem(
        PENDING_VIDEO_SELECTION_KEY,
        JSON.stringify({
          id: video.id,
          title: video.title,
          channelTitle: video.channelTitle,
          genre: video.genre,
          favourited: video.favourited,
          description: video.description,
        }),
      );
    }
  }

  function buildGeneratedPlaylistName() {
    const now = new Date();
    const datePart = now.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
    const timePart = now.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    });
    return `Playlist ${datePart} ${timePart}`;
  }

  async function handleAddToPlaylistFromWatchNext(track: VideoRecord) {
    if (playlistMutationPendingVideoId) {
      return;
    }

    setPlaylistMutationPendingVideoId(track.id);
    setPlaylistMutationMessage(null);
    setPlaylistMutationTone("info");

    try {
      if (activePlaylistId) {
        const addResponse = await fetchWithAuthRetry(`/api/playlists/${encodeURIComponent(activePlaylistId)}/items`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ videoId: track.id }),
        });

        if (addResponse.status === 401 || addResponse.status === 403) {
          setIsAuthenticated(false);
          setPlaylistMutationTone("error");
          setPlaylistMutationMessage("Sign in to save tracks to playlists.");
          return;
        }

        if (!addResponse.ok) {
          setPlaylistMutationTone("error");
          setPlaylistMutationMessage("Could not add track to playlist.");
          return;
        }
        return;
      }

      const createResponse = await fetchWithAuthRetry("/api/playlists", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: buildGeneratedPlaylistName(),
          videoIds: [],
        }),
      });

      if (createResponse.status === 401 || createResponse.status === 403) {
        setIsAuthenticated(false);
        setPlaylistMutationTone("error");
        setPlaylistMutationMessage("Sign in to create playlists.");
        return;
      }

      if (!createResponse.ok) {
        setPlaylistMutationTone("error");
        setPlaylistMutationMessage("Could not create playlist.");
        return;
      }

      const created = (await createResponse.json()) as { id?: string };

      if (!created.id) {
        setPlaylistMutationTone("error");
        setPlaylistMutationMessage("Playlist was created but could not be opened.");
        return;
      }

      const addResponse = await fetchWithAuthRetry(`/api/playlists/${encodeURIComponent(created.id)}/items`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ videoId: track.id }),
      });

      if (addResponse.status === 401 || addResponse.status === 403) {
        setIsAuthenticated(false);
        setPlaylistMutationTone("error");
        setPlaylistMutationMessage("Sign in to save tracks to playlists.");
        return;
      }

      if (!addResponse.ok) {
        setPlaylistMutationTone("error");
        setPlaylistMutationMessage("Playlist created, but this track could not be added.");
        return;
      }

      const params = new URLSearchParams(searchParams.toString());
      params.set("v", currentVideo.id);
      params.set("resume", "1");
      params.set("pl", created.id);
      params.delete("pli");
      router.replace(`/?${params.toString()}`);
    } catch {
      setPlaylistMutationTone("error");
      setPlaylistMutationMessage("Could not update playlists right now.");
    } finally {
      setPlaylistMutationPendingVideoId(null);
    }
  }

  useEffect(() => {
    if (!playlistMutationMessage) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setPlaylistMutationMessage(null);
    }, 2500);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [playlistMutationMessage]);

  async function handleChatSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (chatMode === "online") {
      return;
    }

    const content = chatDraft.trim();
    if (!content) {
      return;
    }

    setIsChatSubmitting(true);
    setChatError(null);

    try {
      const response = await fetchWithAuthRetry("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          mode: chatMode,
          videoId: chatMode === "video" ? currentVideo.id : undefined,
          content,
        }),
      });

      if (response.status === 401 || response.status === 403) {
        setIsAuthenticated(false);
        setChatError(null);
        return;
      }

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        setChatError(payload?.error ?? "Unable to send message.");
        return;
      }

      const payload = (await response.json()) as { message?: ChatMessage };
      if (payload.message) {
        setChatMessages((current) => {
          if (current.some((message) => message.id === payload.message?.id)) {
            return current;
          }
          return [...current, payload.message as ChatMessage];
        });
      }
      setChatDraft("");
    } catch {
      setChatError("Unable to send message.");
    } finally {
      setIsChatSubmitting(false);
    }
  }

  useEffect(() => {
    for (const video of displayedRelatedVideos.slice(0, 6)) {
      prewarmRelatedThumbnail(video.id);
    }
  }, [displayedRelatedVideos]);

  useEffect(() => {
    if (isOverlayRoute) {
      return;
    }

    const topTargets = sourceRelatedVideos
      .filter((video) => video.id !== currentVideo.id)
      .slice(0, 3);
    if (topTargets.length === 0) {
      return;
    }

    let cancelled = false;
    const timeoutId = window.setTimeout(() => {
      if (cancelled) {
        return;
      }

      for (const target of topTargets) {
        prefetchCurrentVideoPayload(target.id);
      }
    }, 120);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [currentVideo.id, isOverlayRoute, sourceRelatedVideos]);

  useEffect(() => {
    if (!isAuthenticated) {
      return;
    }

    let cancelled = false;

    const checkAuthState = async () => {
      try {
        const response = await fetchWithAuthRetry("/api/auth/me");

        if (cancelled) {
          return;
        }

        if (response.status === 401 || response.status === 403) {
          setIsAuthenticated(false);
          setChatError(null);
        }
      } catch {
        // Ignore transient network errors and keep current UI state.
      }
    };

    void checkAuthState();
    const intervalId = window.setInterval(() => {
      void checkAuthState();
    }, 60_000);

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void checkAuthState();
      }
    };

    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [fetchWithAuthRetry, isAuthenticated]);

  useEffect(() => {
    if (isAuthenticated) {
      return;
    }

    if (!isProtectedOverlayPath(pathname)) {
      return;
    }

    const params = new URLSearchParams(searchParams.toString());
    params.set("v", currentVideo.id);
    params.set("resume", "1");
    params.delete("pl");
    params.delete("pli");
    const query = params.toString();
    router.replace(query ? `/?${query}` : "/");
  }, [currentVideo.id, isAuthenticated, pathname, router, searchParams]);

  // Dismiss suggestions when clicking outside the combobox
  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      if (searchComboboxRef.current && !searchComboboxRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
        setActiveSuggestionIdx(-1);
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  useEffect(() => {
    return () => {
      if (suggestDebounceRef.current) {
        clearTimeout(suggestDebounceRef.current);
        suggestDebounceRef.current = null;
      }

      if (suggestAbortRef.current) {
        suggestAbortRef.current.abort();
        suggestAbortRef.current = null;
      }
    };
  }, []);

  function handleSearchInput(e: React.ChangeEvent<HTMLInputElement>) {
    const value = e.target.value;
    setSearchValue(value);
    setActiveSuggestionIdx(-1);

    if (suggestDebounceRef.current) clearTimeout(suggestDebounceRef.current);

    const trimmed = value.trim();
    latestSuggestQueryRef.current = trimmed;

    if (suggestAbortRef.current) {
      suggestAbortRef.current.abort();
      suggestAbortRef.current = null;
    }

    if (!trimmed) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    suggestDebounceRef.current = setTimeout(async () => {
      const controller = new AbortController();
      suggestAbortRef.current = controller;

      try {
        const res = await fetch(`/api/search/suggest?q=${encodeURIComponent(trimmed)}`, { signal: controller.signal });
        if (res.ok) {
          const data = await res.json() as { suggestions: SearchSuggestion[] };
          if (latestSuggestQueryRef.current !== trimmed) {
            return;
          }
          setSuggestions(data.suggestions);
          setShowSuggestions(data.suggestions.length > 0);
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        // non-critical — ignore suggest failures silently
      } finally {
        if (suggestAbortRef.current === controller) {
          suggestAbortRef.current = null;
        }
      }
    }, 220);
  }

  function handleSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    const isOpen = showSuggestions && suggestions && suggestions.length > 0;

    if (e.key === "ArrowDown") {
      if (isOpen) {
        e.preventDefault();
        e.stopPropagation();
        setActiveSuggestionIdx((prev) => Math.min(prev + 1, suggestions!.length - 1));
      }
    } else if (e.key === "ArrowUp") {
      if (isOpen) {
        e.preventDefault();
        e.stopPropagation();
        setActiveSuggestionIdx((prev) => Math.max(prev - 1, -1));
      }
    } else if (e.key === "Escape") {
      if (isOpen) {
        e.preventDefault();
        e.stopPropagation();
        setShowSuggestions(false);
        setActiveSuggestionIdx(-1);
      }
    } else if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();

      // Only navigate to a suggestion when one is explicitly highlighted.
      if (isOpen && suggestions && activeSuggestionIdx >= 0) {
        const selected = suggestions[activeSuggestionIdx];
        if (selected) {
          handleSuggestionClick(selected);
          return;
        }
      }

      // No dropdown - search with the query text
      if (searchValue.trim()) {
        router.push(`/search?q=${encodeURIComponent(searchValue.trim())}&v=${encodeURIComponent(currentVideo.id)}`);
        setShowSuggestions(false);
        setSearchValue("");
      }
    }
  }

  function handleSuggestionClick(suggestion: SearchSuggestion) {
    const url = suggestion.type === "track"
      ? suggestion.url
      : `${suggestion.url}?v=${encodeURIComponent(currentVideo.id)}&resume=1`;
    setShowSuggestions(false);
    setSearchValue("");
    router.push(url);
  }

  return (
    <main className={isOverlayRoute ? "shell shellOverlayRoute" : "shell"}>
      <div className="backdrop" />

      <header className="topbar">
        <div className="brandLockup">
          <Link href="/" aria-label="Yeh That Rocks home">
            <Image
              src="/assets/images/yeh4.png"
              alt="Yeh That Rocks"
              width={306}
              height={102}
              priority
              className="brandLogo"
            />
          </Link>
          <h1 className="brandTagline">The world&apos;s loudest website</h1>
        </div>

        <div className="headerBar">
          <nav className="mainNav" aria-label="Primary">
            {visibleNavItems.map((item) => {
              const isActive = isRouteActive(item.href, pathname);
              return (
                <Link
                  key={item.href}
                  href={getNavHref(item.href)}
                  className={isActive ? "navLink navLinkActive" : "navLink"}
                >
                  {item.href === "/categories" ? (
                    <>
                      <span className="navCategoryGlyph" aria-hidden="true">
                        ☣
                      </span>
                      <span>{item.label}</span>
                    </>
                  ) : item.href === "/artists" ? (
                    <>
                      <span className="navArtistsGlyph" aria-hidden="true">
                        🎸︎
                      </span>
                      <span>{item.label}</span>
                    </>
                  ) : item.href === "/top100" ? (
                    <>
                      <span className="navTop100Glyph" aria-hidden="true">
                        🏆︎
                      </span>
                      <span>{item.label}</span>
                    </>
                  ) : item.href === "/favourites" ? (
                    <>
                      <span className="navFavouritesGlyph" aria-hidden="true">
                        ❤️
                      </span>
                      <span>{item.label}</span>
                    </>
                  ) : item.href === "/playlists" ? (
                    <>
                      <span className="navPlaylistsGlyph" aria-hidden="true">
                        ♬
                      </span>
                      <span>{item.label}</span>
                    </>
                  ) : item.href === "/account" ? (
                    <>
                      <span className="navAccountGlyph" aria-hidden="true">
                        👤
                      </span>
                      <span>{item.label}</span>
                    </>
                  ) : (
                    item.label
                  )}
                </Link>
              );
            })}
          </nav>

          <div className="searchWrap">
            <div className="searchBar">
              <div className="searchCombobox" ref={searchComboboxRef} role="combobox" aria-expanded={showSuggestions} aria-haspopup="listbox">
                <input
                  id="search"
                  type="search"
                  placeholder="Search rock, metal, artists, playlists..."
                  required
                  autoComplete="off"
                  value={searchValue}
                  onChange={handleSearchInput}
                  onKeyDown={handleSearchKeyDown}
                  onFocus={() => {
                    if (searchValue.trim().length >= 1 && suggestions.length > 0) {
                      setShowSuggestions(true);
                    }
                  }}
                  aria-expanded={showSuggestions}
                  aria-autocomplete="list"
                  aria-controls="search-suggestions"
                  aria-activedescendant={activeSuggestionIdx >= 0 ? `search-suggestion-${activeSuggestionIdx}` : undefined}
                />
                {showSuggestions && suggestions.length > 0 && (
                  <ul className="searchSuggestions" id="search-suggestions" role="listbox">
                    {suggestions.map((s, i) => (
                      <li key={`${s.type}-${s.label}`} role="option" aria-selected={i === activeSuggestionIdx}>
                        <button
                          type="button"
                          id={`search-suggestion-${i}`}
                          className="searchSuggestionItem"
                          aria-selected={i === activeSuggestionIdx}
                          onPointerDown={(e) => {
                            e.preventDefault(); // prevent input blur before click fires
                            handleSuggestionClick(s);
                          }}
                        >
                          <span className="searchSuggestionType">{s.type}</span>
                          <span className="searchSuggestionLabel">{s.label}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <button
                type="button"
                onClick={() => {
                  if (searchValue.trim()) {
                    router.push(`/search?q=${encodeURIComponent(searchValue.trim())}&v=${encodeURIComponent(currentVideo.id)}`);
                    setShowSuggestions(false);
                    setSearchValue("");
                  }
                }}
              >
                Search
              </button>
              <label className="searchLabel srOnly" htmlFor="search">
                Search artists, tracks, and chaos
              </label>
            </div>
          </div>
        </div>
      </header>

      <section className={isOverlayRoute ? "heroGrid heroGridOverlayRoute" : "heroGrid"}>
        {isArtistsIndexRoute ? (
          <ArtistsLetterNav
            activeLetter={activeArtistLetter}
            v={activeVideoId}
            resume={resumeParam}
          />
        ) : null}

        <aside
          className={
            isOverlayRoute
              ? "leftRail panel translucent railOccluded"
              : "leftRail panel translucent"
          }
          aria-hidden={isOverlayRoute}
          inert={isOverlayRoute ? true : undefined}
        >
          {isAuthenticated ? (
            <>
              <div className="railTabs">
                <button
                  type="button"
                  className={`${chatMode === "global" ? "activeTab" : ""} ${flashingChatTabs.global ? "attentionPulse" : ""}`.trim() || undefined}
                  onClick={() => setChatMode("global")}
                >
                  Global Chat
                </button>
                <button
                  type="button"
                  className={`${chatMode === "video" ? "activeTab" : ""} ${flashingChatTabs.video ? "attentionPulse" : ""}`.trim() || undefined}
                  onClick={() => setChatMode("video")}
                >
                  Video Chat
                </button>
                <button
                  type="button"
                  className={chatMode === "online" ? "activeTab" : undefined}
                  onClick={() => setChatMode("online")}
                >
                  Who&apos;s Online
                </button>
              </div>

              <div className="chatList" ref={chatListRef}>
                {isChatLoading ? <p className="chatStatus">Loading chat...</p> : null}
                {!isChatLoading && chatMode !== "online" && chatMessages.length === 0 ? (
                  <p className="chatStatus">
                    {chatMode === "global"
                      ? "No global messages yet. Start the noise."
                      : "No messages for this video yet. Say something about the current track."}
                  </p>
                ) : null}
                {chatMode === "online" ? (
                  !isChatLoading && onlineUsers.length === 0 ? (
                    <p className="chatStatus">No users currently online.</p>
                  ) : (
                    onlineUsers.map((user) => (
                      <article
                        key={user.id}
                        className="chatMessage chatMessageClickable"
                        onClick={() => router.push(`/u/${encodeURIComponent(user.name)}`)}
                      >
                        {user.avatarUrl ? (
                          <Image src={user.avatarUrl} alt="" width={88} height={88} className="chatAvatar" />
                        ) : (
                          <div className="avatar">{user.name.slice(0, 1)}</div>
                        )}
                        <div>
                          <div className="messageMeta">
                            <strong>{user.name}</strong>
                            <span className="chatOnlineBadge" title="Online now">● Online</span>
                            <span>{user.lastSeen ? formatChatTimestamp(user.lastSeen) : "Now"}</span>
                          </div>
                          <p>Online now</p>
                        </div>
                      </article>
                    ))
                  )
                ) : (
                  chatMessages.map((message) => {
                    const isUserOnline = onlineUsers.some((u) => u.name === message.user.name);
                    const sharedVideo = parseSharedVideoMessage(message.content);
                    return (
                      <article
                        key={message.id}
                        className="chatMessage chatMessageClickable"
                        onClick={() => router.push(`/u/${encodeURIComponent(message.user.name)}`)}
                      >
                        {message.user.avatarUrl ? (
                          <Image src={message.user.avatarUrl} alt="" width={88} height={88} className="chatAvatar" />
                        ) : (
                          <div className="avatar">{message.user.name.slice(0, 1)}</div>
                        )}
                        <div>
                          <div className="messageMeta">
                            <strong>{message.user.name}</strong>
                            {isUserOnline ? <span className="chatOnlineBadge" title="Online now">● Online</span> : null}
                            <span>{formatChatTimestamp(message.createdAt)}</span>
                          </div>
                          {sharedVideo ? (
                            <>
                              <SharedVideoMessageCard videoId={sharedVideo.videoId} />
                            </>
                          ) : (
                            <p>{message.content}</p>
                          )}
                        </div>
                      </article>
                    );
                  })
                )}
              </div>

              {chatMode !== "online" ? (
                <>
                  <form className="chatComposer" onSubmit={handleChatSubmit}>
                    <input
                      type="text"
                      placeholder={chatMode === "global" ? "Message the global room..." : `Talk about ${currentVideo.title}...`}
                      value={chatDraft}
                      onChange={(event) => setChatDraft(event.target.value)}
                      maxLength={200}
                      disabled={isChatSubmitting}
                    />
                    <button type="submit" disabled={isChatSubmitting || chatDraft.trim().length === 0}>
                      {isChatSubmitting ? "Sending..." : "Send"}
                    </button>
                  </form>
                  {chatError ? <p className="chatStatus chatStatusError">{chatError}</p> : null}
                </>
              ) : null}
            </>
          ) : (
            <div className="guestRail">
              <div className="panelHeading guestRailHeading">
                <span>Members only</span>
                <strong>
                  Sign in to join chat, save favourites, and build playlists
                </strong>
              </div>

              <AuthLoginForm />

              <div className="guestRailActions">
                <Link href="/register" className="navLink">
                  Create account
                </Link>
                <Link href="/forgot-password" className="navLink">
                  Forgot password?
                </Link>
              </div>
            </div>
          )}
        </aside>

        <section className="playerStage">
          <div className="playerChrome">
            {deniedPlaybackMessage ? (
              <div className="playbackDeniedBanner" role="status" aria-live="polite">
                <span>{deniedPlaybackMessage}</span>
                <button
                  type="button"
                  className="playbackDeniedClose"
                  onClick={() => setDeniedPlaybackMessage(null)}
                  aria-label="Dismiss message"
                >
                  x
                </button>
              </div>
            ) : null}

            <Suspense fallback={<div className="playerLoadingFallback" />}>
              {isResolvingInitialVideo || isResolvingRequestedVideo ? (
                <div className="playerLoadingFallback" role="status" aria-live="polite" aria-label={routeLoadingLabel}>
                  <div className="playerBootLoader">
                    <div className="playerBootBars" aria-hidden="true">
                      <span />
                      <span />
                      <span />
                      <span />
                    </div>
                    <p>{routeLoadingLabel}...</p>
                  </div>
                </div>
              ) : (
                <PlayerExperience
                  currentVideo={currentVideo}
                  queue={[currentVideo, ...uniqueRelatedVideos]}
                  isLoggedIn={isAuthenticated}
                />
              )}
            </Suspense>

            {isOverlayRoute ? (
              <section
                key={overlayRouteKey}
                className={disableOverlayDropAnimation ? "favouritesBlind favouritesBlindNoDrop" : "favouritesBlind"}
                aria-label="Page overlay"
              >
                <div ref={favouritesBlindInnerRef} className="favouritesBlindInner">{children}</div>
              </section>
            ) : null}
          </div>
        </section>

        <aside
          ref={watchNextRailRef}
          className={
            isOverlayRoute
              ? "rightRail panel translucent railOccluded"
              : "rightRail panel translucent"
          }
          aria-hidden={isOverlayRoute}
          inert={isOverlayRoute ? true : undefined}
        >
          <div className="railTabs rightRailTabs">
            {isAuthenticated ? (
              <button
                type="button"
                className={rightRailMode === "watch-next" ? "activeTab" : undefined}
                onClick={() => setRightRailMode("watch-next")}
              >
                Watch Next
              </button>
            ) : (
              <span className={rightRailMode === "watch-next" ? "tabLabel activeTab" : "tabLabel"}>Watch Next</span>
            )}
            {isAuthenticated ? (
              <button
                type="button"
                className={rightRailMode === "playlist" ? "activeTab" : undefined}
                onClick={() => setRightRailMode("playlist")}
              >
                Playlist
              </button>
            ) : null}
          </div>

          {rightRailMode === "watch-next" ? (
            <div
              className={`relatedStack${
                relatedTransitionPhase === "fading-out"
                  ? " relatedStackFadingOut"
                  : relatedTransitionPhase === "fading-in"
                    ? " relatedStackFadingIn"
                    : ""
              }`}
            >
              {playlistMutationMessage ? (
                <p className={`rightRailStatus rightRailStatus${playlistMutationTone === "success" ? "Success" : playlistMutationTone === "error" ? "Error" : "Info"}`}>
                  {playlistMutationMessage}
                </p>
              ) : null}

              {relatedTransitionPhase === "loading" ? (
                <div className="relatedLoadingState" role="status" aria-live="polite" aria-busy="true">
                  <span className="playerBootBars" aria-hidden="true">
                    <span />
                    <span />
                    <span />
                    <span />
                  </span>
                  <span>Loading related videos...</span>
                </div>
              ) : null}

              {displayedRenderableRelatedVideos.map((track, index) => (
                <div
                  key={track.id}
                  className="relatedCardSlot"
                >
                  <Link
                    href={`/?v=${track.id}`}
                    className="relatedCard linkedCard relatedCardTransition"
                    style={{ "--related-index": index } as CSSProperties}
                    onMouseEnter={() => prefetchRelatedSelection(track)}
                    onFocus={() => prefetchRelatedSelection(track)}
                    onPointerDown={() => prefetchRelatedSelection(track)}
                  >
                    <div className="thumbGlow">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={getRelatedThumbnail(track.id)}
                        alt={track.title}
                        loading={index < 3 ? "eager" : "lazy"}
                        fetchPriority={index < 2 ? "high" : "auto"}
                        className="relatedThumb"
                      />
                    </div>
                    <div>
                      <h3>{track.title}</h3>
                      <p>
                        <ArtistWikiLink artistName={track.channelTitle} videoId={track.id} className="artistInlineLink">
                          {track.channelTitle}
                        </ArtistWikiLink>
                      </p>
                    </div>
                  </Link>
                  {isAuthenticated ? (
                    <button
                      type="button"
                      className="relatedCardPlaylistAdd"
                      aria-label={`Add ${track.title} to playlist`}
                      title={activePlaylistId ? "Add to current playlist" : "Create playlist and add"}
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        void handleAddToPlaylistFromWatchNext(track);
                      }}
                      disabled={playlistMutationPendingVideoId === track.id}
                    >
                      {playlistMutationPendingVideoId === track.id ? "..." : "+"}
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <div className="relatedStack relatedStackPlaylist">
              {activePlaylistId ? (
                <div className="rightRailPlaylistBar">
                  <span className="rightRailPlaylistLabel">
                    {playlistRailData
                      ? `${playlistRailData.name} • ${activePlaylistTrackCount} ${activePlaylistTrackCount === 1 ? "track" : "tracks"}`
                      : "Active playlist"}
                  </span>
                  <Link href={getClosePlaylistHref()} className="rightRailPlaylistClose">
                    Close playlist
                  </Link>
                </div>
              ) : null}

              <div className="relatedStackPlaylistBody">

              {!activePlaylistId ? (
                isPlaylistSummaryLoading ? (
                  <div className="relatedLoadingState" role="status" aria-live="polite" aria-busy="true">
                    <span className="playerBootBars" aria-hidden="true">
                      <span />
                      <span />
                      <span />
                      <span />
                    </span>
                    <span>Loading playlists...</span>
                  </div>
                ) : playlistSummaryError ? (
                  <p className="rightRailStatus">{playlistSummaryError}</p>
                ) : playlistRailSummaries.length > 0 ? (
                  playlistRailSummaries.map((playlist) => {
                    const hasLeadThumbnail = playlist.itemCount > 0 && playlist.leadVideoId !== "__placeholder__";

                    return (
                      <Link
                        key={playlist.id}
                        href={getActivatePlaylistHref(playlist.id)}
                        className="relatedCard linkedCard rightRailPlaylistCard"
                      >
                        <div className="thumbGlow">
                          {hasLeadThumbnail ? (
                            <Image
                              src={getRelatedThumbnail(playlist.leadVideoId)}
                              alt=""
                              width={128}
                              height={72}
                              unoptimized
                              loading="lazy"
                              className="relatedThumb"
                            />
                          ) : (
                            <div className="playlistRailThumbPlaceholder" aria-hidden="true">♬</div>
                          )}
                        </div>
                        <div>
                          <h3>{playlist.name}</h3>
                          <p>{playlist.itemCount} {playlist.itemCount === 1 ? "track" : "tracks"}</p>
                        </div>
                      </Link>
                    );
                  })
                ) : (
                  <p className="rightRailStatus">No playlists yet. Create one in Playlists.</p>
                )
              ) : isPlaylistRailLoading ? (
                <div className="relatedLoadingState" role="status" aria-live="polite" aria-busy="true">
                  <span className="playerBootBars" aria-hidden="true">
                    <span />
                    <span />
                    <span />
                    <span />
                  </span>
                  <span>Loading playlist tracks...</span>
                </div>
              ) : playlistRailError ? (
                <p className="rightRailStatus">{playlistRailError}</p>
              ) : playlistRailData && playlistRailData.videos.length > 0 ? (
                playlistRailData.videos.map((track, index) => {
                  const isCurrentPlaylistTrack = currentVideo.id === track.id;
                  return (
                    <Link
                      key={`${track.id}-${index}`}
                      href={`/?v=${track.id}&pl=${encodeURIComponent(playlistRailData.id)}&pli=${index}`}
                      className={`relatedCard linkedCard rightRailPlaylistTrackCard${isCurrentPlaylistTrack ? " relatedCardActive" : ""}`}
                    >
                      <div className="thumbGlow">
                        <Image
                          src={getRelatedThumbnail(track.id)}
                          alt={track.title}
                          width={128}
                          height={72}
                          unoptimized
                          loading={index < 3 ? "eager" : "lazy"}
                          fetchPriority={index < 2 ? "high" : "auto"}
                          className="relatedThumb"
                        />
                      </div>
                      <div>
                        <h3>{track.title}</h3>
                        <p>
                          <ArtistWikiLink artistName={track.channelTitle} videoId={track.id} className="artistInlineLink">
                            {track.channelTitle}
                          </ArtistWikiLink>
                        </p>
                      </div>
                    </Link>
                  );
                })
              ) : (
                <p className="rightRailStatus">This playlist has no tracks yet.</p>
              )}
              </div>
            </div>
          )}
        </aside>
      </section>
    </main>
  );
}

export function ShellDynamic(props: ShellDynamicProps) {
  return (
    <Suspense>
      <ShellDynamicInner {...props} />
    </Suspense>
  );
}
