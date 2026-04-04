import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { pruneVideoAndAssociationsByVideoId } from "@/lib/catalog-data";
import { verifySameOrigin } from "@/lib/csrf";
import { parseRequestJson } from "@/lib/request-json";

type MarkUnavailableBody = {
  videoId?: string;
  reason?: string;
};

type AvailabilityCheckResult = {
  status: "available" | "unavailable" | "check-failed";
  reason: string;
};

const AGE_RESTRICTED_PATTERNS = [
  /Sign in to confirm your age/i,
  /age[-\s]?restricted/i,
  /playerAgeGateRenderer/i,
  /desktopLegacyAgeGateReason/i,
  /"isFamilySafe"\s*:\s*false/i,
  /"status"\s*:\s*"AGE_CHECK_REQUIRED"/i,
  /"status"\s*:\s*"LOGIN_REQUIRED"[\s\S]{0,240}"reason"\s*:\s*"[^"]*age/i,
];
const UNAVAILABLE_DEBUG_ENABLED = process.env.NODE_ENV === "development" && process.env.DEBUG_UNAVAILABLE === "1";

function debugUnavailable(event: string, detail?: Record<string, unknown>) {
  if (!UNAVAILABLE_DEBUG_ENABLED) {
    return;
  }

  const payload = detail ? ` ${JSON.stringify(detail)}` : "";
  console.log(`[api/videos/unavailable] ${event}${payload}`);
}

function truncate(value: string, maxLength: number) {
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

function containsAgeRestrictionMarker(html: string) {
  return AGE_RESTRICTED_PATTERNS.some((pattern) => pattern.test(html));
}

async function verifyYouTubeAvailability(videoId: string): Promise<AvailabilityCheckResult> {
  const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}&format=json`;

  try {
    const oembedResponse = await fetch(oembedUrl, {
      headers: {
        "User-Agent": "YehThatRocks/1.0",
      },
    });

    if ([401, 403, 404, 410].includes(oembedResponse.status)) {
      return { status: "unavailable", reason: `oembed:${oembedResponse.status}` };
    }

    if (oembedResponse.ok) {
      const embedUrl = `https://www.youtube.com/embed/${encodeURIComponent(videoId)}?enablejsapi=1`;
      const embedResponse = await fetch(embedUrl, {
        headers: {
          "User-Agent": "YehThatRocks/1.0",
        },
      });

      if ([401, 403, 404, 410].includes(embedResponse.status)) {
        return { status: "unavailable", reason: `embed:${embedResponse.status}` };
      }

      if (embedResponse.ok) {
        const html = await embedResponse.text();

        if (containsAgeRestrictionMarker(html)) {
          return { status: "unavailable", reason: "embed:age-restricted" };
        }

        if (
          /"playabilityStatus"\s*:\s*\{\s*"status"\s*:\s*"(ERROR|UNPLAYABLE|LOGIN_REQUIRED|CONTENT_CHECK_REQUIRED|AGE_CHECK_REQUIRED)"/i.test(
            html,
          )
        ) {
          return { status: "unavailable", reason: "embed:playability-unavailable" };
        }

        if (/video unavailable/i.test(html)) {
          return { status: "unavailable", reason: "embed:video-unavailable" };
        }

        return { status: "available", reason: "embed:accessible-no-markers" };
      }
    }

    return { status: "check-failed", reason: `oembed:${oembedResponse.status}` };
  } catch (error) {
    return {
      status: "check-failed",
      reason: `verify-network:${error instanceof Error ? error.message : "unknown"}`,
    };
  }
}

export async function POST(request: NextRequest) {
  const csrfError = verifySameOrigin(request);

  if (csrfError) {
    return csrfError;
  }

  const parsed = await parseRequestJson<MarkUnavailableBody>(request);

  if (!parsed.ok) {
    return parsed.response;
  }

  const videoId = parsed.data.videoId?.trim();

  if (!videoId) {
    return NextResponse.json({ error: "videoId is required" }, { status: 400 });
  }

  const reason = parsed.data.reason?.trim() ?? "runtime-player-error";

  debugUnavailable("incoming-report", {
    videoId,
    reason,
  });

  const videos = await prisma.video.findMany({
    where: { videoId },
    select: { id: true, title: true },
  });

  if (videos.length === 0) {
    debugUnavailable("unknown-video-id", { videoId });
    return NextResponse.json({ ok: true, skipped: true, reason: "unknown-video-id" }, { status: 202 });
  }

  const verification = await verifyYouTubeAvailability(videoId);
  debugUnavailable("verification-result", {
    videoId,
    verificationStatus: verification.status,
    verificationReason: verification.reason,
    matchedVideoRows: videos.length,
  });
  const ids = videos.map((v) => v.id);
  const videoTitle = videos[0]?.title ?? "Unknown";

  if (verification.status !== "unavailable") {
    await prisma.siteVideo.updateMany({
      where: { videoId: { in: ids } },
      data: {
        status: "available",
        title: truncate(`${videoTitle} [runtime-report-ignored:${reason}|${verification.reason}]`, 255),
      },
    });

    const existing = await prisma.siteVideo.findMany({
      where: { videoId: { in: ids } },
      select: { videoId: true },
    });
    const existingIds = new Set(existing.map((row) => row.videoId));
    const missingIds = ids.filter((id) => !existingIds.has(id));

    if (missingIds.length > 0) {
      const titleById = new Map(videos.map((video) => [video.id, video.title]));

      await prisma.siteVideo.createMany({
        data: missingIds.map((id) => ({
          videoId: id,
          title: truncate(
            `${titleById.get(id) ?? "Unknown"} [runtime-report-ignored:${reason}|${verification.reason}]`,
            255,
          ),
          status: "available",
        })),
        skipDuplicates: true,
      });
    }

    return NextResponse.json({ ok: true, skipped: true, reason: verification.reason }, { status: 202 });
  }

  debugUnavailable("marking-unavailable", {
    videoId,
    reason,
    verificationReason: verification.reason,
    targetRows: ids.length,
  });

  const pruneResult = await pruneVideoAndAssociationsByVideoId(
    videoId,
    `runtime-unavailable:${reason}|${verification.reason}`,
  ).catch(() => ({ pruned: false, deletedVideoRows: 0, reason: "prune-failed" }));

  return NextResponse.json({ ok: true, pruned: pruneResult.pruned, deletedVideoRows: pruneResult.deletedVideoRows });
}
