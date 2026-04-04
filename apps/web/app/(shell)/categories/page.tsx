import Image from "next/image";
import Link from "next/link";

import { CloseLink } from "@/components/close-link";
import { getGenreCards, getGenreSlug } from "@/lib/catalog-data";

export default async function CategoriesPage() {
  const genreCards = await getGenreCards();

  return (
    <>
      <div className="favouritesBlindBar">
        <strong>
          <span className="categoryHeaderBreadcrumb">☣ Categories</span>
        </strong>
        <CloseLink />
      </div>

      <div className="catalogGrid">
        {genreCards.map(({ genre, previewVideoId }) => (
          <Link
            key={genre}
            href={`/categories/${getGenreSlug(genre)}`}
            prefetch
            className="catalogCard categoryCard linkedCard"
          >
            {previewVideoId ? (
              <div className="categoryThumbWrap">
                <Image
                  src={`https://i.ytimg.com/vi/${previewVideoId}/mqdefault.jpg`}
                  alt=""
                  width={320}
                  height={180}
                  className="categoryThumb"
                  loading="lazy"
                />
              </div>
            ) : null}
            <p className="statusLabel">Category</p>
            <h3>{genre}</h3>
          </Link>
        ))}
      </div>
    </>
  );
}
