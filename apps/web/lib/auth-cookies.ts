import { NextRequest, NextResponse } from "next/server";

import {
  ACCESS_TOKEN_COOKIE,
  ACCESS_TOKEN_TTL_SECONDS,
  REFRESH_TOKEN_COOKIE,
  REFRESH_TOKEN_TTL_REMEMBER_SECONDS,
  REFRESH_TOKEN_TTL_SECONDS,
} from "@/lib/auth-config";

function isSecureCookie() {
  return process.env.NODE_ENV === "production";
}

export function setAuthCookies(response: NextResponse, accessToken: string, refreshToken: string, remember: boolean) {
  response.cookies.set(ACCESS_TOKEN_COOKIE, accessToken, {
    httpOnly: true,
    sameSite: "strict",
    secure: isSecureCookie(),
    path: "/",
    maxAge: ACCESS_TOKEN_TTL_SECONDS,
  });

  response.cookies.set(REFRESH_TOKEN_COOKIE, refreshToken, {
    httpOnly: true,
    sameSite: "strict",
    secure: isSecureCookie(),
    path: "/",
    maxAge: remember ? REFRESH_TOKEN_TTL_REMEMBER_SECONDS : REFRESH_TOKEN_TTL_SECONDS,
  });
}

export function clearAuthCookies(response: NextResponse) {
  response.cookies.set(ACCESS_TOKEN_COOKIE, "", {
    httpOnly: true,
    sameSite: "strict",
    secure: isSecureCookie(),
    path: "/",
    maxAge: 0,
  });

  response.cookies.set(REFRESH_TOKEN_COOKIE, "", {
    httpOnly: true,
    sameSite: "strict",
    secure: isSecureCookie(),
    path: "/",
    maxAge: 0,
  });
}

export function readAuthCookies(request: NextRequest) {
  return {
    accessToken: request.cookies.get(ACCESS_TOKEN_COOKIE)?.value,
    refreshToken: request.cookies.get(REFRESH_TOKEN_COOKIE)?.value,
  };
}
