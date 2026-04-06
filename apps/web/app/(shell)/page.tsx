import type { Metadata } from "next";
import { headers } from "next/headers";

import { getCurrentVideo } from "@/lib/catalog-data";

const SITE_NAME = "YehThatRocks";
const DEFAULT_TITLE = "YehThatRocks | The World's LOUDEST Website";
const DEFAULT_DESCRIPTION =
  "Community-driven rock and metal streaming, discovery, chat, and catalogue depth rebuilt for the modern web.";

type HomePageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ searchParams }: HomePageProps): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") || requestHeaders.get("host") || "yehthatrocks.com";
  const proto = requestHeaders.get("x-forwarded-proto") || "https";
  const siteOrigin = `${proto}://${host}`;
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const rawVideoId = typeof resolvedSearchParams?.v === "string" ? resolvedSearchParams.v : undefined;
  const selectedVideo = rawVideoId ? await getCurrentVideo(rawVideoId) : null;

  if (!selectedVideo?.id) {
    return {
      title: DEFAULT_TITLE,
      description: DEFAULT_DESCRIPTION,
    };
  }

  const shareUrl = `${siteOrigin}/?v=${encodeURIComponent(selectedVideo.id)}`;
  const shareTitle = `${selectedVideo.title} | ${SITE_NAME}`;
  const shareDescription = `Watch ${selectedVideo.title} on ${SITE_NAME}.`;
  const shareImage = `https://i.ytimg.com/vi/${encodeURIComponent(selectedVideo.id)}/hqdefault.jpg`;

  return {
    title: shareTitle,
    description: shareDescription,
    alternates: {
      canonical: shareUrl,
    },
    openGraph: {
      title: shareTitle,
      description: shareDescription,
      url: shareUrl,
      siteName: SITE_NAME,
      type: "video.other",
      images: [
        {
          url: shareImage,
          width: 480,
          height: 360,
          alt: selectedVideo.title,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: shareTitle,
      description: shareDescription,
      images: [shareImage],
    },
  };
}

export default function Home() {
  // The shell layout owns the player; the home route shows only the player (no overlay).
  return null;
}

