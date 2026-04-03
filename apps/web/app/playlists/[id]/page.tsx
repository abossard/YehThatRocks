import Link from "next/link";
import { notFound } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { PlaylistItemAdder } from "@/components/playlist-item-adder";
import { getCurrentVideo, getPlaylistById, getRelatedVideos, getTopVideos } from "@/lib/catalog-data";
import { getCurrentAuthenticatedUser } from "@/lib/server-auth";

type PlaylistDetailPageProps = {
  params: Promise<{ id: string }>;
};

export default async function PlaylistDetailPage({ params }: PlaylistDetailPageProps) {
  const { id } = await params;
  const user = await getCurrentAuthenticatedUser();
  const playlist = user ? await getPlaylistById(id, user.id) : null;

  if (!user) {
    const [currentVideo, relatedVideos] = await Promise.all([
      getCurrentVideo("SU1apJTv94o"),
      getRelatedVideos("SU1apJTv94o")
    ]);

    return (
      <AppShell
        activePath="/playlists"
        currentVideo={currentVideo}
        relatedVideos={relatedVideos}
        kicker="Playlist"
        title="Playlist access"
        description="Sign in to view and modify your personal playlists."
      >
        <section className="panel featurePanel spanTwoColumns">
          <div className="panelHeading">
            <span>Playlist access</span>
            <strong>Login required</strong>
          </div>
          <p className="authMessage">You need an authenticated session to open saved playlists.</p>
          <div className="primaryActions compactActions">
            <Link href="/login" className="navLink navLinkActive">Login</Link>
            <Link href="/register" className="navLink">Register</Link>
          </div>
        </section>
      </AppShell>
    );
  }

  if (!playlist) {
    notFound();
  }

  const leadVideoId = playlist.videos[0]?.id ?? "SU1apJTv94o";
  const [currentVideo, relatedVideos] = await Promise.all([
    getCurrentVideo(leadVideoId),
    getRelatedVideos(leadVideoId)
  ]);
  const topVideos = await getTopVideos();
  const availableVideos = topVideos.filter(
    (video) => !playlist.videos.some((playlistVideo) => playlistVideo.id === video.id)
  );

  return (
    <AppShell
      activePath="/playlists"
      currentVideo={currentVideo}
      relatedVideos={relatedVideos}
      kicker="Playlist"
      title={playlist.name}
      description="Shareable playlist route with sequential tracks. This is now aligned with the legacy URL contract for playlist playback."
    >
      <section className="panel featurePanel spanTwoColumns">
        <div className="panelHeading">
          <span>Playlist items</span>
          <strong>{playlist.videos.length} tracks in sequence</strong>
        </div>
        <div className="trackStack">
          {playlist.videos.map((video, index) => (
            <Link key={`${video.id}-${index}`} href={`/?v=${video.id}`} className="trackCard linkedCard">
              <div>
                <h3>{video.title}</h3>
                <p>
                  #{index + 1} · {video.channelTitle}
                </p>
              </div>
              <span className="queueBadge">Play</span>
            </Link>
          ))}
        </div>

        <div className="routeContractRow">
          <Link href={`/api/playlists/${playlist.id}`} className="navLink">
            View JSON Endpoint
          </Link>
          <span className="contractHint">
            POST to <code>/api/playlists/{playlist.id}/items</code> with <code>{'{"videoId":"..."}'}</code>
          </span>
        </div>

        <div className="panelInset">
          <div className="panelHeading compactHeading">
            <span>Add track</span>
            <strong>Preview write-path against the live route</strong>
          </div>
          <PlaylistItemAdder playlistId={playlist.id} videos={availableVideos.slice(0, 4)} isAuthenticated={Boolean(user)} />
        </div>
      </section>
    </AppShell>
  );
}
