import { NextRequest, NextResponse } from "next/server";

import { favouriteMutationSchema } from "@/lib/api-schemas";
import { requireApiAuth } from "@/lib/auth-request";
import { getFavouriteVideos, updateFavourite } from "@/lib/catalog-data";
import { verifySameOrigin } from "@/lib/csrf";
import { parseRequestJson } from "@/lib/request-json";

export async function GET(request: NextRequest) {
  const authResult = await requireApiAuth(request);

  if (!authResult.ok) {
    return authResult.response;
  }

  const favourites = await getFavouriteVideos(authResult.auth.userId);
  return NextResponse.json({ favourites });
}

export async function POST(request: NextRequest) {
  const authResult = await requireApiAuth(request);

  if (!authResult.ok) {
    return authResult.response;
  }

  const csrfError = verifySameOrigin(request);

  if (csrfError) {
    return csrfError;
  }

  const bodyResult = await parseRequestJson(request);

  if (!bodyResult.ok) {
    return bodyResult.response;
  }

  const parsed = favouriteMutationSchema.safeParse(bodyResult.data);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const result = await updateFavourite(parsed.data.videoId, parsed.data.action, authResult.auth.userId);
  return NextResponse.json(result);
}
