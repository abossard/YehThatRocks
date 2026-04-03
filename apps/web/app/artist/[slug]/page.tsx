import Link from "next/link";
import { notFound } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { getArtistBySlug, getArtists, getRelatedVideos, getTopVideos } from "@/lib/catalog-data";

type ArtistPageProps = {
  params: Promise<{ slug: string }>;
};

export default async function ArtistPage({ params }: ArtistPageProps) {
  const { slug } = await params;
  const artist = await getArtistBySlug(slug);

  if (!artist) {
    notFound();
  }

  const topVideos = await getTopVideos();
  const matchingVideos = topVideos.filter((video) => {
    return video.channelTitle.toLowerCase().includes(artist.name.toLowerCase());
  });

  const featuredVideo = matchingVideos[0] ?? topVideos[0];
  const relatedVideos = await getRelatedVideos(featuredVideo.id);
  const artists = await getArtists();
  const relatedArtists = artists.filter((entry) => entry.slug !== artist.slug).slice(0, 4);

  return (
    <AppShell
      activePath="/artists"
      currentVideo={featuredVideo}
      relatedVideos={relatedVideos}
      kicker="Artist page"
      title={artist.name}
      description={`${artist.country} · ${artist.genre}. This is the first dynamic artist route, ready for the retained catalogue dataset.`}
    >
      <section className="panel featurePanel">
        <div className="panelHeading">
          <span>Artist profile</span>
          <strong>Catalogue-backed route shape</strong>
        </div>
        <div className="catalogCard artistHeroCard">
          <p className="statusLabel">Origin</p>
          <h3>{artist.country}</h3>
          <p>{artist.genre}</p>
        </div>
      </section>

      <section className="panel featurePanel">
        <div className="panelHeading">
          <span>Related artists</span>
          <strong>Shared genre neighbourhood</strong>
        </div>
        <div className="catalogGrid compactGrid">
          {relatedArtists.map((entry) => (
            <Link key={entry.slug} href={`/artist/${entry.slug}`} className="catalogCard linkedCard">
              <p className="statusLabel">{entry.country}</p>
              <h3>{entry.name}</h3>
              <p>{entry.genre}</p>
            </Link>
          ))}
        </div>

        <div className="routeContractRow">
          <Link href={`/api/artists/${artist.slug}`} className="navLink">
            View JSON Endpoint
          </Link>
        </div>
      </section>
    </AppShell>
  );
}
