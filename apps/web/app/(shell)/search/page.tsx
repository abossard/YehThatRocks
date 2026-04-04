import Link from "next/link";

import { CloseLink } from "@/components/close-link";
import { getGenreSlug, searchCatalog } from "@/lib/catalog-data";

type SearchPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const query = typeof resolvedSearchParams?.q === "string" ? resolvedSearchParams.q : "";
  const results = await searchCatalog(query);
  const uniqueArtists = Array.from(new Map(results.artists.map((artist) => [artist.slug, artist])).values());
  const uniqueGenres = Array.from(new Set(results.genres));

  return (
    <>
      <div className="favouritesBlindBar">
        <strong>Search</strong>
        <CloseLink />
      </div>

      <section className="panel featurePanel">
        <div className="panelHeading">
          <span>Videos</span>
          <strong>{results.videos.length} matching tracks</strong>
        </div>
        <div className="trackStack">
          {results.videos.map((video) => (
            <Link key={video.id} href={`/?v=${video.id}&resume=1`} className="trackCard linkedCard">
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
          {uniqueArtists.map((artist) => (
            <Link key={artist.slug} href={`/artist/${artist.slug}`} className="catalogCard linkedCard">
              <p className="statusLabel">Artist</p>
              <h3>{artist.name}</h3>
              <p>{artist.genre}</p>
            </Link>
          ))}
          {uniqueGenres.map((genre) => (
            <Link key={genre} href={`/categories/${getGenreSlug(genre)}`} className="catalogCard linkedCard">
              <p className="statusLabel">Genre</p>
              <h3>{genre}</h3>
              <p>Open category route</p>
            </Link>
          ))}
        </div>
      </section>
    </>
  );
}
