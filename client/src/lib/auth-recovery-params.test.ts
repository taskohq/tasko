import { describe, expect, it } from "vitest";
import { tko_parseAuthRecoveryParams } from "./auth-recovery-params";

describe("auth recovery URL params", () => {
  it("reads resetToken and verifyToken", () => {
    expect(tko_parseAuthRecoveryParams("?resetToken=abc123&verifyToken=xyz789")).toEqual({ resetToken: "abc123", verifyToken: "xyz789" });
  });

  it("accepts the bare ?token= form for password reset", () => {
    expect(tko_parseAuthRecoveryParams("?token=bare-token")).toEqual({ resetToken: "bare-token", verifyToken: null });
  });

  it("ignores empty or missing values", () => {
    expect(tko_parseAuthRecoveryParams("")).toEqual({ resetToken: null, verifyToken: null });
    expect(tko_parseAuthRecoveryParams("?resetToken=&verifyToken=")).toEqual({ resetToken: null, verifyToken: null });
    expect(tko_parseAuthRecoveryParams("?unrelated=1")).toEqual({ resetToken: null, verifyToken: null });
  });
});
