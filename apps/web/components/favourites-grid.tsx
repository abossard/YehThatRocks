"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import { AddToPlaylistButton } from "@/components/add-to-playlist-button";
import { ArtistWikiLink } from "@/components/artist-wiki-link";
import type { VideoRecord } from "@/lib/catalog";

type FavouritesGridProps = {
  initialFavourites: VideoRecord[];
  isAuthenticated: boolean;
};

export function FavouritesGrid({ initialFavourites, isAuthenticated }: FavouritesGridProps) {
  const pathname = usePathname();
  const [favourites, setFavourites] = useState<VideoRecord[]>(initialFavourites);
  const [pendingVideoId, setPendingVideoId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (!isAuthenticated || pathname !== "/favourites") {
      return;
    }

    let isCancelled = false;

    async function refreshFavourites() {
      try {
        const response = await fetch("/api/favourites", {
          method: "GET",
          cache: "no-store",
        });

        if (!response.ok) {
          return;
        }

        const payload = (await response.json().catch(() => null)) as
          | {
              favourites?: VideoRecord[];
            }
          | null;

        if (!isCancelled && Array.isArray(payload?.favourites)) {
          setFavourites(payload.favourites);
        }
      } catch {
        // Keep the initial server-provided favourites if refresh fails.
      }
    }

    void refreshFavourites();

    const handleFavouritesUpdated = () => {
      void refreshFavourites();
    };

    window.addEventListener("ytr:favourites-updated", handleFavouritesUpdated);

    return () => {
      isCancelled = true;
      window.removeEventListener("ytr:favourites-updated", handleFavouritesUpdated);
    };
  }, [isAuthenticated, pathname]);

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
              <article key={track.id} className="catalogCard categoryCard favouritesCardCompact">
                <div className="favouritesThumbOverlayWrap">
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
                  <button
                    type="button"
                    className="favouritesDeleteButton favouritesDeleteOverlayButton"
                    onClick={() => removeFavourite(track.id)}
                    disabled={!isAuthenticated || isPending || isRemoving}
                    aria-label={`Remove ${track.title} from favourites`}
                    title="Remove from favourites"
                  >
                    {isRemoving ? "…" : "🗑"}
                  </button>
                </div>
                <h3>
                  <Link href={`/?v=${track.id}`} className="cardTitleLink">
                    {track.title}
                  </Link>
                </h3>
                <p>
                  <ArtistWikiLink artistName={track.channelTitle} videoId={track.id} className="artistInlineLink">
                    {track.channelTitle}
                  </ArtistWikiLink>
                </p>
                <div className="actionRow favouritesCardActionsRow">
                  <AddToPlaylistButton videoId={track.id} isAuthenticated={isAuthenticated} />
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
