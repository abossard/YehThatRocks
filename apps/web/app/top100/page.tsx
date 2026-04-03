import Link from "next/link";

import { AppShell } from "@/components/app-shell";
import { getCurrentVideo, getRelatedVideos, getTopVideos } from "@/lib/catalog-data";

export default async function TopHundredPage() {
  const topVideos = await getTopVideos(100);
  const heroVideo = topVideos[Math.floor(Math.random() * topVideos.length)];
  const [currentVideo, relatedVideos] = await Promise.all([
    getCurrentVideo(heroVideo?.id),
    getRelatedVideos(heroVideo?.id ?? ""),
  ]);

  return (
    <AppShell
      activePath="/top100"
      currentVideo={currentVideo}
      relatedVideos={relatedVideos}
      kicker="Top 100"
      title="Most favourited videos"
      description="This route now behaves like a recognisable leaderboard surface instead of a placeholder, ready to be swapped over to database-backed ranking."
    >
      <section className="panel featurePanel spanTwoColumns">
        <div className="panelHeading">
          <span>Leaderboard</span>
          <strong>Top-favourited queue source</strong>
        </div>
        <div className="trackStack">
          {topVideos.map((track, index) => (
            <Link key={track.id} href={`/?v=${track.id}`} className="trackCard linkedCard leaderboardCard">
              <div className="leaderboardRank">#{index + 1}</div>
              <div>
                <h3>{track.title}</h3>
                <p>
                  {track.channelTitle} · {track.favourited.toLocaleString()} favourites
                </p>
              </div>
              <span className="queueBadge">Play</span>
            </Link>
          ))}
        </div>
      </section>
    </AppShell>
  );
}
