import { NextRequest, NextResponse } from "next/server";

import { searchCatalog } from "@/lib/catalog-data";

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q") ?? "";
  const results = await searchCatalog(query);

  return NextResponse.json({
    query,
    ...results
  });
}
