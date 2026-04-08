import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireAdminApiAuth } from "@/lib/admin-auth";
import { importVideoFromDirectSource } from "@/lib/catalog-data";
import { verifySameOrigin } from "@/lib/csrf";
import { parseRequestJson } from "@/lib/request-json";

const importSchema = z.object({
  source: z.string().trim().min(1).max(2048),
});

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

  const parsed = importSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const result = await importVideoFromDirectSource(parsed.data.source);

  if (!result.videoId) {
    return NextResponse.json(
      { error: "Invalid YouTube URL or video id." },
      { status: 400 },
    );
  }

  return NextResponse.json({
    ok: result.decision.allowed,
    videoId: result.videoId,
    decision: result.decision,
  });
}
