"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";

import { AddToPlaylistButton } from "@/components/add-to-playlist-button";
import type { PlaylistSummary } from "@/lib/catalog-data";
import type { PublicUserProfile } from "@/lib/catalog-data";
import type { VideoRecord } from "@/lib/catalog";

type PlaylistDetail = {
  id: string;
  name: string;
  videos: VideoRecord[];
};

type UserProfilePanelProps = {
  user: PublicUserProfile;
  favourites: VideoRecord[];
  playlists: PlaylistSummary[];
};

type ProfileTab = "favourites" | "playlists" | "playlist-detail";

export function UserProfilePanel({ user, favourites, playlists }: UserProfilePanelProps) {
  const [tab, setTab] = useState<ProfileTab>("favourites");
  const [selectedPlaylist, setSelectedPlaylist] = useState<PlaylistDetail | null>(null);
  const [isLoadingPlaylist, setIsLoadingPlaylist] = useState(false);

  const scrollOverlayToTop = () => {
    const overlay = document.querySelector<HTMLElement>(".favouritesBlindInner");
    if (overlay) {
      overlay.scrollTo({ top: 0, left: 0, behavior: "auto" });
    }
  };

  useEffect(() => {
    scrollOverlayToTop();
  }, []);

  useEffect(() => {
    scrollOverlayToTop();
  }, [tab]);

  async function openPlaylist(playlist: PlaylistSummary) {
    setIsLoadingPlaylist(true);
    try {
      const response = await fetch(
        `/api/users/${encodeURIComponent(user.screenName)}/playlists/${encodeURIComponent(playlist.id)}`
      );
      if (response.ok) {
        const data = await response.json() as PlaylistDetail;
        setSelectedPlaylist(data);
        setTab("playlist-detail");
      }
    } catch {
      // Silently fail
    } finally {
      setIsLoadingPlaylist(false);
    }
  }

  function backToPlaylists() {
    setSelectedPlaylist(null);
    setTab("playlists");
  }

  return (
    <div className="userProfilePage">
      <div className="railTabs userProfileTabs">
        <button
          type="button"
          className={tab === "favourites" ? "activeTab" : undefined}
          onClick={() => setTab("favourites")}
        >
          Favourites
        </button>
        <button
          type="button"
          className={tab === "playlists" || tab === "playlist-detail" ? "activeTab" : undefined}
          onClick={() => tab === "playlist-detail" ? backToPlaylists() : setTab("playlists")}
        >
          {tab === "playlist-detail" && selectedPlaylist ? `← ${selectedPlaylist.name}` : "Playlists"}
        </button>
      </div>

      {tab === "favourites" && (
        <section className="userProfileSection">
          {favourites.length > 0 ? (
            <div className="catalogGrid userProfileVideoGrid">
              {favourites.map((track) => (
                <article key={track.id} className="categoryVideoCard">
                  <Link href={`/?v=${track.id}`} className="linkedCard categoryVideoPrimaryLink">
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
                    <h3 className="categoryVideoTitle">{track.title}</h3>
                  </Link>
                  <div className="actionRow categoryVideoActions">
                    <AddToPlaylistButton videoId={track.id} />
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <p className="userProfileEmptyState">No favourites saved yet.</p>
          )}
        </section>
      )}

      {tab === "playlists" && (
        <section className="userProfileSection">
          {playlists.length > 0 ? (
            <div className="userProfilePlaylistGrid">
              {playlists.map((playlist) => (
                <button
                  key={playlist.id}
                  type="button"
                  className="userProfilePlaylistCard"
                  onClick={() => openPlaylist(playlist)}
                  disabled={isLoadingPlaylist}
                >
                  <div className="userProfilePlaylistThumbWrap">
                    {playlist.leadVideoId ? (
                      <Image
                        src={`https://i.ytimg.com/vi/${playlist.leadVideoId}/mqdefault.jpg`}
                        alt=""
                        width={320}
                        height={180}
                        className="userProfilePlaylistThumb"
                        loading="lazy"
                      />
                    ) : (
                      <div className="userProfilePlaylistThumbFallback" aria-hidden="true">♪</div>
                    )}
                  </div>
                  <div className="userProfilePlaylistInfo">
                    <strong className="userProfilePlaylistName">{playlist.name}</strong>
                    <span className="userProfilePlaylistCount">
                      {playlist.itemCount} {playlist.itemCount === 1 ? "track" : "tracks"}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <p className="userProfileEmptyState">No playlists yet.</p>
          )}
        </section>
      )}

      {tab === "playlist-detail" && selectedPlaylist && (
        <section className="userProfileSection">
          {selectedPlaylist.videos.length > 0 ? (
            <div className="catalogGrid userProfileVideoGrid">
              {selectedPlaylist.videos.map((track) => (
                <article key={track.id} className="categoryVideoCard">
                  <Link href={`/?v=${track.id}`} className="linkedCard categoryVideoPrimaryLink">
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
                    <h3 className="categoryVideoTitle">{track.title}</h3>
                  </Link>
                  <div className="actionRow categoryVideoActions">
                    <AddToPlaylistButton videoId={track.id} />
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <p className="userProfileEmptyState">This playlist is empty.</p>
          )}
        </section>
      )}
    </div>
  );
}
