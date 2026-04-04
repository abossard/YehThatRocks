"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { MouseEvent } from "react";

import type { ArtistRecord } from "@/lib/catalog";

type ArtistWithCount = ArtistRecord & { videoCount: number };

type ArtistsLetterResultsProps = {
  letter: string;
  initialArtists: ArtistWithCount[];
  initialHasMore: boolean;
  pageSize: number;
  v?: string;
  resume?: string;
};

const PREFETCH_ROOT_MARGIN = "1400px 0px";
const MIN_BUFFER_ROWS = 24;
const PENDING_ARTIST_BREADCRUMB_KEY = "ytr:pending-artist-breadcrumb";

function dedupeArtistsBySlug(rows: ArtistWithCount[]) {
  return Array.from(new Map(rows.map((artist) => [artist.slug, artist])).values());
}

export function ArtistsLetterResults({
  letter,
  initialArtists,
  initialHasMore,
  pageSize,
  v,
  resume,
}: ArtistsLetterResultsProps) {
  const router = useRouter();
  const [artists, setArtists] = useState<ArtistWithCount[]>(() => dedupeArtistsBySlug(initialArtists));
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pendingArtistSlug, setPendingArtistSlug] = useState<string | null>(null);
  const [failedThumbnails, setFailedThumbnails] = useState<Record<string, boolean>>({});
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const requestedOffsetsRef = useRef<Set<number>>(new Set());
  const reportedBrokenThumbnailsRef = useRef<Set<string>>(new Set());
  const prefetchedArtistSlugsRef = useRef<Set<string>>(new Set());
  const nextOffsetRef = useRef<number>(initialArtists.length);

  useEffect(() => {
    setArtists(dedupeArtistsBySlug(initialArtists));
    setHasMore(initialHasMore);
    setIsLoading(false);
    setLoadError(null);
    setPendingArtistSlug(null);
    setFailedThumbnails({});
    nextOffsetRef.current = initialArtists.length;
    requestedOffsetsRef.current = new Set();
    reportedBrokenThumbnailsRef.current = new Set();
  }, [initialArtists, initialHasMore, letter]);

  function handleThumbnailError(artistName: string, artistSlug: string, badVideoId?: string) {
    setFailedThumbnails((current) => {
      if (current[artistSlug]) {
        return current;
      }
      return {
        ...current,
        [artistSlug]: true,
      };
    });

    const reportKey = `${artistSlug}:${badVideoId ?? ""}`;
    if (reportedBrokenThumbnailsRef.current.has(reportKey)) {
      return;
    }
    reportedBrokenThumbnailsRef.current.add(reportKey);

    void fetch("/api/artists/thumbnail", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        artistName,
        badVideoId,
      }),
      cache: "no-store",
      keepalive: true,
    }).catch(() => undefined);
  }

  const baseParams = useMemo(() => {
    const params = new URLSearchParams();
    params.set("letter", letter);
    if (v) params.set("v", v);
    if (resume) params.set("resume", resume);
    return params;
  }, [letter, resume, v]);

  function artistHref(slug: string) {
    return `/artist/${slug}?${baseParams.toString()}`;
  }

  function prefetchArtistPage(artist: ArtistWithCount) {
    if (prefetchedArtistSlugsRef.current.has(artist.slug)) {
      return;
    }

    prefetchedArtistSlugsRef.current.add(artist.slug);
    const href = artistHref(artist.slug);
    router.prefetch(href);

    void fetch(`/api/artists/prefetch?slug=${encodeURIComponent(artist.slug)}`, {
      method: "GET",
      cache: "no-store",
      keepalive: true,
    }).catch(() => undefined);
  }

  function handleArtistClick(event: MouseEvent<HTMLAnchorElement>, artist: ArtistWithCount) {
    if (event.defaultPrevented || event.button !== 0) {
      return;
    }

    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }

    event.preventDefault();
    setPendingArtistSlug(artist.slug);

    window.sessionStorage.setItem(
      PENDING_ARTIST_BREADCRUMB_KEY,
      JSON.stringify({
        slug: artist.slug,
        name: artist.name,
      }),
    );

    const href = artistHref(artist.slug);
    window.requestAnimationFrame(() => {
      router.push(href);
    });
  }

  async function loadMore(offset: number) {
    if (requestedOffsetsRef.current.has(offset)) {
      return;
    }

    requestedOffsetsRef.current.add(offset);
    setIsLoading(true);
    setLoadError(null);

    try {
      const params = new URLSearchParams();
      params.set("letter", letter);
      params.set("offset", String(offset));
      params.set("limit", String(pageSize));

      const response = await fetch(`/api/artists?${params.toString()}`, {
        method: "GET",
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error("Failed to load artists");
      }

      const payload = (await response.json()) as {
        artists: ArtistWithCount[];
        hasMore: boolean;
      };

      nextOffsetRef.current = offset + payload.artists.length;
      setArtists((current) => dedupeArtistsBySlug([...current, ...payload.artists]));
      setHasMore(Boolean(payload.hasMore));
    } catch {
      requestedOffsetsRef.current.delete(offset);
      setLoadError("Could not load more artists. Scroll again to retry.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    if (!hasMore || isLoading) {
      return;
    }

    const remainder = artists.length % pageSize;
    const bufferedRows = remainder === 0 ? pageSize : remainder;
    if (bufferedRows > MIN_BUFFER_ROWS) {
      return;
    }

    void loadMore(nextOffsetRef.current);
  }, [artists.length, hasMore, isLoading, pageSize]);

  useEffect(() => {
    if (!hasMore) {
      return;
    }

    const sentinel = sentinelRef.current;
    if (!sentinel) {
      return;
    }

    const observer = new IntersectionObserver(
      async (entries) => {
        const entry = entries[0];
        if (!entry?.isIntersecting || isLoading || !hasMore) {
          return;
        }

        void loadMore(nextOffsetRef.current);
      },
      {
        root: null,
        rootMargin: PREFETCH_ROOT_MARGIN,
        threshold: 0,
      },
    );

    observer.observe(sentinel);

    return () => {
      observer.disconnect();
    };
  }, [artists.length, hasMore, isLoading, letter, pageSize]);

  return (
    <>
      <div className="catalogGrid">
        {artists.length > 0 ? (
          artists.map((artist) => (
            <Link
              key={artist.slug}
              href={artistHref(artist.slug)}
              className="catalogCard linkedCard artistResultCard"
              onMouseEnter={() => prefetchArtistPage(artist)}
              onFocus={() => prefetchArtistPage(artist)}
              onPointerDown={() => prefetchArtistPage(artist)}
              onClick={(event) => handleArtistClick(event, artist)}
            >
              {artist.thumbnailVideoId && !failedThumbnails[artist.slug] ? (
                <div className="categoryThumbWrap artistResultThumbWrap">
                  <img
                    src={`https://i.ytimg.com/vi/${artist.thumbnailVideoId}/mqdefault.jpg`}
                    alt=""
                    className="categoryThumb"
                    loading="lazy"
                    onError={() => handleThumbnailError(artist.name, artist.slug, artist.thumbnailVideoId)}
                  />
                </div>
              ) : null}
              <p className="statusLabel">{artist.country}</p>
              <h3>{artist.name}</h3>
              <p>{artist.genre}</p>
              <p>{artist.videoCount} videos on file</p>
            </Link>
          ))
        ) : (
          <article className="catalogCard">
            <p className="statusLabel">Artist directory</p>
            <h3>No artists found for {letter}</h3>
            <p>Try another letter from the A-Z buttons above.</p>
          </article>
        )}
      </div>

      {artists.length > 0 ? (
        <div className="routeContractRow" aria-live="polite">
          {pendingArtistSlug ? (
            <>
              <span className="playerBootBars" aria-hidden="true">
                <span />
                <span />
                <span />
                <span />
              </span>
              <span>Opening artist...</span>
            </>
          ) : null}
          {isLoading ? <span>Loading more artists...</span> : null}
          {loadError ? <span>{loadError}</span> : null}
          {!pendingArtistSlug && !isLoading && !hasMore && !loadError ? <span>End of {letter} artists.</span> : null}
        </div>
      ) : null}

      <div ref={sentinelRef} aria-hidden="true" style={{ height: 1 }} />
    </>
  );
}
