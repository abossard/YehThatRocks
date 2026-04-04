"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useRef } from "react";

import type { VideoRecord } from "@/lib/catalog";

const PENDING_VIDEO_SELECTION_KEY = "ytr:pending-video-selection";

type ArtistVideoLinkProps = {
  video: VideoRecord;
};

export function ArtistVideoLink({ video }: ArtistVideoLinkProps) {
  const hasWarmedRef = useRef(false);

  const warmSelection = useCallback(() => {
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

    if (hasWarmedRef.current) {
      return;
    }

    hasWarmedRef.current = true;
    void fetch(`/api/current-video?v=${encodeURIComponent(video.id)}`, {
      cache: "no-store",
    }).catch(() => undefined);
  }, [video]);

  return (
    <Link
      href={`/?v=${video.id}&resume=1`}
      className="categoryVideoCard linkedCard"
      onMouseEnter={warmSelection}
      onFocus={warmSelection}
      onPointerDown={warmSelection}
      onClick={warmSelection}
    >
      <div className="categoryThumbWrap">
        <Image
          src={`https://i.ytimg.com/vi/${video.id}/mqdefault.jpg`}
          alt=""
          width={320}
          height={180}
          className="categoryThumb"
          loading="lazy"
        />
      </div>
      <h3 className="categoryVideoTitle">{video.title}</h3>
    </Link>
  );
}