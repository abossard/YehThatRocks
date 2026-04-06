"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { ArtistWikiLink } from "@/components/artist-wiki-link";
import type { VideoRecord } from "@/lib/catalog";

type PlaylistItemAdderProps = {
  playlistId: string;
  videos: VideoRecord[];
  isAuthenticated: boolean;
};

export function PlaylistItemAdder({ playlistId, videos, isAuthenticated }: PlaylistItemAdderProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  function addVideo(videoId: string) {
    startTransition(async () => {
      setMessage(null);

      const response = await fetch(`/api/playlists/${playlistId}/items`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ videoId }),
      });

      if (!response.ok) {
        setMessage(response.status === 401 ? "Sign in to modify playlists." : "Could not add that track to the playlist.");
        return;
      }

      setMessage("Track added to playlist.");
      router.refresh();
    });
  }

  return (
    <div className="interactiveStack">
      <div className="trackStack compactStack">
        {videos.map((video) => (
          <div key={video.id} className="trackCard actionCard compactCard">
            <div>
              <h3>{video.title}</h3>
              <p>
                <ArtistWikiLink artistName={video.channelTitle} videoId={video.id} className="artistInlineLink">
                  {video.channelTitle}
                </ArtistWikiLink>
              </p>
            </div>
            <button type="button" onClick={() => addVideo(video.id)} disabled={isPending || !isAuthenticated}>
              {isAuthenticated ? "Add" : "Login"}
            </button>
          </div>
        ))}
      </div>

      {message ? <p className="mutationMessage">{message}</p> : null}
    </div>
  );
}