import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MemoryEmailPasswordStore, setEmailPasswordStoreForTests } from "../../packages/database/src/email-password-store";
import { MemoryPlatformStore, getPlatformStore, setPlatformStoreForTests } from "../../packages/database/src/platform-store";
import { MemorySessionStore, setSessionStoreForTests } from "../../packages/database/src/session-store";
import { createInMemoryRedisAdapter, setRedisAdapterForTests } from "../../packages/redis/src/redis-adapter";
import { COOKIE_NAME } from "../../shared/const";
import { sdk } from "../../server/_core/sdk";
import { signInWithEmailPassword, signUpWithEmailPassword } from "./src/email-password-service";
import { MemoryTotpStore, getTotpStore, setTotpStoreForTests } from "./src/totp-store";
import { confirmEnrollment, disableMfa, mfaStatus, mfaVerifyLogin, startEnrollment } from "./src/mfa-service";
import { tko_decryptSecret } from "./src/secret-box";
import { tko_mintMfaChallenge, tko_verifyMfaChallenge } from "./src/mfa-challenge";
import { tko_totpCode } from "./src/totp";

function tko_cookieRequest(tko_sessionToken: string): Parameters<typeof sdk.authenticateRequest>[0] {
  return { headers: { cookie: `${COOKIE_NAME}=${tko_sessionToken}`, "user-agent": "VitestAgent/1.0" } } as never;
}

const TKO_PASSWORD = "a secure password 123";
const TKO_EMAIL = "mfa@example.com";

async function tko_signup(): Promise<{ authSubject: string; email: string }> {
  const tko_result = await signUpWithEmailPassword({ email: TKO_EMAIL, password: TKO_PASSWORD, displayName: "MFA User", correlationId: "test-signup" });
  return { authSubject: tko_result.account.authSubject, email: tko_result.account.email };
}

describe("totp mfa", () => {
  beforeEach(() => {
    setEmailPasswordStoreForTests(new MemoryEmailPasswordStore());
    setPlatformStoreForTests(new MemoryPlatformStore());
    setSessionStoreForTests(new MemorySessionStore());
    setTotpStoreForTests(new MemoryTotpStore());
    setRedisAdapterForTests(createInMemoryRedisAdapter());
  });
  afterEach(() => {
    setEmailPasswordStoreForTests(null);
    setPlatformStoreForTests(null);
    setSessionStoreForTests(null);
    setTotpStoreForTests(null);
    setRedisAdapterForTests(null);
  });

  it("stores the secret encrypted (never plaintext) and activates on a correct code", async () => {
    const tko_account = await tko_signup();
    const tko_start = await startEnrollment({ authSubject: tko_account.authSubject, accountEmail: tko_account.email, correlationId: "test-enroll" });
    expect(tko_start.secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(tko_start.otpauthUri).toContain("otpauth://totp/Tasko%3Amfa%40example.com");
    expect(tko_start.otpauthUri).toContain(`secret=${tko_start.secret}`);

    const tko_stored = await getTotpStore().getBySubject(tko_account.authSubject);
    expect(tko_stored).not.toBeNull();
    expect(tko_stored!.secretEncrypted).not.toContain(tko_start.secret); // AES-256-GCM at rest
    expect(tko_decryptSecret(tko_stored!.secretEncrypted)).toBe(tko_start.secret); // decrypts with the JWT-derived key
    expect(await mfaStatus(tko_account.authSubject)).toEqual({ enabled: false }); // pending, not yet confirmed

    await expect(confirmEnrollment({ authSubject: tko_account.authSubject, code: "000000", correlationId: "test-confirm-bad" })).rejects.toThrow("TASKO_MFA_CODE_INVALID");

    const tko_code = tko_totpCode(tko_start.secret, Date.now());
    const tko_confirmed = await confirmEnrollment({ authSubject: tko_account.authSubject, code: tko_code, correlationId: "test-confirm" });
    expect(tko_confirmed.recoveryCodes).toHaveLength(8);
    for (const tko_recovery of tko_confirmed.recoveryCodes) expect(tko_recovery).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}$/);
    expect(await mfaStatus(tko_account.authSubject)).toEqual({ enabled: true });

    const tko_storedAfter = await getTotpStore().getBySubject(tko_account.authSubject);
    for (const tko_recovery of tko_confirmed.recoveryCodes) {
      expect(JSON.stringify(tko_storedAfter!.recoveryCodes)).not.toContain(tko_recovery); // only hashes stored
    }

    await expect(startEnrollment({ authSubject: tko_account.authSubject, accountEmail: tko_account.email, correlationId: "test-enroll-2" })).rejects.toThrow("TASKO_MFA_ALREADY_ENABLED");
    await expect(confirmEnrollment({ authSubject: tko_account.authSubject, code: tko_code, correlationId: "test-confirm-2" })).rejects.toThrow("TASKO_MFA_ALREADY_ENABLED");
  });

  it("returns an MFA challenge instead of a session at sign-in, and the challenge is not a session token", async () => {
    const tko_account = await tko_signup();
    const tko_start = await startEnrollment({ authSubject: tko_account.authSubject, accountEmail: tko_account.email, correlationId: "test-enroll" });
    await confirmEnrollment({ authSubject: tko_account.authSubject, code: tko_totpCode(tko_start.secret, Date.now()), correlationId: "test-confirm" });

    const tko_challenge = await signInWithEmailPassword({ email: TKO_EMAIL, password: TKO_PASSWORD, correlationId: "test-login" });
    expect(tko_challenge).toMatchObject({ mfaRequired: true });
    expect((tko_challenge as { sessionToken?: string }).sessionToken).toBeUndefined(); // no session minted
    const tko_challengeToken = (tko_challenge as { challengeToken: string }).challengeToken;

    // The challenge token can NEVER be used as a session cookie: it lacks the
    // appId/name claims sdk.verifySession requires and has no session row.
    await expect(sdk.authenticateRequest(tko_cookieRequest(tko_challengeToken))).rejects.toThrow("Invalid session cookie");

    // Non-MFA accounts still mint sessions exactly as before.
    const tko_other = await signUpWithEmailPassword({ email: "plain@example.com", password: TKO_PASSWORD, displayName: "Plain", correlationId: "test-signup-plain" });
    const tko_plain = await signInWithEmailPassword({ email: "plain@example.com", password: TKO_PASSWORD, correlationId: "test-login-plain" });
    expect((tko_plain as { sessionToken?: string }).sessionToken).toBeTruthy();
    expect(tko_other.account.email).toBe("plain@example.com");
  });

  it("exchanges a valid challenge + TOTP code for exactly one real session", async () => {
    const tko_account = await tko_signup();
    const tko_start = await startEnrollment({ authSubject: tko_account.authSubject, accountEmail: tko_account.email, correlationId: "test-enroll" });
    await confirmEnrollment({ authSubject: tko_account.authSubject, code: tko_totpCode(tko_start.secret, Date.now()), correlationId: "test-confirm" });

    const tko_challenge = (await signInWithEmailPassword({ email: TKO_EMAIL, password: TKO_PASSWORD, correlationId: "test-login" })) as { mfaRequired: true; challengeToken: string };

    await expect(mfaVerifyLogin({ challengeToken: tko_challenge.challengeToken, code: "000000", correlationId: "test-verify-bad" })).rejects.toThrow("TASKO_MFA_CODE_INVALID"); // wrong code
    await expect(mfaVerifyLogin({ challengeToken: "garbage-token", code: "000000", correlationId: "test-verify-garbage" })).rejects.toThrow("TASKO_MFA_CHALLENGE_INVALID"); // tampered token

    const tko_verified = await mfaVerifyLogin({ challengeToken: tko_challenge.challengeToken, code: tko_totpCode(tko_start.secret, Date.now()), correlationId: "test-verify" });
    expect(tko_verified.account.email).toBe(TKO_EMAIL);
    expect(await sdk.verifySession(tko_verified.sessionToken)).toMatchObject({ openId: tko_account.authSubject });
    const tko_user = await sdk.authenticateRequest(tko_cookieRequest(tko_verified.sessionToken));
    expect(tko_user.openId).toBe(tko_account.authSubject);

    await expect(mfaVerifyLogin({ challengeToken: tko_challenge.challengeToken, code: tko_totpCode(tko_start.secret, Date.now()), correlationId: "test-verify-replay" })).rejects.toThrow("TASKO_MFA_CHALLENGE_INVALID"); // single use
  });

  it("accepts a recovery code exactly once, then rejects reuse", async () => {
    const tko_account = await tko_signup();
    const tko_start = await startEnrollment({ authSubject: tko_account.authSubject, accountEmail: tko_account.email, correlationId: "test-enroll" });
    const tko_confirmed = await confirmEnrollment({ authSubject: tko_account.authSubject, code: tko_totpCode(tko_start.secret, Date.now()), correlationId: "test-confirm" });
    const tko_recoveryCode = tko_confirmed.recoveryCodes[0];

    const tko_challenge1 = (await signInWithEmailPassword({ email: TKO_EMAIL, password: TKO_PASSWORD, correlationId: "test-login-1" })) as { challengeToken: string };
    const tko_verified = await mfaVerifyLogin({ challengeToken: tko_challenge1.challengeToken, code: tko_recoveryCode, correlationId: "test-verify-recovery" });
    expect(tko_verified.sessionToken).toBeTruthy();

    const tko_challenge2 = (await signInWithEmailPassword({ email: TKO_EMAIL, password: TKO_PASSWORD, correlationId: "test-login-2" })) as { challengeToken: string };
    await expect(mfaVerifyLogin({ challengeToken: tko_challenge2.challengeToken, code: tko_recoveryCode, correlationId: "test-verify-recovery-2" })).rejects.toThrow("TASKO_MFA_CODE_INVALID"); // burned

    const tko_challenge3 = (await signInWithEmailPassword({ email: TKO_EMAIL, password: TKO_PASSWORD, correlationId: "test-login-3" })) as { challengeToken: string };
    const tko_verifiedTotp = await mfaVerifyLogin({ challengeToken: tko_challenge3.challengeToken, code: tko_totpCode(tko_start.secret, Date.now()), correlationId: "test-verify-totp" });
    expect(tko_verifiedTotp.sessionToken).toBeTruthy(); // TOTP still works after a burned recovery code
  });

  it("rejects expired challenge tokens", async () => {
    const tko_expired = await tko_mintMfaChallenge("email:expired-subject", { expiresInMs: -5_000 });
    await expect(tko_verifyMfaChallenge(tko_expired)).rejects.toThrow("TASKO_MFA_CHALLENGE_INVALID");
  });

  it("disables MFA only with the current password and restores plain sign-in", async () => {
    const tko_account = await tko_signup();
    const tko_start = await startEnrollment({ authSubject: tko_account.authSubject, accountEmail: tko_account.email, correlationId: "test-enroll" });
    await confirmEnrollment({ authSubject: tko_account.authSubject, code: tko_totpCode(tko_start.secret, Date.now()), correlationId: "test-confirm" });

    await expect(disableMfa({ authSubject: tko_account.authSubject, password: "wrong password!", correlationId: "test-disable-bad" })).rejects.toThrow("TASKO_INVALID_CREDENTIALS");
    await disableMfa({ authSubject: tko_account.authSubject, password: TKO_PASSWORD, correlationId: "test-disable" });
    expect(await mfaStatus(tko_account.authSubject)).toEqual({ enabled: false });
    await expect(getTotpStore().getBySubject(tko_account.authSubject)).resolves.toBeNull();

    const tko_plain = await signInWithEmailPassword({ email: TKO_EMAIL, password: TKO_PASSWORD, correlationId: "test-login-plain-again" });
    expect(tko_plain).toMatchObject({ account: { email: TKO_EMAIL } });
    expect((tko_plain as { sessionToken?: string }).sessionToken).toBeTruthy(); // straight back to sessions
  });

  it("writes durable audit events for the MFA lifecycle", async () => {
    const tko_account = await tko_signup();
    const tko_start = await startEnrollment({ authSubject: tko_account.authSubject, accountEmail: tko_account.email, correlationId: "test-enroll" });
    const tko_confirmed = await confirmEnrollment({ authSubject: tko_account.authSubject, code: tko_totpCode(tko_start.secret, Date.now()), correlationId: "test-confirm" });

    const tko_challenge = (await signInWithEmailPassword({ email: TKO_EMAIL, password: TKO_PASSWORD, correlationId: "test-login" })) as { challengeToken: string };
    await mfaVerifyLogin({ challengeToken: tko_challenge.challengeToken, code: tko_confirmed.recoveryCodes[0], correlationId: "test-verify" });

    const tko_actions = (await getPlatformStore().listAuditLogs()).map(tko_record => tko_record.action);
    expect(tko_actions).toContain("auth.mfa.enabled");
    expect(tko_actions).toContain("auth.mfa.challenge_passed");

    const tko_badChallenge = (await signInWithEmailPassword({ email: TKO_EMAIL, password: TKO_PASSWORD, correlationId: "test-login-bad" })) as { challengeToken: string };
    await expect(mfaVerifyLogin({ challengeToken: tko_badChallenge.challengeToken, code: "000000", correlationId: "test-verify-failed" })).rejects.toThrow("TASKO_MFA_CODE_INVALID");
    expect((await getPlatformStore().listAuditLogs()).map(tko_record => tko_record.action)).toContain("auth.mfa.challenge_failed");

    await disableMfa({ authSubject: tko_account.authSubject, password: TKO_PASSWORD, correlationId: "test-disable" });
    expect((await getPlatformStore().listAuditLogs()).map(tko_record => tko_record.action)).toContain("auth.mfa.disabled");
  });
});
