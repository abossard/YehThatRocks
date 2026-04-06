"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";

import { getArtistWikiPath, withVideoContext } from "@/lib/artist-routing";

type ArtistWikiLinkProps = {
  artistName: string;
  videoId?: string | null;
  className?: string;
  children?: ReactNode;
  title?: string;
  asButton?: boolean;
};

export function ArtistWikiLink({ artistName, videoId, className, children, title, asButton = false }: ArtistWikiLinkProps) {
  const router = useRouter();
  const href = getArtistWikiPath(artistName);

  if (!href) {
    return <span className={className}>{children ?? artistName}</span>;
  }

  const targetHref = withVideoContext(href, videoId, true);

  const openWiki = () => {
    router.push(targetHref);
  };

  if (asButton) {
    return (
      <button
        type="button"
        className={className}
        title={title ?? `Open ${artistName} wiki`}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          openWiki();
        }}
      >
        {children ?? artistName}
      </button>
    );
  }

  return (
    <span
      role="link"
      tabIndex={0}
      className={className}
      title={title ?? `Open ${artistName} wiki`}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        openWiki();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        openWiki();
      }}
    >
      {children ?? artistName}
    </span>
  );
}
