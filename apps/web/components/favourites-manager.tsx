"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { ArtistWikiLink } from "@/components/artist-wiki-link";
import type { VideoRecord } from "@/lib/catalog";

type FavouritesManagerProps = {
  favourites: VideoRecord[];
  candidates: VideoRecord[];
  isAuthenticated: boolean;
};

export function FavouritesManager({ favourites, candidates, isAuthenticated }: FavouritesManagerProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const favouriteIds = new Set(favourites.map((video) => video.id));

  function updateFavourite(videoId: string, action: "add" | "remove") {
    startTransition(async () => {
      setMessage(null);

      const response = await fetch("/api/favourites", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ videoId, action }),
      });

      if (!response.ok) {
        setMessage(response.status === 401 ? "Sign in to manage favourites." : "Favourite update failed. Try again.");
        return;
      }

      setMessage(action === "add" ? "Track added to favourites." : "Track removed from favourites.");
      router.refresh();
    });
  }

  return (
    <div className="interactiveStack">
      <div className="trackStack">
        {favourites.length > 0 ? favourites.map((track) => (
          <div key={track.id} className="trackCard actionCard">
            <div>
              <Link href={`/?v=${track.id}`} className="cardTitleLink">
                <h3>{track.title}</h3>
              </Link>
              <p>
                <ArtistWikiLink artistName={track.channelTitle} videoId={track.id} className="artistInlineLink">
                  {track.channelTitle}
                </ArtistWikiLink>
              </p>
            </div>
            <button type="button" onClick={() => updateFavourite(track.id, "remove")} disabled={isPending}>
              Remove
            </button>
          </div>
        )) : (
          <div className="catalogCard">
            <p className="statusLabel">Favourites</p>
            <h3>{isAuthenticated ? "No favourites yet" : "Sign in required"}</h3>
            <p>{isAuthenticated ? "Start saving tracks from the quick-add list below." : "Login to create a personal favourites collection."}</p>
          </div>
        )}
      </div>

      <div className="panelInset">
        <div className="panelHeading compactHeading">
          <span>Quick add</span>
          <strong>Top tracks available for one-click save</strong>
        </div>
        <div className="trackStack compactStack">
          {candidates.map((track) => {
            const isFavourite = favouriteIds.has(track.id);

            return (
              <div key={track.id} className="trackCard actionCard compactCard">
                <div>
                  <h3>{track.title}</h3>
                  <p>{track.genre}</p>
                </div>
                <button
                  type="button"
                  onClick={() => updateFavourite(track.id, isFavourite ? "remove" : "add")}
                  disabled={isPending || !isAuthenticated}
                >
                  {!isAuthenticated ? "Login" : isFavourite ? "Saved" : "Add"}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {message ? <p className="mutationMessage">{message}</p> : null}
    </div>
  );
}