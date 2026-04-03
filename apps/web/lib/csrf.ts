import { NextRequest, NextResponse } from "next/server";

function isLoopbackHost(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function sameOriginOrLoopbackEquivalent(a: URL, b: URL) {
  if (a.origin === b.origin) {
    return true;
  }

  const sameProtocol = a.protocol === b.protocol;
  const samePort = a.port === b.port;
  const bothLoopback = isLoopbackHost(a.hostname) && isLoopbackHost(b.hostname);

  return sameProtocol && samePort && bothLoopback;
}

function buildAllowedOrigins(request: NextRequest) {
  const allowed = new Set<string>([request.nextUrl.origin]);

  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();

  if (forwardedHost) {
    const proto = forwardedProto || request.nextUrl.protocol.replace(":", "");
    allowed.add(`${proto}://${forwardedHost}`);
  }

  const host = request.headers.get("host")?.trim();

  if (host) {
    const proto = (forwardedProto || request.nextUrl.protocol.replace(":", "")).trim();
    allowed.add(`${proto}://${host}`);
  }

  return [...allowed]
    .map((value) => {
      try {
        return new URL(value);
      } catch {
        return null;
      }
    })
    .filter((value): value is URL => value !== null);
}

export function verifySameOrigin(request: NextRequest): NextResponse | null {
  const method = request.method.toUpperCase();

  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    return null;
  }

  const origin = request.headers.get("origin");

  if (!origin) {
    return NextResponse.json({ error: "Missing origin header" }, { status: 403 });
  }

  let originUrl: URL;

  try {
    originUrl = new URL(origin);
  } catch {
    return NextResponse.json({ error: "Invalid origin header" }, { status: 403 });
  }

  const allowedOrigins = buildAllowedOrigins(request);

  if (process.env.NODE_ENV === "production") {
    const isStrictSameOrigin = allowedOrigins.some((candidate) => originUrl.origin === candidate.origin);

    if (!isStrictSameOrigin) {
      return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
    }

    return null;
  }

  const isAllowed = allowedOrigins.some((candidate) => sameOriginOrLoopbackEquivalent(originUrl, candidate));

  if (!isAllowed) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }

  return null;
}
