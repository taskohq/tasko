import { ENV } from "../../../server/_core/env";

/**
 * Secret material shared by the MFA challenge JWT and the AES-GCM secret box.
 *
 * Production uses env JWT_SECRET (the same secret the session SDK signs with).
 * Development fallback: a fixed, documented, non-secret constant so flows are
 * testable without configuration. NEVER set JWT_SECRET to this value in
 * production — the server refuses to start real auth on it there.
 */
export const TKO_DEV_INSECURE_AUTH_SECRET = "tasko-dev-insecure-auth-secret-do-not-use-in-production";

export function tko_authJwtSecretMaterial(): string {
  const tko_secret = ENV.cookieSecret;
  if (tko_secret && tko_secret.length > 0) return tko_secret;
  if (ENV.isProduction) throw new Error("TASKO_AUTH_SECRET_MISSING: set JWT_SECRET in production");
  return TKO_DEV_INSECURE_AUTH_SECRET;
}
