import Link from "next/link";

import { AppShell } from "@/components/app-shell";
import { getCurrentVideo, getGenreSlug, getRelatedVideos, searchCatalog } from "@/lib/catalog-data";

type SearchPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const query = typeof resolvedSearchParams?.q === "string" ? resolvedSearchParams.q : "";
  const results = await searchCatalog(query);
  const currentVideo = await getCurrentVideo(results.videos[0]?.id);
  const relatedVideos = await getRelatedVideos(currentVideo.id);

  return (
    <AppShell
      activePath="/search"
      currentVideo={currentVideo}
      relatedVideos={relatedVideos}
      kicker="Search"
      title={query ? `Results for “${query}”` : "Search the catalogue"}
      description="Search now resolves to its own route and surfaces videos, artists, and genre matches in one place."
    >
      <section className="panel featurePanel">
        <div className="panelHeading">
          <span>Videos</span>
          <strong>{results.videos.length} matching tracks</strong>
        </div>
        <div className="trackStack">
          {results.videos.map((video) => (
            <Link key={video.id} href={`/?v=${video.id}`} className="trackCard linkedCard">
              <div>
                <h3>{video.title}</h3>
                <p>{video.channelTitle}</p>
              </div>
              <span className="queueBadge">Play</span>
            </Link>
          ))}
        </div>
      </section>

      <section className="panel featurePanel">
        <div className="panelHeading">
          <span>Catalogue matches</span>
          <strong>Artists and genres</strong>
        </div>
        <div className="catalogGrid compactGrid">
          {results.artists.map((artist) => (
            <Link key={artist.slug} href={`/artist/${artist.slug}`} className="catalogCard linkedCard">
              <p className="statusLabel">Artist</p>
              <h3>{artist.name}</h3>
              <p>{artist.genre}</p>
            </Link>
          ))}
          {results.genres.map((genre) => (
            <Link key={genre} href={`/categories/${getGenreSlug(genre)}`} className="catalogCard linkedCard">
              <p className="statusLabel">Genre</p>
              <h3>{genre}</h3>
              <p>Open category route</p>
            </Link>
          ))}
        </div>
      </section>
    </AppShell>
  );
}
