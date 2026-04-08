import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireAdminApiAuth } from "@/lib/admin-auth";
import { prisma } from "@/lib/db";
import { verifySameOrigin } from "@/lib/csrf";
import { parseRequestJson } from "@/lib/request-json";

const actionSchema = z.object({
  videoId: z.string().trim().regex(/^[A-Za-z0-9_-]{11}$/),
  action: z.enum(["keep", "delete"]),
});

type VideoColumnMap = {
  id: string;
  videoId: string;
  title: string;
  description: string | null;
  parsedArtist: string | null;
  parsedTrack: string | null;
  parsedVideoType: string | null;
  parseConfidence: string | null;
  parseMethod: string | null;
  parseReason: string | null;
  parsedAt: string | null;
  channelTitle: string | null;
  updatedAt: string | null;
};

function escapeIdentifier(identifier: string) {
  return `\`${identifier.replace(/`/g, "``")}\``;
}

function pickColumn(available: Set<string>, candidates: string[]) {
  for (const candidate of candidates) {
    if (available.has(candidate)) {
      return candidate;
    }
  }

  return null;
}

async function getVideoColumns(): Promise<VideoColumnMap> {
  const columns = await prisma.$queryRawUnsafe<Array<{ Field: string }>>("SHOW COLUMNS FROM videos");
  const available = new Set(columns.map((column) => column.Field));

  const id = pickColumn(available, ["id"]);
  const videoId = pickColumn(available, ["videoId", "video_id"]);
  const title = pickColumn(available, ["title"]);

  if (!id || !videoId || !title) {
    throw new Error("Videos table is missing required id/videoId/title columns");
  }

  return {
    id,
    videoId,
    title,
    description: pickColumn(available, ["description"]),
    parsedArtist: pickColumn(available, ["parsedArtist", "parsed_artist"]),
    parsedTrack: pickColumn(available, ["parsedTrack", "parsed_track"]),
    parsedVideoType: pickColumn(available, ["parsedVideoType", "parsed_video_type"]),
    parseConfidence: pickColumn(available, ["parseConfidence", "parse_confidence"]),
    parseMethod: pickColumn(available, ["parseMethod", "parse_method"]),
    parseReason: pickColumn(available, ["parseReason", "parse_reason"]),
    parsedAt: pickColumn(available, ["parsedAt", "parsed_at"]),
    channelTitle: pickColumn(available, ["channelTitle", "channel_title"]),
    updatedAt: pickColumn(available, ["updatedAt", "updated_at"]),
  };
}

const NON_MUSIC_REGEX = "instagram|tiktok|facebook|whatsapp|snapchat|podcast|interview|prank|challenge|reaction|vlog|tutorial|gameplay|livestream|stream highlights?|news|fails?|compilation|meme|shorts?";

export async function GET(request: NextRequest) {
  const auth = await requireAdminApiAuth(request);

  if (!auth.ok) {
    return auth.response;
  }

  const q = (request.nextUrl.searchParams.get("q") ?? "").trim();
  const limit = Math.max(1, Math.min(200, Number(request.nextUrl.searchParams.get("limit") ?? "50") || 50));
  const columns = await getVideoColumns();

  const selectSql = [
    `v.${escapeIdentifier(columns.id)} AS id`,
    `v.${escapeIdentifier(columns.videoId)} AS videoId`,
    `v.${escapeIdentifier(columns.title)} AS title`,
    columns.description ? `v.${escapeIdentifier(columns.description)} AS description` : "NULL AS description",
    columns.parsedArtist ? `v.${escapeIdentifier(columns.parsedArtist)} AS parsedArtist` : "NULL AS parsedArtist",
    columns.parsedTrack ? `v.${escapeIdentifier(columns.parsedTrack)} AS parsedTrack` : "NULL AS parsedTrack",
    columns.parsedVideoType ? `v.${escapeIdentifier(columns.parsedVideoType)} AS parsedVideoType` : "NULL AS parsedVideoType",
    columns.parseConfidence ? `v.${escapeIdentifier(columns.parseConfidence)} AS parseConfidence` : "NULL AS parseConfidence",
    columns.parseMethod ? `v.${escapeIdentifier(columns.parseMethod)} AS parseMethod` : "NULL AS parseMethod",
    columns.parseReason ? `v.${escapeIdentifier(columns.parseReason)} AS parseReason` : "NULL AS parseReason",
    columns.channelTitle ? `v.${escapeIdentifier(columns.channelTitle)} AS channelTitle` : "NULL AS channelTitle",
    columns.updatedAt ? `v.${escapeIdentifier(columns.updatedAt)} AS updatedAt` : "NULL AS updatedAt",
  ].join(",\n        ");

  const whereParts: string[] = [
    `EXISTS (SELECT 1 FROM site_videos sv WHERE sv.video_id = v.${escapeIdentifier(columns.id)} AND sv.status = 'available')`,
  ];
  const params: string[] = [];

  if (columns.parseMethod) {
    whereParts.push(`(v.${escapeIdentifier(columns.parseMethod)} IS NULL OR v.${escapeIdentifier(columns.parseMethod)} NOT LIKE 'admin-keep%')`);
  }

  const ambiguityChecks: string[] = [
    `LOWER(v.${escapeIdentifier(columns.title)}) REGEXP '${NON_MUSIC_REGEX}'`,
  ];

  if (columns.description) {
    ambiguityChecks.push(`LOWER(COALESCE(v.${escapeIdentifier(columns.description)}, '')) REGEXP '${NON_MUSIC_REGEX}'`);
  }

  if (columns.parsedArtist) {
    ambiguityChecks.push(`v.${escapeIdentifier(columns.parsedArtist)} IS NULL OR TRIM(v.${escapeIdentifier(columns.parsedArtist)}) = ''`);
  }

  if (columns.parsedTrack) {
    ambiguityChecks.push(`v.${escapeIdentifier(columns.parsedTrack)} IS NULL OR TRIM(v.${escapeIdentifier(columns.parsedTrack)}) = ''`);
  }

  if (columns.parsedVideoType) {
    ambiguityChecks.push(`v.${escapeIdentifier(columns.parsedVideoType)} IS NULL OR LOWER(v.${escapeIdentifier(columns.parsedVideoType)}) = 'unknown'`);
  }

  if (columns.parseConfidence) {
    ambiguityChecks.push(`v.${escapeIdentifier(columns.parseConfidence)} IS NULL OR v.${escapeIdentifier(columns.parseConfidence)} < 0.9`);
  }

  whereParts.push(`(${ambiguityChecks.join(" OR ")})`);

  if (q) {
    const needle = `%${q}%`;
    const qParts = [
      `v.${escapeIdentifier(columns.videoId)} LIKE ?`,
      `v.${escapeIdentifier(columns.title)} LIKE ?`,
    ];
    params.push(needle, needle);

    if (columns.parsedArtist) {
      qParts.push(`v.${escapeIdentifier(columns.parsedArtist)} LIKE ?`);
      params.push(needle);
    }

    if (columns.parsedTrack) {
      qParts.push(`v.${escapeIdentifier(columns.parsedTrack)} LIKE ?`);
      params.push(needle);
    }

    whereParts.push(`(${qParts.join(" OR ")})`);
  }

  const orderCol = columns.updatedAt ? columns.updatedAt : columns.id;
  const ambiguousVideos = await prisma.$queryRawUnsafe<Array<{
    id: number;
    videoId: string;
    title: string;
    description: string | null;
    parsedArtist: string | null;
    parsedTrack: string | null;
    parsedVideoType: string | null;
    parseConfidence: number | null;
    parseMethod: string | null;
    parseReason: string | null;
    channelTitle: string | null;
    updatedAt: Date | string | null;
  }>>(
    `
      SELECT
        ${selectSql}
      FROM videos v
      WHERE ${whereParts.join(" AND ")}
      ORDER BY v.${escapeIdentifier(orderCol)} DESC
      LIMIT ${limit}
    `,
    ...params,
  );

  return NextResponse.json({ ambiguousVideos });
}

export async function POST(request: NextRequest) {
  const auth = await requireAdminApiAuth(request);

  if (!auth.ok) {
    return auth.response;
  }

  const csrf = verifySameOrigin(request);
  if (csrf) {
    return csrf;
  }

  const body = await parseRequestJson(request);
  if (!body.ok) {
    return body.response;
  }

  const parsed = actionSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { videoId, action } = parsed.data;
  const columns = await getVideoColumns();

  if (action === "keep") {
    const assignments: string[] = [];
    const values: Array<string | number | Date | null> = [];

    if (columns.parseMethod) {
      assignments.push(`${escapeIdentifier(columns.parseMethod)} = ?`);
      values.push("admin-keep");
    }

    if (columns.parseReason) {
      assignments.push(`${escapeIdentifier(columns.parseReason)} = ?`);
      values.push("Reviewed and kept in admin ambiguous queue");
    }

    if (columns.parsedAt) {
      assignments.push(`${escapeIdentifier(columns.parsedAt)} = ?`);
      values.push(new Date());
    }

    if (columns.parseConfidence) {
      assignments.push(
        `${escapeIdentifier(columns.parseConfidence)} = CASE WHEN ${escapeIdentifier(columns.parseConfidence)} IS NULL OR ${escapeIdentifier(columns.parseConfidence)} < 0.95 THEN 0.95 ELSE ${escapeIdentifier(columns.parseConfidence)} END`,
      );
    }

    if (assignments.length === 0) {
      return NextResponse.json({ error: "No review columns available on videos table" }, { status: 400 });
    }

    const updated = await prisma.$executeRawUnsafe(
      `
        UPDATE videos
        SET ${assignments.join(", ")}
        WHERE ${escapeIdentifier(columns.videoId)} = ?
      `,
      ...values,
      videoId,
    );

    return NextResponse.json({ ok: true, action, videoId, affectedRows: Number(updated ?? 0) });
  }

  const result = await prisma.$transaction(async (tx) => {
    const deletedSiteVideos = await tx.$executeRawUnsafe(
      `
        DELETE sv FROM site_videos sv
        INNER JOIN videos v ON v.id = sv.video_id
        WHERE v.${escapeIdentifier(columns.videoId)} = ?
      `,
      videoId,
    );

    const deletedArtistLinks = await tx.$executeRawUnsafe(
      `
        DELETE av FROM videosbyartist av
        INNER JOIN videos v ON v.id = av.video_id
        WHERE v.${escapeIdentifier(columns.videoId)} = ?
      `,
      videoId,
    );

    const deletedPlaylistItems = await tx.$executeRawUnsafe(
      `
        DELETE pi FROM playlistitems pi
        INNER JOIN videos v ON v.id = pi.video_id
        WHERE v.${escapeIdentifier(columns.videoId)} = ?
      `,
      videoId,
    );

    const deletedFavourites = await tx.$executeRawUnsafe(
      "DELETE FROM favourites WHERE videoId = ?",
      videoId,
    );

    const deletedMessages = await tx.$executeRawUnsafe(
      "DELETE FROM messages WHERE video_id = ?",
      videoId,
    );

    const deletedRelated = await tx.$executeRawUnsafe(
      "DELETE FROM related WHERE videoId = ? OR related = ?",
      videoId,
      videoId,
    );

    const deletedVideos = await tx.$executeRawUnsafe(
      `DELETE FROM videos WHERE ${escapeIdentifier(columns.videoId)} = ?`,
      videoId,
    );

    return {
      deletedSiteVideos: Number(deletedSiteVideos ?? 0),
      deletedArtistLinks: Number(deletedArtistLinks ?? 0),
      deletedPlaylistItems: Number(deletedPlaylistItems ?? 0),
      deletedFavourites: Number(deletedFavourites ?? 0),
      deletedMessages: Number(deletedMessages ?? 0),
      deletedRelated: Number(deletedRelated ?? 0),
      deletedVideos: Number(deletedVideos ?? 0),
    };
  });

  return NextResponse.json({ ok: true, action, videoId, ...result });
}