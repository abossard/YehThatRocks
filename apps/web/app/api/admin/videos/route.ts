import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireAdminApiAuth } from "@/lib/admin-auth";
import { prisma } from "@/lib/db";
import { verifySameOrigin } from "@/lib/csrf";
import { parseRequestJson } from "@/lib/request-json";

const updateSchema = z.object({
  id: z.number().int().positive(),
  title: z.string().trim().min(1).max(255).optional(),
  parsedArtist: z.string().trim().max(255).nullable().optional(),
  parsedTrack: z.string().trim().max(255).nullable().optional(),
  parsedVideoType: z.string().trim().max(50).nullable().optional(),
  parseConfidence: z.number().min(0).max(1).nullable().optional(),
  channelTitle: z.string().trim().max(255).nullable().optional(),
  description: z.string().trim().nullable().optional(),
});

type VideoColumnMap = {
  id: string;
  videoId: string;
  title: string;
  parsedArtist: string | null;
  parsedTrack: string | null;
  parsedVideoType: string | null;
  parseConfidence: string | null;
  parseMethod: string | null;
  parsedAt: string | null;
  channelTitle: string | null;
  description: string | null;
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
    parsedArtist: pickColumn(available, ["parsedArtist", "parsed_artist"]),
    parsedTrack: pickColumn(available, ["parsedTrack", "parsed_track"]),
    parsedVideoType: pickColumn(available, ["parsedVideoType", "parsed_video_type"]),
    parseConfidence: pickColumn(available, ["parseConfidence", "parse_confidence"]),
    parseMethod: pickColumn(available, ["parseMethod", "parse_method"]),
    parsedAt: pickColumn(available, ["parsedAt", "parsed_at"]),
    channelTitle: pickColumn(available, ["channelTitle", "channel_title"]),
    description: pickColumn(available, ["description"]),
    updatedAt: pickColumn(available, ["updatedAt", "updated_at"]),
  };
}

export async function GET(request: NextRequest) {
  const auth = await requireAdminApiAuth(request);

  if (!auth.ok) {
    return auth.response;
  }

  const q = (request.nextUrl.searchParams.get("q") ?? "").trim();
  const columns = await getVideoColumns();

  const selectSql = [
    `v.${escapeIdentifier(columns.id)} AS id`,
    `v.${escapeIdentifier(columns.videoId)} AS videoId`,
    `v.${escapeIdentifier(columns.title)} AS title`,
    columns.parsedArtist ? `v.${escapeIdentifier(columns.parsedArtist)} AS parsedArtist` : "NULL AS parsedArtist",
    columns.parsedTrack ? `v.${escapeIdentifier(columns.parsedTrack)} AS parsedTrack` : "NULL AS parsedTrack",
    columns.parsedVideoType ? `v.${escapeIdentifier(columns.parsedVideoType)} AS parsedVideoType` : "NULL AS parsedVideoType",
    columns.parseConfidence ? `v.${escapeIdentifier(columns.parseConfidence)} AS parseConfidence` : "NULL AS parseConfidence",
    columns.channelTitle ? `v.${escapeIdentifier(columns.channelTitle)} AS channelTitle` : "NULL AS channelTitle",
    columns.updatedAt ? `v.${escapeIdentifier(columns.updatedAt)} AS updatedAt` : "NULL AS updatedAt",
  ].join(",\n        ");

  const whereParts: string[] = [];
  const params: string[] = [];

  if (q) {
    const needle = `%${q}%`;
    whereParts.push(`v.${escapeIdentifier(columns.videoId)} LIKE ?`);
    params.push(needle);
    whereParts.push(`v.${escapeIdentifier(columns.title)} LIKE ?`);
    params.push(needle);

    if (columns.parsedArtist) {
      whereParts.push(`v.${escapeIdentifier(columns.parsedArtist)} LIKE ?`);
      params.push(needle);
    }

    if (columns.parsedTrack) {
      whereParts.push(`v.${escapeIdentifier(columns.parsedTrack)} LIKE ?`);
      params.push(needle);
    }
  }

  const whereSql = whereParts.length > 0 ? `WHERE ${whereParts.join(" OR ")}` : "";
  const orderCol = columns.updatedAt ? columns.updatedAt : columns.id;

  const videos = await prisma.$queryRawUnsafe<Array<{
    id: number;
    videoId: string;
    title: string;
    parsedArtist: string | null;
    parsedTrack: string | null;
    parsedVideoType: string | null;
    parseConfidence: number | null;
    channelTitle: string | null;
    updatedAt: Date | string | null;
  }>>(
    `
      SELECT
        ${selectSql}
      FROM videos v
      ${whereSql}
      ORDER BY v.${escapeIdentifier(orderCol)} DESC
      LIMIT 100
    `,
    ...params,
  );

  return NextResponse.json({ videos });
}

export async function PATCH(request: NextRequest) {
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

  const parsed = updateSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const columns = await getVideoColumns();
  const assignments: string[] = [];
  const params: Array<string | number | null | Date> = [];

  if (parsed.data.title !== undefined) {
    assignments.push(`${escapeIdentifier(columns.title)} = ?`);
    params.push(parsed.data.title);
  }

  if (columns.parsedArtist && parsed.data.parsedArtist !== undefined) {
    assignments.push(`${escapeIdentifier(columns.parsedArtist)} = ?`);
    params.push(parsed.data.parsedArtist || null);
  }

  if (columns.parsedTrack && parsed.data.parsedTrack !== undefined) {
    assignments.push(`${escapeIdentifier(columns.parsedTrack)} = ?`);
    params.push(parsed.data.parsedTrack || null);
  }

  if (columns.parsedVideoType && parsed.data.parsedVideoType !== undefined) {
    assignments.push(`${escapeIdentifier(columns.parsedVideoType)} = ?`);
    params.push(parsed.data.parsedVideoType || null);
  }

  if (columns.parseConfidence && parsed.data.parseConfidence !== undefined) {
    assignments.push(`${escapeIdentifier(columns.parseConfidence)} = ?`);
    params.push(parsed.data.parseConfidence);
  }

  if (columns.channelTitle && parsed.data.channelTitle !== undefined) {
    assignments.push(`${escapeIdentifier(columns.channelTitle)} = ?`);
    params.push(parsed.data.channelTitle || null);
  }

  if (columns.description && parsed.data.description !== undefined) {
    assignments.push(`${escapeIdentifier(columns.description)} = ?`);
    params.push(parsed.data.description || null);
  }

  if (columns.parsedAt) {
    assignments.push(`${escapeIdentifier(columns.parsedAt)} = ?`);
    params.push(new Date());
  }

  if (columns.parseMethod) {
    assignments.push(`${escapeIdentifier(columns.parseMethod)} = ?`);
    params.push("admin-manual");
  }

  if (assignments.length === 0) {
    return NextResponse.json({ error: "No editable fields provided" }, { status: 400 });
  }

  await prisma.$executeRawUnsafe(
    `
      UPDATE videos
      SET ${assignments.join(", ")}
      WHERE ${escapeIdentifier(columns.id)} = ?
    `,
    ...params,
    parsed.data.id,
  );

  const [updated] = await prisma.$queryRawUnsafe<Array<{
    id: number;
    videoId: string;
    title: string;
    parsedArtist: string | null;
    parsedTrack: string | null;
    parsedVideoType: string | null;
    parseConfidence: number | null;
    channelTitle: string | null;
    updatedAt: Date | string | null;
  }>>(
    `
      SELECT
        v.${escapeIdentifier(columns.id)} AS id,
        v.${escapeIdentifier(columns.videoId)} AS videoId,
        v.${escapeIdentifier(columns.title)} AS title,
        ${columns.parsedArtist ? `v.${escapeIdentifier(columns.parsedArtist)}` : "NULL"} AS parsedArtist,
        ${columns.parsedTrack ? `v.${escapeIdentifier(columns.parsedTrack)}` : "NULL"} AS parsedTrack,
        ${columns.parsedVideoType ? `v.${escapeIdentifier(columns.parsedVideoType)}` : "NULL"} AS parsedVideoType,
        ${columns.parseConfidence ? `v.${escapeIdentifier(columns.parseConfidence)}` : "NULL"} AS parseConfidence,
        ${columns.channelTitle ? `v.${escapeIdentifier(columns.channelTitle)}` : "NULL"} AS channelTitle,
        ${columns.updatedAt ? `v.${escapeIdentifier(columns.updatedAt)}` : "NULL"} AS updatedAt
      FROM videos v
      WHERE v.${escapeIdentifier(columns.id)} = ?
      LIMIT 1
    `,
    parsed.data.id,
  );

  if (!updated) {
    return NextResponse.json({ error: "Video not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, video: updated });
}
