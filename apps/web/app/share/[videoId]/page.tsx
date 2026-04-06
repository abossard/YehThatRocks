import Link from "next/link";
import type { Metadata } from "next";
import { headers } from "next/headers";

import { normalizeYouTubeVideoId } from "@/lib/catalog-data";
import {
  SHARE_DEFAULT_DESCRIPTION,
  SHARE_DEFAULT_TITLE,
  SHARE_SITE_NAME,
  resolveShareMetadataForOrigin,
} from "@/lib/share-metadata";
import { ShareRedirect } from "./share-redirect";

type SharePageProps = {
  params: Promise<{ videoId: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params, searchParams }: SharePageProps): Promise<Metadata> {
  const { videoId } = await params;
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") || requestHeaders.get("host") || "yehthatrocks.com";
  const proto = requestHeaders.get("x-forwarded-proto") || "https";
  const siteOrigin = `${proto}://${host}`;
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const titleHint = typeof resolvedSearchParams?.st === "string" ? resolvedSearchParams.st.trim() : undefined;
  const normalizedVideoId = normalizeYouTubeVideoId(videoId);

  if (!normalizedVideoId) {
    return {
      title: SHARE_DEFAULT_TITLE,
      description: SHARE_DEFAULT_DESCRIPTION,
      robots: {
        index: false,
        follow: true,
      },
    };
  }

  const shareMetadata = await resolveShareMetadataForOrigin(normalizedVideoId, titleHint, siteOrigin);

  if (!shareMetadata) {
    return {
      title: SHARE_DEFAULT_TITLE,
      description: SHARE_DEFAULT_DESCRIPTION,
      robots: {
        index: false,
        follow: true,
      },
    };
  }

  const {
    safeVideoTitle,
    shareTitle,
    shareDescription,
    shareUrl,
    playUrl,
    primaryImageUrl,
    secondaryImageUrl,
  } = shareMetadata;

  return {
    title: shareTitle,
    description: shareDescription,
    alternates: {
      canonical: shareUrl,
    },
    robots: {
      index: false,
      follow: true,
    },
    openGraph: {
      title: shareTitle,
      description: shareDescription,
      url: shareUrl,
      siteName: SHARE_SITE_NAME,
      type: "website",
      images: [
        {
          url: primaryImageUrl,
          width: 480,
          height: 360,
          alt: safeVideoTitle,
        },
        {
          url: secondaryImageUrl,
          width: 1280,
          height: 720,
          alt: safeVideoTitle,
        },
      ],
      videos: [
        {
          url: playUrl,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: shareTitle,
      description: shareDescription,
      images: [primaryImageUrl, secondaryImageUrl],
    },
  };
}

export default async function ShareVideoPage({ params }: SharePageProps) {
  const { videoId } = await params;
  const normalizedVideoId = normalizeYouTubeVideoId(videoId);
  const targetHref = normalizedVideoId ? `/?v=${encodeURIComponent(normalizedVideoId)}&resume=1` : "/";

  return (
    <main className="serviceFailureScreen" role="main" aria-label="Opening shared video">
      <ShareRedirect targetHref={targetHref} />
      <div className="serviceFailureBackdrop" aria-hidden="true" />
      <section className="serviceFailurePanel" role="status" aria-live="polite" aria-label="Opening shared video">
        <p className="serviceFailureEyebrow">Share link</p>
        <h1 className="serviceFailureTitle">Opening video...</h1>
        <p className="serviceFailureLead">If you are not redirected, use the button below.</p>
        <div className="serviceFailureActions">
          <Link href={targetHref} className="linkedCard">Open video</Link>
        </div>
      </section>
    </main>
  );
}
