import { randomUUID } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { getRedisAdapter } from "../../../packages/redis/src/redis-adapter";
import { tko_authJwtSecretMaterial } from "./auth-secrets";

/**
 * Short-lived MFA login-challenge tokens (spec 06 §2 P1).
 *
 * When TOTP MFA is enabled, `signInWithEmailPassword` does NOT mint a session.
 * It returns one of these challenge tokens instead, which `auth.mfaVerifyLogin`
 * exchanges (after a valid TOTP/recovery code) for a real session via
 * `sdk.createSessionToken`.
 *
 * A challenge token can never be used as a session cookie:
 *  - it omits the `appId` and `name` claims that `sdk.verifySession` requires
 *    (both must be non-empty strings), so session verification rejects it;
 *  - it carries `purpose: "mfa_challenge"` + a dedicated issuer, which session
 *    JWTs never have;
 *  - it is never passed to `sdk.authenticateRequest` and never gets a session
 *    row (the server-side liveness check would reject it regardless).
 * It is consumed exactly once via a Redis marker keyed by `jti`.
 */

const TKO_CHALLENGE_PURPOSE = "mfa_challenge";
const TKO_CHALLENGE_ISSUER = "tasko:auth:mfa";
export const TKO_MFA_CHALLENGE_TTL_MS = 5 * 60_000;

function tko_challengeKey(): Uint8Array {
  return new TextEncoder().encode(tko_authJwtSecretMaterial());
}

export async function tko_mintMfaChallenge(
  tko_authSubject: string,
  tko_options: { expiresInMs?: number } = {},
): Promise<string> {
  const tko_expiresInMs = tko_options.expiresInMs ?? TKO_MFA_CHALLENGE_TTL_MS;
  return new SignJWT({ openId: tko_authSubject, purpose: TKO_CHALLENGE_PURPOSE })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setJti(randomUUID())
    .setIssuer(TKO_CHALLENGE_ISSUER)
    .setExpirationTime(Math.floor((Date.now() + tko_expiresInMs) / 1000))
    .sign(tko_challengeKey());
}

export interface TkoMfaChallengePayload {
  authSubject: string;
  jti: string;
  expiresInMs: number;
}

export async function tko_verifyMfaChallenge(tko_challengeToken: string): Promise<TkoMfaChallengePayload> {
  let tko_payload: Record<string, unknown>;
  try {
    const tko_verified = await jwtVerify(tko_challengeToken, tko_challengeKey(), { algorithms: ["HS256"], issuer: TKO_CHALLENGE_ISSUER });
    tko_payload = tko_verified.payload as Record<string, unknown>;
  } catch {
    throw new Error("TASKO_MFA_CHALLENGE_INVALID");
  }
  if (
    tko_payload.purpose !== TKO_CHALLENGE_PURPOSE ||
    typeof tko_payload.openId !== "string" ||
    tko_payload.openId.length === 0 ||
    typeof tko_payload.jti !== "string" ||
    tko_payload.jti.length === 0
  ) {
    throw new Error("TASKO_MFA_CHALLENGE_INVALID");
  }
  const tko_exp = typeof tko_payload.exp === "number" ? tko_payload.exp : 0;
  return {
    authSubject: tko_payload.openId,
    jti: tko_payload.jti,
    expiresInMs: Math.max(0, tko_exp * 1000 - Date.now()),
  };
}

/** One-time consumption marker (best-effort Redis; challenge TTL bounds it anyway). */
const TKO_CHALLENGE_USED_KEY_PREFIX = "auth:mfa:challenge-used:";

export async function tko_challengeConsumed(tko_jti: string): Promise<boolean> {
  try {
    return (await getRedisAdapter().getCache(TKO_CHALLENGE_USED_KEY_PREFIX + tko_jti)) === "1";
  } catch {
    return false;
  }
}

export async function tko_markChallengeConsumed(tko_jti: string, tko_ttlMs: number): Promise<void> {
  try {
    await getRedisAdapter().setCache(TKO_CHALLENGE_USED_KEY_PREFIX + tko_jti, "1", Math.max(tko_ttlMs, 1_000));
  } catch {
    // Best-effort: the short JWT expiry still bounds replay exposure.
  }
}
