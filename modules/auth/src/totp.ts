import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * RFC 6238 TOTP (HMAC-SHA1, 30s step, 6 digits, ±1 window) with RFC 4648
 * base32 helpers — implemented on node:crypto only, no extra dependency.
 */

const TKO_BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function tko_base32Encode(tko_bytes: Buffer): string {
  let tko_bits = 0;
  let tko_value = 0;
  let tko_output = "";
  for (let tko_index = 0; tko_index < tko_bytes.length; tko_index += 1) {
    tko_value = (tko_value << 8) | tko_bytes[tko_index];
    tko_bits += 8;
    while (tko_bits >= 5) {
      tko_output += TKO_BASE32_ALPHABET[(tko_value >>> (tko_bits - 5)) & 31];
      tko_bits -= 5;
    }
  }
  if (tko_bits > 0) tko_output += TKO_BASE32_ALPHABET[(tko_value << (5 - tko_bits)) & 31];
  return tko_output;
}

export function tko_base32Decode(tko_encoded: string): Buffer {
  const tko_clean = tko_encoded.replace(/=+$/g, "").replace(/\s+/g, "").toUpperCase();
  let tko_bits = 0;
  let tko_value = 0;
  const tko_chunks: number[] = [];
  for (let tko_index = 0; tko_index < tko_clean.length; tko_index += 1) {
    const tko_character = tko_clean[tko_index];
    const tko_code = TKO_BASE32_ALPHABET.indexOf(tko_character);
    if (tko_code < 0) throw new Error("TASKO_BASE32_INVALID");
    tko_value = (tko_value << 5) | tko_code;
    tko_bits += 5;
    if (tko_bits >= 8) {
      tko_chunks.push((tko_value >>> (tko_bits - 8)) & 0xff);
      tko_bits -= 8;
    }
  }
  return Buffer.from(tko_chunks);
}

/** 160-bit random secret, base32-encoded for authenticator apps. */
export function tko_generateTotpSecret(): string {
  return tko_base32Encode(randomBytes(20));
}

export function tko_totpCode(
  tko_secretBase32: string,
  tko_timeMs: number,
  tko_options: { stepSeconds?: number; digits?: number } = {},
): string {
  const tko_stepSeconds = tko_options.stepSeconds ?? 30;
  const tko_digits = tko_options.digits ?? 6;
  const tko_counter = Math.floor(tko_timeMs / 1000 / tko_stepSeconds);
  const tko_counterBuffer = Buffer.alloc(8);
  tko_counterBuffer.writeBigUInt64BE(BigInt(tko_counter));
  const tko_digest = createHmac("sha1", tko_base32Decode(tko_secretBase32)).update(tko_counterBuffer).digest();
  const tko_offset = tko_digest[tko_digest.length - 1] & 0x0f;
  const tko_binary =
    ((tko_digest[tko_offset] & 0x7f) << 24) |
    (tko_digest[tko_offset + 1] << 16) |
    (tko_digest[tko_offset + 2] << 8) |
    tko_digest[tko_offset + 3];
  return (tko_binary % 10 ** tko_digits).toString().padStart(tko_digits, "0");
}

/** Constant-time string comparison (equalizes work for differing lengths). */
export function tko_timingSafeStringEqual(tko_left: string, tko_right: string): boolean {
  const tko_leftBuffer = Buffer.from(tko_left, "utf8");
  const tko_rightBuffer = Buffer.from(tko_right, "utf8");
  if (tko_leftBuffer.length !== tko_rightBuffer.length) {
    // Burn an equivalent comparison so length does not leak through timing.
    timingSafeEqual(tko_leftBuffer, tko_leftBuffer);
    return false;
  }
  return timingSafeEqual(tko_leftBuffer, tko_rightBuffer);
}

/**
 * Verify a TOTP code with a ±`window` step allowance (RFC 6238 §5.2 recommends
 * resynchronizing at most one step). Returns true only for codes within the
 * accepted window.
 */
export function tko_verifyTotpCode(
  tko_secretBase32: string,
  tko_code: string,
  tko_options: { timeMs?: number; window?: number; stepSeconds?: number; digits?: number } = {},
): boolean {
  const tko_normalized = (tko_code ?? "").replace(/\s+/g, "");
  const tko_digits = tko_options.digits ?? 6;
  if (!new RegExp(`^\\d{${tko_digits}}$`).test(tko_normalized)) return false;
  const tko_timeMs = tko_options.timeMs ?? Date.now();
  const tko_window = tko_options.window ?? 1;
  const tko_stepSeconds = tko_options.stepSeconds ?? 30;
  for (let tko_offset = -tko_window; tko_offset <= tko_window; tko_offset += 1) {
    const tko_candidate = tko_totpCode(tko_secretBase32, tko_timeMs + tko_offset * tko_stepSeconds * 1000, { stepSeconds: tko_stepSeconds, digits: tko_digits });
    if (tko_timingSafeStringEqual(tko_candidate, tko_normalized)) return true;
  }
  return false;
}

/** Human-typable recovery codes, e.g. `7f3a91c2-4b8e`. Returned in plaintext exactly once. */
export function tko_generateRecoveryCodes(tko_count = 8): string[] {
  const tko_codes: string[] = [];
  for (let tko_index = 0; tko_index < tko_count; tko_index += 1) {
    const tko_hex = randomBytes(6).toString("hex");
    tko_codes.push(`${tko_hex.slice(0, 8)}-${tko_hex.slice(8)}`);
  }
  return tko_codes;
}

export function tko_otpauthUri(tko_input: { accountEmail: string; secretBase32: string; issuer?: string }): string {
  const tko_issuer = tko_input.issuer ?? "Tasko";
  const tko_label = encodeURIComponent(`${tko_issuer}:${tko_input.accountEmail}`);
  const tko_parameters = new URLSearchParams({ secret: tko_input.secretBase32, issuer: tko_issuer, algorithm: "SHA1", digits: "6", period: "30" });
  return `otpauth://totp/${tko_label}?${tko_parameters.toString()}`;
}
