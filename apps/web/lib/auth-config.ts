export const ACCESS_TOKEN_COOKIE = "ytr_access";
export const REFRESH_TOKEN_COOKIE = "ytr_refresh";

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;
export const REFRESH_TOKEN_TTL_REMEMBER_SECONDS = 90 * 24 * 60 * 60;

export const AUTH_ISSUER = "yehthatrocks";
export const AUTH_AUDIENCE = "yehthatrocks-web";

export function getJwtSecret() {
  const secret = process.env.AUTH_JWT_SECRET;

  if (!secret || secret.length < 32) {
    throw new Error("AUTH_JWT_SECRET must be set to a random string of at least 32 characters");
  }

  return secret;
}
