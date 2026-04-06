"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import { ArtistWikiLink } from "@/components/artist-wiki-link";
import type { VideoRecord } from "@/lib/catalog";

type PlaylistCreatorProps = {
  suggestedVideos: VideoRecord[];
  isAuthenticated: boolean;
};

export function PlaylistCreator({ suggestedVideos, isAuthenticated }: PlaylistCreatorProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>(suggestedVideos.slice(0, 2).map((video) => video.id));
  const [message, setMessage] = useState<string | null>(null);
  const disabled = isPending || name.trim().length < 2 || !isAuthenticated;

  const selectedCount = useMemo(() => selectedIds.length, [selectedIds]);

  function toggleVideo(videoId: string) {
    setSelectedIds((current) =>
      current.includes(videoId) ? current.filter((id) => id !== videoId) : [...current, videoId]
    );
  }

  function createPlaylist() {
    startTransition(async () => {
      setMessage(null);

      const response = await fetch("/api/playlists", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: name.trim(), videoIds: selectedIds }),
      });

      if (!response.ok) {
        setMessage(response.status === 401 ? "Sign in to create playlists." : "Playlist creation failed. Check the name and try again.");
        return;
      }

      const playlist = (await response.json()) as { id: string };
      setMessage("Playlist created.");
      router.push(`/playlists/${playlist.id}`);
      router.refresh();
    });
  }

  return (
    <div className="interactiveStack">
      <label className="fieldLabel" htmlFor="playlist-name">
        Playlist name
      </label>
      <input
        id="playlist-name"
        className="surfaceInput"
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="New loud playlist"
      />

      <div className="selectionGrid">
        {suggestedVideos.map((video) => {
          const isSelected = selectedIds.includes(video.id);

          return (
            <button
              key={video.id}
              type="button"
              className={isSelected ? "selectionChip selectionChipActive" : "selectionChip"}
              onClick={() => toggleVideo(video.id)}
              disabled={isPending}
            >
              <strong>{video.title}</strong>
              <span>
                <ArtistWikiLink
                  artistName={video.channelTitle}
                  videoId={video.id}
                  className="artistInlineLink"
                >
                  {video.channelTitle}
                </ArtistWikiLink>
              </span>
            </button>
          );
        })}
      </div>

      <div className="actionRow">
        <button type="button" onClick={createPlaylist} disabled={disabled}>
          {isAuthenticated ? "Create playlist" : "Login to create"}
        </button>
        <span className="contractHint">
          {isAuthenticated ? `${selectedCount} tracks selected for the initial queue.` : "Authentication is required to create saved playlists."}
        </span>
      </div>

      {message ? <p className="mutationMessage">{message}</p> : null}
    </div>
  );
}