import Link from "next/link";

import { AppShell } from "@/components/app-shell";
import { PlaylistCreator } from "@/components/playlist-creator";
import { getCurrentVideo, getPlaylists, getRelatedVideos, getTopVideos } from "@/lib/catalog-data";
import { getCurrentAuthenticatedUser } from "@/lib/server-auth";

export default async function PlaylistsPage() {
  const user = await getCurrentAuthenticatedUser();
  const [playlists, topVideos] = await Promise.all([getPlaylists(user?.id), getTopVideos()]);
  const leadVideoId = playlists[0]?.leadVideoId ?? "SU1apJTv94o";
  const [currentVideo, relatedVideos] = await Promise.all([
    getCurrentVideo(leadVideoId),
    getRelatedVideos(leadVideoId)
  ]);

  return (
    <AppShell
      activePath="/playlists"
      currentVideo={currentVideo}
      relatedVideos={relatedVideos}
      kicker="Playlists"
      title="Named playlist surface"
      description="The playlists route is now part of the preview, ready for create, manage, share, and sequential playback once persistence is added."
    >
      <section className="panel featurePanel spanTwoColumns">
        <div className="panelHeading">
          <span>Playlists</span>
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
    </AppShell>
  );
}
