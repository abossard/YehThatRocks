import { NextRequest, NextResponse } from "next/server";

import {
  SHARE_DEFAULT_DESCRIPTION,
  SHARE_DEFAULT_TITLE,
  SHARE_SITE_NAME,
  resolveShareMetadataForOrigin,
} from "@/lib/share-metadata";

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ videoId: string }> },
) {
  const { videoId: rawVideoId } = await params;
  const forwardedHost = request.headers.get("x-forwarded-host");
  const requestHost = request.headers.get("host") || request.nextUrl.host;
  const host = (forwardedHost || requestHost || request.nextUrl.host).split(",")[0]?.trim();
  const proto = request.headers.get("x-forwarded-proto") || request.nextUrl.protocol.replace(":", "") || "https";
  const siteOrigin = `${proto}://${host}`;
  const fallbackRedirectUrl = `${siteOrigin}/`;
  const titleHint = request.nextUrl.searchParams.get("st")?.trim();
  const shareMetadata = await resolveShareMetadataForOrigin(rawVideoId, titleHint, siteOrigin);

  if (!shareMetadata) {
    const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(SHARE_DEFAULT_TITLE)}</title>
  <meta name="description" content="${escapeHtml(SHARE_DEFAULT_DESCRIPTION)}" />
</head>
<body>
  <p>Opening video...</p>
  <p><a href="${escapeHtml(fallbackRedirectUrl)}">Continue</a></p>
  <script>
    window.location.replace(${JSON.stringify(fallbackRedirectUrl)});
  </script>
</body>
</html>`;

    return new NextResponse(html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "public, max-age=300",
      },
    });
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

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />

  <title>${escapeHtml(shareTitle)}</title>
  <meta name="description" content="${escapeHtml(shareDescription)}" />
  <link rel="canonical" href="${escapeHtml(shareUrl)}" />

  <meta property="og:title" content="${escapeHtml(shareTitle)}" />
  <meta property="og:description" content="${escapeHtml(shareDescription)}" />
  <meta property="og:url" content="${escapeHtml(shareUrl)}" />
  <meta property="og:site_name" content="${escapeHtml(SHARE_SITE_NAME)}" />
  <meta property="og:type" content="website" />

  <meta property="og:image" content="${escapeHtml(primaryImageUrl)}" />
  <meta property="og:image:url" content="${escapeHtml(primaryImageUrl)}" />
  <meta property="og:image:secure_url" content="${escapeHtml(primaryImageUrl)}" />
  <meta property="og:image:type" content="image/jpeg" />
  <meta property="og:image:width" content="480" />
  <meta property="og:image:height" content="360" />
  <meta property="og:image:alt" content="${escapeHtml(safeVideoTitle)}" />

  <meta property="og:image" content="${escapeHtml(secondaryImageUrl)}" />
  <meta property="og:image:url" content="${escapeHtml(secondaryImageUrl)}" />
  <meta property="og:image:secure_url" content="${escapeHtml(secondaryImageUrl)}" />
  <meta property="og:image:type" content="image/jpeg" />
  <meta property="og:image:width" content="1280" />
  <meta property="og:image:height" content="720" />
  <meta property="og:image:alt" content="${escapeHtml(safeVideoTitle)}" />

  <meta property="og:video:url" content="${escapeHtml(playUrl)}" />
  <meta property="og:video:secure_url" content="${escapeHtml(playUrl)}" />
  <meta property="og:video:type" content="text/html" />
  <meta property="og:video:width" content="1280" />
  <meta property="og:video:height" content="720" />

  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${escapeHtml(shareTitle)}" />
  <meta name="twitter:description" content="${escapeHtml(shareDescription)}" />
  <meta name="twitter:url" content="${escapeHtml(shareUrl)}" />
  <meta name="twitter:image" content="${escapeHtml(primaryImageUrl)}" />
</head>
<body>
  <p>Opening video...</p>
  <p><a href="${escapeHtml(playUrl)}">Continue to video</a></p>
  <script>
    setTimeout(function() {
      window.location.replace(${JSON.stringify(playUrl)});
    }, 120);
  </script>
</body>
</html>`;

  return new NextResponse(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=300",
    },
  });
}
