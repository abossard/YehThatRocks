"use client";

import { ChangeEvent, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import type { VideoRecord } from "@/lib/catalog";

type PlayerExperienceProps = {
  currentVideo: VideoRecord;
  queue: VideoRecord[];
};

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
const UNAVAILABLE_PLAYER_CODES = new Set([5, 100, 101, 150]);

function logPlayerDebug(event: string, detail?: Record<string, unknown>) {
  if (process.env.NODE_ENV !== "development") {
    return;
  }

  const payload = detail ? ` ${JSON.stringify(detail)}` : "";
  console.log(`[player] ${event}${payload}`);
}

function toSafeNumber(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
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

export function PlayerExperience({ currentVideo, queue }: PlayerExperienceProps) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const playerElementRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<YouTubePlayer | null>(null);
  const overlayTimeoutRef = useRef<number | null>(null);
  const isBootstrappingHistoryRef = useRef(true);
  const previousVideoIdRef = useRef<string | null>(null);
  const [autoplayEnabled, setAutoplayEnabled] = useState(false);
  const [copied, setCopied] = useState(false);
  const [historyStack, setHistoryStack] = useState<string[]>([]);
  const [showNowPlayingOverlay, setShowNowPlayingOverlay] = useState(false);
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
    const progressIntervalRef = useRef<number | null>(null);
    const nowPlayingShownForVideoRef = useRef<string | null>(null);
    const reportedUnavailableVideoIdRef = useRef<string | null>(null);
    const playAttemptedAtRef = useRef<number | null>(null);

  const currentIndex = queue.findIndex((video) => video.id === currentVideo.id);
  const nextVideo = currentIndex >= 0 ? queue[(currentIndex + 1) % queue.length] : queue[0];

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
    playAttemptedAtRef.current = null;
    setHasPlaybackStarted(false);
    setShowControls(false);
  }, [currentVideo.id]);

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

      if (shouldSkip && nextVideo.id !== currentVideo.id) {
        navigateToVideo(nextVideo.id);
      }
    }, 4500);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [currentVideo.id, isPlayerReady, isPlaying, nextVideo.id, playerHostMode]);

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
          },
          onStateChange: (event) => {
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

            if (event.data === window.YT?.PlayerState.ENDED && autoplayEnabled) {
              navigateToVideo(nextVideo.id);
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

            if (shouldSkip && nextVideo.id !== currentVideo.id) {
              logPlayerDebug("onError:navigate-next", {
                currentVideoId: currentVideo.id,
                nextVideoId: nextVideo.id,
              });
              navigateToVideo(nextVideo.id);
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
  }, [autoplayEnabled, currentVideo.id, nextVideo.id, playerHostMode]);

  useEffect(() => {
    return () => {
      if (overlayTimeoutRef.current) {
        window.clearTimeout(overlayTimeoutRef.current);
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

  function navigateToVideo(videoId: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("v", videoId);
    router.push(`${pathname}?${params.toString()}`);
  }

  function handlePrevious() {
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
    navigateToVideo(nextVideo.id);
  }

  function handleToggleAutoplay() {
    setAutoplayEnabled((currentValue) => {
      const nextValue = !currentValue;
      window.localStorage.setItem(AUTOPLAY_KEY, String(nextValue));
      return nextValue;
    });
  }

  async function handleCopyShareLink() {
    const params = new URLSearchParams(searchParams.toString());
    params.set("v", currentVideo.id);
    const shareUrl = `${window.location.origin}${pathname}?${params.toString()}`;

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
        await handleCopyShareLink();
        setShowShareMenu(false);
      }

      async function handleShareToSocials() {
        const params = new URLSearchParams(searchParams.toString());
        params.set("v", currentVideo.id);
        const shareUrl = `${window.location.origin}${pathname}?${params.toString()}`;

        if (navigator.share) {
          try {
            await navigator.share({ title: currentVideo.title, url: shareUrl });
          } catch {
            // dismissed
          }
        } else {
          window.open(
            `https://twitter.com/intent/tweet?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(currentVideo.title)}`,
            "_blank",
            "noopener,noreferrer",
          );
        }

        setShowShareMenu(false);
      }

      function handlePlayPause() {
        if (!playerRef.current) return;
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
            className={isPlayerReady ? "playerFrame playerFrameLoaded" : "playerFrame"}
            onMouseEnter={() => setShowControls(true)}
            onMouseLeave={() => {
              setShowControls(false);
              setShowShareMenu(false);
            }}
          >
            <div ref={playerElementRef} className="playerMount" />

            {isPlayerReady && (
              <div className={!hasPlaybackStarted || showControls ? "playerOverlay playerOverlayVisible" : "playerOverlay"}>
                <div className="overlayTopRight">
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
                          {copied ? "Link Copied!" : "Share to Global Chat"}
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
                  <input
                    type="range"
                    className="overlayProgress"
                    min={0}
                    max={Math.max(1, toSafeNumber(duration, 0))}
                    step={0.5}
                    value={Math.max(0, toSafeNumber(currentTime, 0))}
                    onChange={handleSeek}
                    aria-label="Seek"
                  />
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
          </div>

          <div className="primaryActions">
            <button type="button">Add to Favourites</button>
            <button type="button" onClick={handlePrevious} disabled={historyStack.length < 2}>
              Previous Track
            </button>
            <button type="button" onClick={handleNext}>
              Next Track
            </button>
            <button type="button" onClick={handleToggleAutoplay}>
              Autoplay {autoplayEnabled ? "On" : "Off"}
            </button>
          </div>
        </>
      );
    }
