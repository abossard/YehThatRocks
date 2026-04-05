"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useRef } from "react";

type Top100VideoLinkProps = {
  track: {
    id: string;
    title: string;
    channelTitle: string;
    genre: string;
    favourited: number;
    description: string;
    thumbnail?: string | null;
  };
  index: number;
};

const PENDING_VIDEO_SELECTION_KEY = "ytr:pending-video-selection";

function getLeaderboardThumbnail(track: { id: string; thumbnail?: string | null }) {
  const thumbnail = track.thumbnail?.trim();
  return thumbnail && thumbnail.length > 0
    ? thumbnail
    : `https://i.ytimg.com/vi/${encodeURIComponent(track.id)}/mqdefault.jpg`;
}

export function Top100VideoLink({ track, index }: Top100VideoLinkProps) {
  const hasWarmedRef = useRef(false);

  const warmSelection = useCallback(() => {
    if (typeof window !== "undefined") {
      window.sessionStorage.setItem(
        PENDING_VIDEO_SELECTION_KEY,
        JSON.stringify({
          id: track.id,
          title: track.title,
          channelTitle: track.channelTitle,
          genre: track.genre,
          favourited: track.favourited,
          description: track.description,
        }),
      );
    }

    if (hasWarmedRef.current) {
      return;
    }

    hasWarmedRef.current = true;
    void fetch(`/api/current-video?v=${encodeURIComponent(track.id)}`, {
      cache: "no-store",
    }).catch(() => undefined);
  }, [track]);

  return (
    <Link
      href={`/?v=${track.id}&resume=1`}
      className="trackCard linkedCard leaderboardCard"
      onMouseEnter={warmSelection}
      onFocus={warmSelection}
      onPointerDown={warmSelection}
      onClick={warmSelection}
    >
      <div className="leaderboardRank">#{index + 1}</div>
      <div className="leaderboardThumbWrap">
        <Image
          src={getLeaderboardThumbnail(track)}
          alt=""
          width={160}
          height={90}
          className="leaderboardThumb"
          loading="lazy"
        />
      </div>
      <div className="leaderboardMeta">
        <h3>{track.title}</h3>
        <p>
          {track.channelTitle} · {track.favourited.toLocaleString()} favourites
        </p>
      </div>
    </Link>
  );
}
