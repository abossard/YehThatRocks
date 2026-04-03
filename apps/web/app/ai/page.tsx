import Link from "next/link";

import { AppShell } from "@/components/app-shell";
import { getAiTracks, getCurrentVideo, getRelatedVideos } from "@/lib/catalog-data";

export default async function AiPage() {
  const [tracks, currentVideo, relatedVideos] = await Promise.all([
    getAiTracks(),
    getCurrentVideo("47e_961OQWE"),
    getRelatedVideos("47e_961OQWE")
  ]);

  return (
    <AppShell
      activePath="/ai"
      currentVideo={currentVideo}
      relatedVideos={relatedVideos}
      kicker="AI tracks"
      title="Clearly labelled AI music section"
      description="The AI route is now visible as a separate experience, ready for artwork, audio playback, votes, and prompt transparency."
    >
      <section className="panel featurePanel spanTwoColumns">
        <div className="panelHeading">
          <span>AI library</span>
          <strong>Seeded tracks for the future dedicated section</strong>
        </div>
        <div className="catalogGrid">
          {tracks.map((track) => (
            <Link key={track.id} href={`/ai/${track.id}`} className="catalogCard linkedCard aiTrackCard">
              <p className="statusLabel">{track.tool}</p>
              <h3>{track.title}</h3>
              <p>{track.genre}</p>
              <p>Score {track.score} · {track.playCount.toLocaleString()} plays</p>
              <p className="promptPreview">{track.prompt}</p>
            </Link>
          ))}
        </div>
      </section>
    </AppShell>
  );
}

