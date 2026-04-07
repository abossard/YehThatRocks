import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireAdminApiAuth } from "@/lib/admin-auth";
import { prisma } from "@/lib/db";
import { verifySameOrigin } from "@/lib/csrf";
import { parseRequestJson } from "@/lib/request-json";

const updateSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().trim().min(1).max(255).optional(),
  country: z.string().trim().max(255).nullable().optional(),
  genre1: z.string().trim().max(255).nullable().optional(),
  genre2: z.string().trim().max(255).nullable().optional(),
  genre3: z.string().trim().max(255).nullable().optional(),
  genre4: z.string().trim().max(255).nullable().optional(),
  genre5: z.string().trim().max(255).nullable().optional(),
  genre6: z.string().trim().max(255).nullable().optional(),
});

type ArtistColumnMap = {
  id: string;
  name: string;
  country: string | null;
  genre1: string | null;
  genre2: string | null;
  genre3: string | null;
  genre4: string | null;
  genre5: string | null;
  genre6: string | null;
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

async function getArtistColumns(): Promise<ArtistColumnMap> {
  const columns = await prisma.$queryRawUnsafe<Array<{ Field: string }>>("SHOW COLUMNS FROM artists");
  const available = new Set(columns.map((column) => column.Field));

  const id = pickColumn(available, ["id", "artist_id", "artistId"]);
  const name = pickColumn(available, ["artist", "name"]);

  if (!id || !name) {
    throw new Error("Artists table is missing required id/name columns");
  }

  return {
    id,
    name,
    country: pickColumn(available, ["country"]),
    genre1: pickColumn(available, ["genre1"]),
    genre2: pickColumn(available, ["genre2"]),
    genre3: pickColumn(available, ["genre3"]),
    genre4: pickColumn(available, ["genre4"]),
    genre5: pickColumn(available, ["genre5"]),
    genre6: pickColumn(available, ["genre6"]),
  };
}

export async function GET(request: NextRequest) {
  const auth = await requireAdminApiAuth(request);

  if (!auth.ok) {
    return auth.response;
  }

  const q = (request.nextUrl.searchParams.get("q") ?? "").trim();
  const columns = await getArtistColumns();

  const selectSql = [
    `a.${escapeIdentifier(columns.id)} AS id`,
    `a.${escapeIdentifier(columns.name)} AS name`,
    columns.country ? `a.${escapeIdentifier(columns.country)} AS country` : "NULL AS country",
    columns.genre1 ? `a.${escapeIdentifier(columns.genre1)} AS genre1` : "NULL AS genre1",
    columns.genre2 ? `a.${escapeIdentifier(columns.genre2)} AS genre2` : "NULL AS genre2",
    columns.genre3 ? `a.${escapeIdentifier(columns.genre3)} AS genre3` : "NULL AS genre3",
    columns.genre4 ? `a.${escapeIdentifier(columns.genre4)} AS genre4` : "NULL AS genre4",
    columns.genre5 ? `a.${escapeIdentifier(columns.genre5)} AS genre5` : "NULL AS genre5",
    columns.genre6 ? `a.${escapeIdentifier(columns.genre6)} AS genre6` : "NULL AS genre6",
  ].join(",\n        ");

  const whereParts: string[] = [];
  const params: string[] = [];

  if (q) {
    const needle = `%${q}%`;
    whereParts.push(`a.${escapeIdentifier(columns.name)} LIKE ?`);
    params.push(needle);

    if (columns.country) {
      whereParts.push(`a.${escapeIdentifier(columns.country)} LIKE ?`);
      params.push(needle);
    }

    if (columns.genre1) {
      whereParts.push(`a.${escapeIdentifier(columns.genre1)} LIKE ?`);
      params.push(needle);
    }
  }

  const whereSql = whereParts.length > 0 ? `WHERE ${whereParts.join(" OR ")}` : "";

  const artists = await prisma.$queryRawUnsafe<Array<{
    id: number;
    name: string;
    country: string | null;
    genre1: string | null;
    genre2: string | null;
    genre3: string | null;
    genre4: string | null;
    genre5: string | null;
    genre6: string | null;
  }>>(
    `
      SELECT
        ${selectSql}
      FROM artists a
      ${whereSql}
      ORDER BY a.${escapeIdentifier(columns.name)} ASC
      LIMIT 100
    `,
    ...params,
  );

  return NextResponse.json({ artists });
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

  const columns = await getArtistColumns();
  const assignments: string[] = [];
  const params: Array<string | number | null> = [];

  if (parsed.data.name !== undefined) {
    assignments.push(`${escapeIdentifier(columns.name)} = ?`);
    params.push(parsed.data.name);
  }

  if (columns.country && parsed.data.country !== undefined) {
    assignments.push(`${escapeIdentifier(columns.country)} = ?`);
    params.push(parsed.data.country || null);
  }

  if (columns.genre1 && parsed.data.genre1 !== undefined) {
    assignments.push(`${escapeIdentifier(columns.genre1)} = ?`);
    params.push(parsed.data.genre1 || null);
  }

  if (columns.genre2 && parsed.data.genre2 !== undefined) {
    assignments.push(`${escapeIdentifier(columns.genre2)} = ?`);
    params.push(parsed.data.genre2 || null);
  }

  if (columns.genre3 && parsed.data.genre3 !== undefined) {
    assignments.push(`${escapeIdentifier(columns.genre3)} = ?`);
    params.push(parsed.data.genre3 || null);
  }

  if (columns.genre4 && parsed.data.genre4 !== undefined) {
    assignments.push(`${escapeIdentifier(columns.genre4)} = ?`);
    params.push(parsed.data.genre4 || null);
  }

  if (columns.genre5 && parsed.data.genre5 !== undefined) {
    assignments.push(`${escapeIdentifier(columns.genre5)} = ?`);
    params.push(parsed.data.genre5 || null);
  }

  if (columns.genre6 && parsed.data.genre6 !== undefined) {
    assignments.push(`${escapeIdentifier(columns.genre6)} = ?`);
    params.push(parsed.data.genre6 || null);
  }

  if (assignments.length === 0) {
    return NextResponse.json({ error: "No editable fields provided" }, { status: 400 });
  }

  await prisma.$executeRawUnsafe(
    `
      UPDATE artists
      SET ${assignments.join(", ")}
      WHERE ${escapeIdentifier(columns.id)} = ?
    `,
    ...params,
    parsed.data.id,
  );

  const [updated] = await prisma.$queryRawUnsafe<Array<{
    id: number;
    name: string;
    country: string | null;
    genre1: string | null;
    genre2: string | null;
    genre3: string | null;
    genre4: string | null;
    genre5: string | null;
    genre6: string | null;
  }>>(
    `
      SELECT
        a.${escapeIdentifier(columns.id)} AS id,
        a.${escapeIdentifier(columns.name)} AS name,
        ${columns.country ? `a.${escapeIdentifier(columns.country)}` : "NULL"} AS country,
        ${columns.genre1 ? `a.${escapeIdentifier(columns.genre1)}` : "NULL"} AS genre1,
        ${columns.genre2 ? `a.${escapeIdentifier(columns.genre2)}` : "NULL"} AS genre2,
        ${columns.genre3 ? `a.${escapeIdentifier(columns.genre3)}` : "NULL"} AS genre3,
        ${columns.genre4 ? `a.${escapeIdentifier(columns.genre4)}` : "NULL"} AS genre4,
        ${columns.genre5 ? `a.${escapeIdentifier(columns.genre5)}` : "NULL"} AS genre5,
        ${columns.genre6 ? `a.${escapeIdentifier(columns.genre6)}` : "NULL"} AS genre6
      FROM artists a
      WHERE a.${escapeIdentifier(columns.id)} = ?
      LIMIT 1
    `,
    parsed.data.id,
  );

  if (!updated) {
    return NextResponse.json({ error: "Artist not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, artist: updated });
}
