import Link from "next/link";

import { CloseLink } from "@/components/close-link";
import { PlaylistCreator } from "@/components/playlist-creator";
import { getPlaylists, getTopVideos } from "@/lib/catalog-data";
import { getCurrentAuthenticatedUser } from "@/lib/server-auth";

export default async function PlaylistsPage() {
  const user = await getCurrentAuthenticatedUser();
  const [playlists, topVideos] = await Promise.all([getPlaylists(user?.id), getTopVideos()]);

  return (
    <>
      <div className="favouritesBlindBar">
        <strong><span className="whitePlaylistGlyph" aria-hidden="true">♬</span> Playlists</strong>
        <CloseLink />
      </div>

      <section className="panel featurePanel spanTwoColumns">
        <div className="panelHeading">
          <span><span className="whitePlaylistGlyph" aria-hidden="true">♬</span> Playlists</span>
          <strong>{user ? "Saved queue collections" : "Sign in to load playlists"}</strong>
        </div>
        <div className="catalogGrid">
          {playlists.length > 0 ? playlists.map((playlist) => (
            <Link key={playlist.id} href={`/playlists/${playlist.id}`} className="catalogCard linkedCard">
              <p className="statusLabel">Playlist {playlist.id}</p>
              <h3>{playlist.name}</h3>
              <p>{playlist.itemCount} tracks</p>
            </Link>
          )) : (
            <article className="catalogCard">
              <p className="statusLabel">Playlists</p>
              <h3>{user ? "No playlists yet" : "Login required"}</h3>
              <p>{user ? "Create your first saved queue below." : "Sign in to create and manage personal playlists."}</p>
            </article>
          )}
        </div>

        <div className="panelInset">
          <div className="panelHeading compactHeading">
            <span>Create playlist</span>
            <strong>POST contract now wired into the preview UI</strong>
          </div>
          <PlaylistCreator suggestedVideos={topVideos.slice(0, 5)} isAuthenticated={Boolean(user)} />
        </div>
      </section>
    </>
  );
}
