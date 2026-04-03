import { NextResponse } from "next/server";

import { getDataSourceStatus } from "@/lib/catalog-data";

export async function GET() {
  const status = await getDataSourceStatus();
  return NextResponse.json(status);
}
