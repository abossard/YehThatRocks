import Image from "next/image";
import Link from "next/link";

import { AppShell } from "@/components/app-shell";
import { getCurrentVideo, getGenreCards, getGenreSlug, getRelatedVideos } from "@/lib/catalog-data";

export default async function CategoriesPage() {
  const [currentVideo, genreCards, relatedVideos] = await Promise.all([
    getCurrentVideo("v-Su1YXQYek"),
    getGenreCards(),
    getRelatedVideos("v-Su1YXQYek")
  ]);

  return (
    <AppShell
      activePath="/categories"
      currentVideo={currentVideo}
      relatedVideos={relatedVideos}
      kicker="Categories"
      title="Genre browser"
      description="Phase 1 keeps the category surface prominent so the catalogue depth stays visible from the first preview onward."
    >
      <div className="catalogGrid">
        {genreCards.map(({ genre, previewVideoId }) => (
          <Link key={genre} href={`/categories/${getGenreSlug(genre)}`} className="catalogCard categoryCard linkedCard">
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
    </AppShell>
  );
}
