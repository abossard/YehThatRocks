"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { CloseLink } from "@/components/close-link";

const PENDING_ARTIST_BREADCRUMB_KEY = "ytr:pending-artist-breadcrumb";

export default function ArtistDetailLoading() {
  const pathname = usePathname();
  const isWikiRoute = pathname.endsWith("/wiki");
  const slug = useMemo(() => {
    const parts = pathname.split("/").filter(Boolean);
    return isWikiRoute ? parts.at(-2) ?? "" : parts.at(-1) ?? "";
  }, [isWikiRoute, pathname]);
  const [artistLabel, setArtistLabel] = useState("Loading...");

  useEffect(() => {
    const rawValue = window.sessionStorage.getItem(PENDING_ARTIST_BREADCRUMB_KEY);
    if (!rawValue) {
      return;
    }

    try {
      const parsed = JSON.parse(rawValue) as { slug?: string; name?: string };
      if (parsed.slug === slug && typeof parsed.name === "string" && parsed.name.trim()) {
        setArtistLabel(parsed.name.trim());
      }
    } catch {
      // Ignore malformed pending breadcrumb payloads.
    }
  }, [slug]);

  return (
    <>
      <div className="favouritesBlindBar">
        <strong>
          <span className="categoryHeaderBreadcrumb" aria-label="Breadcrumb">
            <span className="categoryHeaderIcon" aria-hidden="true">🎸</span>
            <Link href="/artists" className="categoryHeaderBreadcrumbLink">
              Artists
            </Link>
            <span className="categoryHeaderBreadcrumbSeparator" aria-hidden="true">&gt;</span>
            <span className="categoryHeaderBreadcrumbCurrent" aria-current="page">{artistLabel}</span>
          </span>
        </strong>
        <CloseLink />
      </div>

      <div className="routeContractRow artistLoadingCenter" aria-live="polite" aria-busy="true">
        <span className="playerBootBars" aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
        </span>
        <span>{isWikiRoute ? "Loading wiki..." : "Loading artist videos..."}</span>
      </div>
    </>
  );
}
