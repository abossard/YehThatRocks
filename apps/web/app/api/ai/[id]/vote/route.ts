import { NextRequest, NextResponse } from "next/server";

import { aiVoteSchema } from "@/lib/api-schemas";
import { submitAiVote } from "@/lib/catalog-data";
import { parseRequestJson } from "@/lib/request-json";

type AiVoteRouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: NextRequest, context: AiVoteRouteContext) {
  const { id } = await context.params;
  const bodyResult = await parseRequestJson(request);

  if (!bodyResult.ok) {
    return bodyResult.response;
  }

  const parsed = aiVoteSchema.safeParse(bodyResult.data);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const track = await submitAiVote(id, parsed.data.vote);

  if (!track) {
    return NextResponse.json({ error: "AI track not found" }, { status: 404 });
  }

  return NextResponse.json(track);
}
