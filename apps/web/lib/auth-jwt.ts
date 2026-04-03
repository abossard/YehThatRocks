import { jwtVerify, SignJWT } from "jose";

import {
  ACCESS_TOKEN_TTL_SECONDS,
  AUTH_AUDIENCE,
  AUTH_ISSUER,
  REFRESH_TOKEN_TTL_REMEMBER_SECONDS,
  REFRESH_TOKEN_TTL_SECONDS,
  getJwtSecret,
} from "@/lib/auth-config";

type TokenType = "access" | "refresh";

type AuthTokenPayload = {
  type: TokenType;
  uid: number;
  email: string;
  remember?: boolean;
};

const encoder = new TextEncoder();

function getSecretKey() {
  return encoder.encode(getJwtSecret());
}

async function signToken(payload: AuthTokenPayload, expiresInSeconds: number) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuedAt()
    .setIssuer(AUTH_ISSUER)
    .setAudience(AUTH_AUDIENCE)
    .setExpirationTime(`${expiresInSeconds}s`)
    .setSubject(String(payload.uid))
    .sign(getSecretKey());
}

export async function signAccessToken(uid: number, email: string) {
  return signToken({ type: "access", uid, email }, ACCESS_TOKEN_TTL_SECONDS);
}

export async function signRefreshToken(uid: number, email: string, remember: boolean) {
  return signToken(
    { type: "refresh", uid, email, remember },
    remember ? REFRESH_TOKEN_TTL_REMEMBER_SECONDS : REFRESH_TOKEN_TTL_SECONDS,
  );
}

export async function verifyToken(token: string, expectedType: TokenType) {
  const { payload } = await jwtVerify(token, getSecretKey(), {
    issuer: AUTH_ISSUER,
    audience: AUTH_AUDIENCE,
  });

  if (payload.type !== expectedType) {
    throw new Error("Unexpected token type");
  }

  const uid = Number(payload.uid);
  const email = String(payload.email ?? "");

  if (!Number.isInteger(uid) || uid <= 0 || !email) {
    throw new Error("Invalid token payload");
  }

  return { uid, email, remember: Boolean(payload.remember) };
}
