import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";

import { ArtistVideoLink } from "@/components/artist-video-link";
import { CloseLink } from "@/components/close-link";
import { ACCESS_TOKEN_COOKIE } from "@/lib/auth-config";
import { getArtistBySlug, getVideosByArtist } from "@/lib/catalog-data";
import { withVideoContext } from "@/lib/artist-routing";

type ArtistPageProps = {
  params: Promise<{ slug: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ArtistPage({ params, searchParams }: ArtistPageProps) {
  const cookieStore = await cookies();
  const isAuthenticated = Boolean(cookieStore.get(ACCESS_TOKEN_COOKIE)?.value);
  const { slug } = await params;
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const letter = typeof resolvedSearchParams?.letter === "string" ? resolvedSearchParams.letter : undefined;
  const v = typeof resolvedSearchParams?.v === "string" ? resolvedSearchParams.v : undefined;
  const resume = typeof resolvedSearchParams?.resume === "string" ? resolvedSearchParams.resume : undefined;
  const artist = await getArtistBySlug(slug);

  if (!artist) {
    notFound();
  }

  const artistsParams = new URLSearchParams();
  if (letter) artistsParams.set("letter", letter);
  if (v) artistsParams.set("v", v);
  if (resume) artistsParams.set("resume", resume);
  const artistsHref = artistsParams.toString() ? `/artists?${artistsParams.toString()}` : "/artists";
  const wikiHref = withVideoContext(`/artist/${encodeURIComponent(artist.slug)}/wiki`, v, resume === "1");

  const artistVideos = await getVideosByArtist(artist.name);

  return (
    <>
      <div className="favouritesBlindBar">
        <strong>
          <span className="categoryHeaderBreadcrumb" aria-label="Breadcrumb">
            <span className="categoryHeaderIcon" aria-hidden="true">🎸</span>
            <Link href={artistsHref} className="categoryHeaderBreadcrumbLink">
              Artists
            </Link>
            <span className="categoryHeaderBreadcrumbSeparator" aria-hidden="true">&gt;</span>
            <span className="categoryHeaderBreadcrumbCurrent" aria-current="page">{artist.name}</span>
          </span>
        </strong>
        <Link href={wikiHref} className="categoryHeaderWikiLink">Wiki</Link>
        <CloseLink />
      </div>

      <div className="categoryVideoGrid artistVideoGrid">
        {artistVideos.map((video) => (
          <ArtistVideoLink key={video.id} video={video} isAuthenticated={isAuthenticated} />
        ))}
      </div>
    </>
  );
}
