import { describe, expect, it } from "vitest";
import {
  tko_base32Decode,
  tko_base32Encode,
  tko_generateRecoveryCodes,
  tko_generateTotpSecret,
  tko_otpauthUri,
  tko_timingSafeStringEqual,
  tko_totpCode,
  tko_verifyTotpCode,
} from "./src/totp";

const TKO_RFC_SECRET_BYTES = Buffer.from("12345678901234567890", "ascii");

// RFC 6238 appendix B vectors (SHA-1), truncated to the 6-digit forms.
const TKO_RFC6238_VECTORS: Array<[number, string]> = [
  [59, "287082"],
  [1_111_111_109, "081804"],
  [1_111_111_111, "050471"],
  [1_234_567_890, "005924"],
  [2_000_000_000, "279037"],
  [20_000_000_000, "353130"],
];

describe("totp (RFC 6238)", () => {
  it("round-trips base32", () => {
    const tko_bytes = Buffer.from([0, 1, 2, 250, 251, 252, 253, 254, 255, 77]);
    expect(tko_base32Decode(tko_base32Encode(tko_bytes))).toEqual(tko_bytes);
    // RFC 4648 reference encodings (unpadded, as used for TOTP secrets); padded input is decoded too.
    expect(tko_base32Encode(Buffer.from("foo", "ascii"))).toBe("MZXW6");
    expect(tko_base32Encode(Buffer.from("foob", "ascii"))).toBe("MZXW6YQ");
    expect(tko_base32Decode("MZXW6YQ=").toString("ascii")).toBe("foob");
    expect(tko_base32Decode("mzxw6yq").toString("ascii")).toBe("foob");
  });

  it("matches the RFC 6238 SHA-1 test vectors at 6 digits", () => {
    const tko_secret = tko_base32Encode(TKO_RFC_SECRET_BYTES);
    for (const [tko_unixSeconds, tko_expected] of TKO_RFC6238_VECTORS) {
      expect(tko_totpCode(tko_secret, tko_unixSeconds * 1000)).toBe(tko_expected);
    }
  });

  it("accepts the current step and ±1 window, rejects further drift", () => {
    const tko_secret = tko_base32Encode(TKO_RFC_SECRET_BYTES);
    const tko_now = 1_234_567_890_000; // aligned to a step boundary
    const tko_current = tko_totpCode(tko_secret, tko_now);
    const tko_previous = tko_totpCode(tko_secret, tko_now - 30_000);
    const tko_next = tko_totpCode(tko_secret, tko_now + 30_000);
    expect(tko_verifyTotpCode(tko_secret, tko_current, { timeMs: tko_now })).toBe(true);
    expect(tko_verifyTotpCode(tko_secret, tko_previous, { timeMs: tko_now })).toBe(true);
    expect(tko_verifyTotpCode(tko_secret, tko_next, { timeMs: tko_now })).toBe(true);
    const tko_farPast = tko_totpCode(tko_secret, tko_now - 60_000);
    const tko_farFuture = tko_totpCode(tko_secret, tko_now + 60_000);
    expect(tko_verifyTotpCode(tko_secret, tko_farPast, { timeMs: tko_now })).toBe(false);
    expect(tko_verifyTotpCode(tko_secret, tko_farFuture, { timeMs: tko_now })).toBe(false);
  });

  it("rejects malformed and wrong codes", () => {
    const tko_secret = tko_base32Encode(TKO_RFC_SECRET_BYTES);
    const tko_now = 59_000;
    expect(tko_verifyTotpCode(tko_secret, "abc", { timeMs: tko_now })).toBe(false);
    expect(tko_verifyTotpCode(tko_secret, "12345", { timeMs: tko_now })).toBe(false);
    expect(tko_verifyTotpCode(tko_secret, "1234567", { timeMs: tko_now })).toBe(false);
    expect(tko_verifyTotpCode(tko_secret, "", { timeMs: tko_now })).toBe(false);
    const tko_right = tko_totpCode(tko_secret, tko_now);
    const tko_wrongDigit = tko_right === "000000" ? "000001" : "000000";
    expect(tko_verifyTotpCode(tko_secret, tko_wrongDigit, { timeMs: tko_now })).toBe(false);
  });

  it("generates usable secrets and recovery codes", () => {
    const tko_first = tko_generateTotpSecret();
    const tko_second = tko_generateTotpSecret();
    expect(tko_first).toMatch(/^[A-Z2-7]{32}$/);
    expect(tko_first).not.toBe(tko_second);
    expect(tko_verifyTotpCode(tko_first, tko_totpCode(tko_first, Date.now()))).toBe(true);

    const tko_codes = tko_generateRecoveryCodes(8);
    expect(tko_codes).toHaveLength(8);
    for (const tko_code of tko_codes) expect(tko_code).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}$/);
    expect(new Set(tko_codes).size).toBe(8);
  });

  it("compares strings in constant time and builds an otpauth URI", () => {
    expect(tko_timingSafeStringEqual("287082", "287082")).toBe(true);
    expect(tko_timingSafeStringEqual("287082", "287083")).toBe(false);
    expect(tko_timingSafeStringEqual("287082", "28708")).toBe(false);
    const tko_uri = tko_otpauthUri({ accountEmail: "owner@example.com", secretBase32: "JBSWY3DPEHPK3PXP" });
    expect(tko_uri).toBe("otpauth://totp/Tasko%3Aowner%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=Tasko&algorithm=SHA1&digits=6&period=30");
  });
});
