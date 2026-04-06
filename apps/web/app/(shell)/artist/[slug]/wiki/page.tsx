import Link from "next/link";
import { notFound } from "next/navigation";

import { CloseLink } from "@/components/close-link";
import { getArtistBySlug } from "@/lib/catalog-data";
import { getOrCreateArtistWiki } from "@/lib/artist-wiki";
import { getArtistPagePath, withVideoContext } from "@/lib/artist-routing";

type ArtistWikiPageProps = {
  params: Promise<{ slug: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function renderList(items: string[], emptyLabel = "No verified entries yet.") {
  if (items.length === 0) {
    return <p>{emptyLabel}</p>;
  }

  return (
    <ul className="artistWikiList">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

export default async function ArtistWikiPage({ params, searchParams }: ArtistWikiPageProps) {
  const { slug } = await params;
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const videoId = typeof resolvedSearchParams?.v === "string" ? resolvedSearchParams.v : undefined;
  const resume = typeof resolvedSearchParams?.resume === "string" ? resolvedSearchParams.resume : undefined;

  const artist = await getArtistBySlug(slug);

  if (!artist) {
    notFound();
  }

  const wiki = await getOrCreateArtistWiki(artist.name, slug);

  if (!wiki) {
    notFound();
  }

  const artistPagePath = getArtistPagePath(artist.name);
  const artistPageHref = artistPagePath ? withVideoContext(artistPagePath, videoId, resume === "1") : "/artists";

  return (
    <>
      <div className="favouritesBlindBar">
        <strong>
          <span className="categoryHeaderBreadcrumb" aria-label="Breadcrumb">
            <span className="categoryHeaderIcon" aria-hidden="true">📖</span>
            <Link href="/artists" className="categoryHeaderBreadcrumbLink">
              Artists
            </Link>
            <span className="categoryHeaderBreadcrumbSeparator" aria-hidden="true">&gt;</span>
            <Link href={artistPageHref} className="categoryHeaderBreadcrumbLink">
              {artist.name}
            </Link>
            <span className="categoryHeaderBreadcrumbSeparator" aria-hidden="true">&gt;</span>
            <span className="categoryHeaderBreadcrumbCurrent" aria-current="page">Wiki</span>
          </span>
        </strong>
        <CloseLink />
      </div>

      <section className="artistWikiPage" aria-label={`${artist.name} wiki`}>
        <div className="artistWikiFlow">
          <div className="artistWikiTopRow">
            <article className="artistWikiSection artistWikiOverviewSection">
              <h2>Overview</h2>
              <p>{wiki.sections.overview}</p>
            </article>

            {wiki.images[0] ? (
              <figure className="artistWikiLeadFigure">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={wiki.images[0].url}
                  alt={`${wiki.artistName} photo`}
                  loading="eager"
                  className="artistWikiLeadImage"
                />
              </figure>
            ) : null}
          </div>

          <article className="artistWikiSection">
            <h2>Formation and Backstory</h2>
            <p>{wiki.sections.formationAndBackstory}</p>
          </article>

          <article className="artistWikiSection">
            <h2>Style and Influences</h2>
            <p>{wiki.sections.styleAndInfluences}</p>
          </article>

          <article className="artistWikiSection">
            <h2>Members</h2>
            <h3>Current</h3>
            {renderList(wiki.sections.members.current)}
            <h3>Former</h3>
            {renderList(wiki.sections.members.former)}
            <p className="artistWikiNote">{wiki.sections.members.notes}</p>
          </article>

          <article className="artistWikiSection">
            <h2>Discography</h2>
            <h3>Studio Albums</h3>
            {renderList(wiki.sections.discography.studioAlbums)}
            <h3>Live Albums</h3>
            {renderList(wiki.sections.discography.liveAlbums)}
            <h3>EPs and Compilations</h3>
            {renderList(wiki.sections.discography.epsAndCompilations)}
            <h3>Notable Tracks</h3>
            {renderList(wiki.sections.discography.notableTracks)}
          </article>

          <article className="artistWikiSection">
            <h2>Legacy and Notes</h2>
            <p>{wiki.sections.legacyAndNotes}</p>
          </article>

          <article className="artistWikiSection">
            <h2>Sources</h2>
            {wiki.sources.length > 0 ? (
              <ul className="artistWikiSourceList">
                {wiki.sources.map((source) => (
                  <li key={source.url}>
                    <a href={source.url} target="_blank" rel="noopener noreferrer">{source.title}</a>
                  </li>
                ))}
              </ul>
            ) : (
              <p>No external references were available during generation.</p>
            )}
          </article>
        </div>
      </section>
    </>
  );
}
