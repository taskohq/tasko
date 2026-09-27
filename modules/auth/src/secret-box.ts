import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { tko_authJwtSecretMaterial } from "./auth-secrets";

/**
 * AES-256-GCM secret box for TOTP shared secrets at rest (spec 06 §2 P1).
 * The key is derived with scrypt from env JWT_SECRET (dev fallback documented
 * in auth-secrets.ts) using a fixed application salt, so ciphertexts remain
 * decryptable across restarts. Blob format: `v1.<iv>.<authTag>.<ciphertext>`
 * (all base64url). Plaintext secrets are never stored or logged.
 */

const TKO_SECRET_BOX_SALT = "tasko:totp-secret-box:v1";
const TKO_SECRET_BOX_VERSION = "v1";

let tko_cachedKey: Buffer | null = null;

function tko_secretBoxKey(): Buffer {
  if (!tko_cachedKey) {
    tko_cachedKey = scryptSync(tko_authJwtSecretMaterial(), TKO_SECRET_BOX_SALT, 32);
  }
  return tko_cachedKey;
}

export function tko_encryptSecret(tko_plaintext: string): string {
  const tko_iv = randomBytes(12);
  const tko_cipher = createCipheriv("aes-256-gcm", tko_secretBoxKey(), tko_iv);
  const tko_ciphertext = Buffer.concat([tko_cipher.update(tko_plaintext, "utf8"), tko_cipher.final()]);
  const tko_authTag = tko_cipher.getAuthTag();
  return [TKO_SECRET_BOX_VERSION, tko_iv.toString("base64url"), tko_authTag.toString("base64url"), tko_ciphertext.toString("base64url")].join(".");
}

export function tko_decryptSecret(tko_blob: string): string {
  const [tko_version, tko_iv, tko_authTag, tko_ciphertext] = tko_blob.split(".");
  if (tko_version !== TKO_SECRET_BOX_VERSION || !tko_iv || !tko_authTag || !tko_ciphertext) {
    throw new Error("TASKO_SECRET_BLOB_INVALID");
  }
  const tko_decipher = createDecipheriv("aes-256-gcm", tko_secretBoxKey(), Buffer.from(tko_iv, "base64url"));
  tko_decipher.setAuthTag(Buffer.from(tko_authTag, "base64url"));
  return Buffer.concat([tko_decipher.update(Buffer.from(tko_ciphertext, "base64url")), tko_decipher.final()]).toString("utf8");
}
