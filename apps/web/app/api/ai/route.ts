import { NextResponse } from "next/server";

import { getAiTracks } from "@/lib/catalog-data";

export async function GET() {
  const tracks = await getAiTracks();
  return NextResponse.json({ tracks });
}
