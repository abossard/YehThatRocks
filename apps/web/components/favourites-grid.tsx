"use client";

import Image from "next/image";
import Link from "next/link";
import { useState, useTransition } from "react";

import type { VideoRecord } from "@/lib/catalog";

type FavouritesGridProps = {
  initialFavourites: VideoRecord[];
  isAuthenticated: boolean;
};

export function FavouritesGrid({ initialFavourites, isAuthenticated }: FavouritesGridProps) {
  const [favourites, setFavourites] = useState<VideoRecord[]>(initialFavourites);
  const [pendingVideoId, setPendingVideoId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function removeFavourite(videoId: string) {
    if (!isAuthenticated) {
      setMessage("Sign in to manage favourites.");
      return;
    }

    startTransition(async () => {
      setPendingVideoId(videoId);
      setMessage(null);

      try {
        const response = await fetch("/api/favourites", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            videoId,
            action: "remove",
          }),
        });

        if (response.status === 401 || response.status === 403) {
          setMessage("Sign in to manage favourites.");
          return;
        }

        if (!response.ok) {
          setMessage("Could not remove favourite. Please try again.");
          return;
        }

        setFavourites((current) => current.filter((track) => track.id !== videoId));
        setMessage("Track removed from favourites.");
      } catch {
        setMessage("Could not remove favourite. Please try again.");
      } finally {
        setPendingVideoId(null);
      }
    });
  }

  return (
    <>
      {favourites.length > 0 ? (
        <div className="catalogGrid favouritesCatalogGrid">
          {favourites.map((track) => {
            const isRemoving = pendingVideoId === track.id;

            return (
              <article key={track.id} className="catalogCard categoryCard">
                <Link href={`/?v=${track.id}`} className="linkedCard">
                  <div className="categoryThumbWrap">
                    <Image
                      src={`https://i.ytimg.com/vi/${track.id}/mqdefault.jpg`}
                      alt=""
                      width={320}
                      height={180}
                      className="categoryThumb"
                      loading="lazy"
                    />
                  </div>
                </Link>
                <p className="statusLabel">Favourited Track</p>
                <h3>
                  <Link href={`/?v=${track.id}`} className="cardTitleLink">
                    {track.title}
                  </Link>
                </h3>
                <p>{track.channelTitle}</p>
                <div className="actionRow">
                  <button
                    type="button"
                    onClick={() => removeFavourite(track.id)}
                    disabled={!isAuthenticated || isPending || isRemoving}
                    aria-label={`Remove ${track.title} from favourites`}
                  >
                    {isRemoving ? "Removing..." : "Delete"}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="favouritesEmptyState" role="status" aria-live="polite">
          <h3>There are no favourites saved yet.</h3>
          <p>Save tracks with the heart button to build your favourites list.</p>
        </div>
      )}

      {message ? <p className="mutationMessage">{message}</p> : null}
    </>
  );
}
