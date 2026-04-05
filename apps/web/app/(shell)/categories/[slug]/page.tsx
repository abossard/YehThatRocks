import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

import { CategoriesScrollReset } from "@/components/categories-scroll-reset";
import { CloseLink } from "@/components/close-link";
import {
  getGenreBySlug,
  getGenres,
  getGenreSlug,
  getVideosByGenre,
} from "@/lib/catalog-data";

export const revalidate = 3600;

export async function generateStaticParams() {
  const genres = await getGenres();
  return genres.map((genre) => ({ slug: getGenreSlug(genre) }));
}

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

  return (
    <>
      <CategoriesScrollReset />
      <div className="favouritesBlindBar">
        <strong>
          <span className="categoryHeaderBreadcrumb" aria-label="Breadcrumb">
            <span className="categoryHeaderIcon" aria-hidden="true">☣</span>
            <Link href="/categories" className="categoryHeaderBreadcrumbLink">
              Categories
            </Link>
            <span className="categoryHeaderBreadcrumbSeparator" aria-hidden="true">&gt;</span>
            <span className="categoryHeaderBreadcrumbCurrent" aria-current="page">{genre}</span>
          </span>
        </strong>
        <CloseLink />
      </div>

      <div className="categoryVideoGrid">
        {videos.length > 0 ? videos.map((video) => (
          <Link
            key={video.id}
            href={`/?v=${video.id}&resume=1`}
            className="categoryVideoCard linkedCard"
          >
            <div className="categoryThumbWrap">
              <Image
                src={`https://i.ytimg.com/vi/${video.id}/mqdefault.jpg`}
                alt=""
                width={320}
                height={180}
                className="categoryThumb"
                loading="lazy"
              />
            </div>
            <h3 className="categoryVideoTitle">{video.title}</h3>
          </Link>
        )) : (
          <p className="categoryNoVideos">No videos found for this category yet.</p>
        )}
      </div>
    </>
  );
}


