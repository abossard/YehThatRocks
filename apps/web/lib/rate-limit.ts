import { NextRequest, NextResponse } from "next/server";

type RateEntry = {
  count: number;
  resetAt: number;
};

const bucket = new Map<string, RateEntry>();

function getClientIp(request: NextRequest) {
  const forwarded = request.headers.get("x-forwarded-for");

  if (forwarded) {
    return forwarded.split(",")[0]?.trim() ?? "unknown";
  }

  return "unknown";
}

export function rateLimitOrResponse(
  request: NextRequest,
  keySuffix: string,
  limit: number,
  windowMs: number,
): NextResponse | null {
  const now = Date.now();
  const key = `${getClientIp(request)}:${keySuffix}`;
  const current = bucket.get(key);

  if (!current || now >= current.resetAt) {
    bucket.set(key, { count: 1, resetAt: now + windowMs });
    return null;
  }

  if (current.count >= limit) {
    const retryAfter = Math.max(1, Math.ceil((current.resetAt - now) / 1000));

    return NextResponse.json(
      {
        error: "Too many requests",
      },
      {
        status: 429,
        headers: {
          "Retry-After": String(retryAfter),
        },
      },
    );
  }

  current.count += 1;
  bucket.set(key, current);
  return null;
}
