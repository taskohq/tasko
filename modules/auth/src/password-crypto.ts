import { randomBytes, scrypt as tko_scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

/**
 * Shared password cryptography and policy for every Tasko auth surface
 * (signup, password reset, password change). The encoded format is identical
 * to the one historically written by email-password-service.ts:
 * `scrypt$N$r$p$salt(base64url)$derived(base64url)`.
 */

const tko_scryptAsync = promisify(tko_scrypt);
export const TKO_PASSWORD_KDF = { algorithm: "scrypt", N: 16_384, r: 8, p: 1, keyLength: 64 } as const;

/** Tasko password policy (spec 06 §2 P1): 12–128 characters. */
export function tko_passwordPolicySatisfied(tko_password: string): boolean {
  return tko_password.length >= 12 && tko_password.length <= 128;
}

export async function tko_passwordHash(tko_password: string, tko_salt = randomBytes(16)): Promise<string> {
  const tko_derived = await tko_scryptAsync(tko_password, tko_salt, TKO_PASSWORD_KDF.keyLength) as Buffer;
  return `${TKO_PASSWORD_KDF.algorithm}$${TKO_PASSWORD_KDF.N}$${TKO_PASSWORD_KDF.r}$${TKO_PASSWORD_KDF.p}$${tko_salt.toString("base64url")}$${tko_derived.toString("base64url")}`;
}

export async function tko_verifyPassword(tko_password: string, tko_encoded: string): Promise<boolean> {
  try {
    const [tko_algorithm, tko_n, tko_r, tko_p, tko_salt, tko_expected] = tko_encoded.split("$");
    if (
      tko_algorithm !== TKO_PASSWORD_KDF.algorithm ||
      Number(tko_n) !== TKO_PASSWORD_KDF.N ||
      Number(tko_r) !== TKO_PASSWORD_KDF.r ||
      Number(tko_p) !== TKO_PASSWORD_KDF.p ||
      !tko_salt ||
      !tko_expected
    ) return false;
    const tko_derived = await tko_scryptAsync(tko_password, Buffer.from(tko_salt, "base64url"), TKO_PASSWORD_KDF.keyLength) as Buffer;
    const tko_expectedBuffer = Buffer.from(tko_expected, "base64url");
    return tko_derived.length === tko_expectedBuffer.length && timingSafeEqual(tko_derived, tko_expectedBuffer);
  } catch {
    return false;
  }
}
