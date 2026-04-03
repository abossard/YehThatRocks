import Link from "next/link";

import { AppShell } from "@/components/app-shell";
import { getArtists, getCurrentVideo, getRelatedVideos } from "@/lib/catalog-data";

export default async function ArtistsPage() {
  const [artists, currentVideo, relatedVideos] = await Promise.all([
    getArtists(),
    getCurrentVideo("iPW9AbRMwFU"),
    getRelatedVideos("iPW9AbRMwFU")
  ]);

  return (
    <AppShell
      activePath="/artists"
      currentVideo={currentVideo}
      relatedVideos={relatedVideos}
      kicker="Artist directory"
      title="Catalogue depth on display"
      description="This route establishes the browsing surface for the 139k-artist dataset so Phase 2 can plug in real pagination and genre filters without redesigning the page."
    >
      <section className="panel featurePanel spanTwoColumns">
        <div className="panelHeading">
          <span>A-Z foundation</span>
          <strong>Artist directory preview</strong>
        </div>
        <div className="catalogGrid">
          {artists.map((artist) => (
            <Link key={artist.slug} href={`/artist/${artist.slug}`} className="catalogCard linkedCard">
              <p className="statusLabel">{artist.country}</p>
              <h3>{artist.name}</h3>
              <p>{artist.genre}</p>
            </Link>
          ))}
        </div>
      </section>
    </AppShell>
  );
}
