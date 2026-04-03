import { NextRequest, NextResponse } from "next/server";

import { getAiTrackById } from "@/lib/catalog-data";

type AiTrackRouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: NextRequest, context: AiTrackRouteContext) {
  const { id } = await context.params;
  const track = await getAiTrackById(id);

  if (!track) {
    return NextResponse.json({ error: "AI track not found" }, { status: 404 });
  }

  return NextResponse.json(track);
}
