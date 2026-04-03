import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import {
  getArtistsByGenre,
  getCurrentVideo,
  getGenreBySlug,
  getRelatedVideos,
  getVideosByGenre
} from "@/lib/catalog-data";

type CategoryPageProps = {
  params: Promise<{ slug: string }>;
};

export default async function CategoryDetailPage({ params }: CategoryPageProps) {
  const { slug } = await params;
  const genre = await getGenreBySlug(slug);

  if (!genre) {
    notFound();
  }

  const videos = await getVideosByGenre(genre);
  const featuredVideo = await getCurrentVideo(videos[0]?.id);
  const [relatedVideos, artists] = await Promise.all([
    getRelatedVideos(featuredVideo.id),
    getArtistsByGenre(genre)
  ]);

  return (
    <AppShell
      activePath="/categories"
      currentVideo={featuredVideo}
      relatedVideos={relatedVideos}
      kicker="Category"
      title={genre}
      description="This route now mirrors the legacy category-detail shape and is ready for cache-backed YouTube and database results."
    >
      <section className="panel featurePanel">
        <div className="panelHeading">
          <span>Videos in category</span>
          <strong>{videos.length} preview results</strong>
        </div>
        <div className="trackStack">
          {videos.map((video) => (
            <Link key={video.id} href={`/?v=${video.id}`} className="trackCard linkedCard">
              <div className="thumbGlow">
                <Image
                  src={`https://i.ytimg.com/vi/${video.id}/mqdefault.jpg`}
                  alt=""
                  width={320}
                  height={180}
                  className="relatedThumb"
                  loading="lazy"
                />
              </div>
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
          <span>Artists in category</span>
          <strong>{artists.length} matching artists</strong>
        </div>
        <div className="catalogGrid compactGrid">
          {artists.map((artist) => (
            <Link key={artist.slug} href={`/artist/${artist.slug}`} className="catalogCard linkedCard">
              <p className="statusLabel">{artist.country}</p>
              <h3>{artist.name}</h3>
              <p>{artist.genre}</p>
            </Link>
          ))}
        </div>

        <div className="routeContractRow">
          <Link href={`/api/categories/${slug}`} className="navLink">
            View JSON Endpoint
          </Link>
        </div>
      </section>
    </AppShell>
  );
}