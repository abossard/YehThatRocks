import Link from "next/link";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { getCurrentVideo, getGenres, getRelatedVideos, getTopVideos, normalizeYouTubeVideoId } from "@/lib/catalog-data";

type HomePageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function Home({ searchParams }: HomePageProps) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const rawSelectedVideo = typeof resolvedSearchParams?.v === "string" ? resolvedSearchParams.v : undefined;
  const selectedVideoId = normalizeYouTubeVideoId(rawSelectedVideo) ?? rawSelectedVideo;

  if (!selectedVideoId) {
    const top100 = await getTopVideos(100);
    const pick = top100[Math.floor(Math.random() * top100.length)];
    if (pick?.id) {
      redirect(`/?v=${encodeURIComponent(pick.id)}`);
    }
  }

  const [currentVideo, genres, relatedVideos, topVideos] = await Promise.all([
    getCurrentVideo(selectedVideoId),
    getGenres(),
    getRelatedVideos(selectedVideoId ?? "3YxaaGgTQYM"),
    getTopVideos()
  ]);

  return (
    <AppShell
      activePath="/"
      currentVideo={currentVideo}
      relatedVideos={relatedVideos}
      kicker="Now playing"
      title={currentVideo.title}
      description={currentVideo.description}
    >
      <section className="panel featurePanel">
        <div className="panelHeading">
          <span>Genre browser</span>
          <strong>153 categories ready for migration</strong>
        </div>
        <div className="genreCloud">
          {genres.map((genre) => (
            <Link key={genre} href={`/search?q=${encodeURIComponent(genre)}`} className="genreChip linkChip">
              {genre}
            </Link>
          ))}
        </div>
      </section>

      <section className="panel featurePanel">
        <div className="panelHeading">
          <span>Watch next</span>
          <strong>Session-safe queue with legacy deep links</strong>
        </div>
        <div className="trackStack">
          {topVideos
            .filter((video) => video.id !== currentVideo.id)
            .slice(0, 3)
            .map((track) => (
              <Link key={track.id} href={`/?v=${track.id}`} className="trackCard linkedCard">
                <div>
                  <h3>{track.title}</h3>
                  <p>{track.channelTitle}</p>
                </div>
                <span className="queueBadge">Queue</span>
              </Link>
            ))}
        </div>
      </section>
    </AppShell>
  );
}

