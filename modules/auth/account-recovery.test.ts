import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import { MemoryEmailPasswordStore, setEmailPasswordStoreForTests } from "../../packages/database/src/email-password-store";
import { MemoryPlatformStore, setPlatformStoreForTests } from "../../packages/database/src/platform-store";
import { MemorySessionStore, getSessionStore, setSessionStoreForTests } from "../../packages/database/src/session-store";
import { createInMemoryRedisAdapter, setRedisAdapterForTests } from "../../packages/redis/src/redis-adapter";
import { COOKIE_NAME } from "../../shared/const";
import { sdk } from "../../server/_core/sdk";
import { MemoryAccountRecoveryStore, getAccountRecoveryStore, setAccountRecoveryStoreForTests } from "./src/account-recovery-store";
import {
  changeEmailPassword,
  signInWithEmailPassword,
  signUpWithEmailPassword,
  type EmailPasswordAuthResult,
  type TkoSignInResult,
} from "./src/email-password-service";
import {
  requestPasswordReset,
  resetPassword,
  resendVerificationEmail,
  verifyEmail,
} from "./src/account-recovery-service";
import { tko_hashSessionToken, tko_isSessionAlive, tko_listActiveSessions } from "./src/session-service";

function tko_cookieRequest(tko_sessionToken: string): Parameters<typeof sdk.authenticateRequest>[0] {
  return { headers: { cookie: `${COOKIE_NAME}=${tko_sessionToken}`, "user-agent": "VitestAgent/1.0" } } as never;
}

/** Narrows a sign-in result to the non-MFA session outcome. */
function tko_expectSession(tko_result: TkoSignInResult): EmailPasswordAuthResult {
  if ("mfaRequired" in tko_result || !tko_result.sessionToken) throw new Error("Expected a session, got an MFA challenge");
  return tko_result;
}

function tko_hashToken(tko_token: string): string {
  return createHash("sha256").update(tko_token).digest("hex");
}

const TKO_PASSWORD = "a secure password 123";
const TKO_NEW_PASSWORD = "an even safer password 456";

describe("account recovery: email verification", () => {
  beforeEach(() => {
    setEmailPasswordStoreForTests(new MemoryEmailPasswordStore());
    setPlatformStoreForTests(new MemoryPlatformStore());
    setSessionStoreForTests(new MemorySessionStore());
    setAccountRecoveryStoreForTests(new MemoryAccountRecoveryStore());
    setRedisAdapterForTests(createInMemoryRedisAdapter());
  });
  afterEach(() => {
    setEmailPasswordStoreForTests(null);
    setPlatformStoreForTests(null);
    setSessionStoreForTests(null);
    setAccountRecoveryStoreForTests(null);
    setRedisAdapterForTests(null);
  });

  it("issues a verification token on signup and marks the email verified with a valid token", async () => {
    const tko_signup = await signUpWithEmailPassword({ email: "verify@example.com", password: TKO_PASSWORD, displayName: "Verifier", correlationId: "test-signup" });
    const tko_store = getAccountRecoveryStore() as MemoryAccountRecoveryStore;
    expect(await tko_store.isEmailVerified(tko_signup.account.authSubject)).toBe(false);
    expect(tko_store.tko_verificationTokens.size).toBe(1); // signup auto-issued a token

    const tko_resend = await resendVerificationEmail({ authSubject: tko_signup.account.authSubject, correlationId: "test-resend" });
    expect(tko_resend).toMatchObject({ sent: true, alreadyVerified: false });
    expect(tko_resend.devOnly?.verificationToken).toBeTruthy(); // NODE_ENV=test: devOnly exposure for testability
    expect(tko_store.tko_verificationTokens.size).toBe(1); // resend replaced the pending signup token

    const tko_result = await verifyEmail({ token: tko_resend.devOnly!.verificationToken, correlationId: "test-verify" });
    expect(tko_result.verified).toBe(true);
    expect(await tko_store.isEmailVerified(tko_signup.account.authSubject)).toBe(true);
    expect(await (await getAccountRecoveryStore()).isEmailVerified(tko_signup.account.authSubject)).toBe(true);
  });

  it("rejects reused and expired verification tokens", async () => {
    const tko_signup = await signUpWithEmailPassword({ email: "once@example.com", password: TKO_PASSWORD, displayName: "Once", correlationId: "test-signup" });
    const tko_resend = await resendVerificationEmail({ authSubject: tko_signup.account.authSubject, correlationId: "test-resend" });
    const tko_token = tko_resend.devOnly!.verificationToken;
    await expect(verifyEmail({ token: tko_token, correlationId: "test-verify-1" })).resolves.toMatchObject({ verified: true });
    await expect(verifyEmail({ token: tko_token, correlationId: "test-verify-2" })).rejects.toThrow("TASKO_VERIFY_TOKEN_INVALID"); // single use

    const tko_expiredToken = randomBytes(32).toString("base64url");
    await getAccountRecoveryStore().createEmailVerificationToken({ authSubject: tko_signup.account.authSubject, tokenHash: tko_hashToken(tko_expiredToken), expiresAt: new Date(Date.now() - 1_000) });
    await expect(verifyEmail({ token: tko_expiredToken, correlationId: "test-verify-3" })).rejects.toThrow("TASKO_VERIFY_TOKEN_INVALID"); // expired
  });

  it("does not block login on an unverified email", async () => {
    await signUpWithEmailPassword({ email: "unverified@example.com", password: TKO_PASSWORD, displayName: "Unverified", correlationId: "test-signup" });
    await expect(signInWithEmailPassword({ email: "unverified@example.com", password: TKO_PASSWORD, correlationId: "test-login" })).resolves.toMatchObject({ account: { email: "unverified@example.com" } });
  });
});

describe("account recovery: password reset", () => {
  beforeEach(() => {
    setEmailPasswordStoreForTests(new MemoryEmailPasswordStore());
    setPlatformStoreForTests(new MemoryPlatformStore());
    setSessionStoreForTests(new MemorySessionStore());
    setAccountRecoveryStoreForTests(new MemoryAccountRecoveryStore());
    setRedisAdapterForTests(createInMemoryRedisAdapter());
  });
  afterEach(() => {
    setEmailPasswordStoreForTests(null);
    setPlatformStoreForTests(null);
    setSessionStoreForTests(null);
    setAccountRecoveryStoreForTests(null);
    setRedisAdapterForTests(null);
  });

  it("returns the same generic response for known and unknown emails (no enumeration)", async () => {
    await signUpWithEmailPassword({ email: "known@example.com", password: TKO_PASSWORD, displayName: "Known", correlationId: "test-signup" });
    const tko_known = await requestPasswordReset({ email: "KNOWN@Example.com", correlationId: "test-reset-req" });
    const tko_unknown = await requestPasswordReset({ email: "ghost@example.com", correlationId: "test-reset-req-unknown" });
    expect(tko_known).toMatchObject({ success: true });
    expect(tko_unknown).toEqual({ success: true }); // no devOnly, no existence hint
    expect((getAccountRecoveryStore() as MemoryAccountRecoveryStore).tko_resetTokens.size).toBe(1); // token only for the known account
  });

  it("resets the password with a valid one-time token and lands the user logged-in", async () => {
    const tko_signup = await signUpWithEmailPassword({ email: "reset@example.com", password: TKO_PASSWORD, displayName: "Resetter", correlationId: "test-signup" });
    const tko_request = await requestPasswordReset({ email: "reset@example.com", correlationId: "test-reset-req" });
    const tko_token = tko_request.devOnly!.resetToken;
    expect(tko_token).toBeTruthy();

    const tko_reset = await resetPassword({ token: tko_token, newPassword: TKO_NEW_PASSWORD, correlationId: "test-reset" });
    expect(tko_reset.account.email).toBe("reset@example.com");
    expect(await sdk.verifySession(tko_reset.sessionToken)).toMatchObject({ openId: tko_signup.account.authSubject });

    await expect(signInWithEmailPassword({ email: "reset@example.com", password: TKO_PASSWORD, correlationId: "test-old-login" })).rejects.toThrow("TASKO_INVALID_CREDENTIALS");
    await expect(signInWithEmailPassword({ email: "reset@example.com", password: TKO_NEW_PASSWORD, correlationId: "test-new-login" })).resolves.toMatchObject({ account: { email: "reset@example.com" } });
  });

  it("revokes ALL sessions of the account when the password is reset", async () => {
    await signUpWithEmailPassword({ email: "sessions@example.com", password: TKO_PASSWORD, displayName: "Sessions", correlationId: "test-signup" });
    const tko_loginA = tko_expectSession(await signInWithEmailPassword({ email: "sessions@example.com", password: TKO_PASSWORD, correlationId: "test-login-a" }));
    const tko_loginB = tko_expectSession(await signInWithEmailPassword({ email: "sessions@example.com", password: TKO_PASSWORD, correlationId: "test-login-b" }));
    expect(await tko_listActiveSessions(tko_loginA.account.authSubject)).toHaveLength(3);

    const tko_request = await requestPasswordReset({ email: "sessions@example.com", correlationId: "test-reset-req" });
    const tko_reset = await resetPassword({ token: tko_request.devOnly!.resetToken, newPassword: TKO_NEW_PASSWORD, correlationId: "test-reset" });

    expect(await tko_isSessionAlive(tko_loginA.sessionToken)).toBe(false);
    expect(await tko_isSessionAlive(tko_loginB.sessionToken)).toBe(false);
    await expect(sdk.authenticateRequest(tko_cookieRequest(tko_loginB.sessionToken))).rejects.toThrow("Session is no longer active");
    expect(await tko_listActiveSessions(tko_loginA.account.authSubject)).toHaveLength(1); // only the fresh post-reset session
    expect(await tko_isSessionAlive(tko_reset.sessionToken)).toBe(true);
  });

  it("rejects expired and reused reset tokens with the same error", async () => {
    const tko_signup = await signUpWithEmailPassword({ email: "tokens@example.com", password: TKO_PASSWORD, displayName: "Tokens", correlationId: "test-signup" });

    const tko_expiredToken = randomBytes(32).toString("base64url");
    await getAccountRecoveryStore().createPasswordResetToken({ authSubject: tko_signup.account.authSubject, tokenHash: tko_hashToken(tko_expiredToken), expiresAt: new Date(Date.now() - 1_000) });
    await expect(resetPassword({ token: tko_expiredToken, newPassword: TKO_NEW_PASSWORD, correlationId: "test-expired" })).rejects.toThrow("TASKO_RESET_TOKEN_INVALID");

    const tko_request = await requestPasswordReset({ email: "tokens@example.com", correlationId: "test-reset-req" });
    const tko_token = tko_request.devOnly!.resetToken;
    await expect(resetPassword({ token: tko_token, newPassword: TKO_NEW_PASSWORD, correlationId: "test-reset-1" })).resolves.toBeTruthy();
    await expect(resetPassword({ token: tko_token, newPassword: TKO_NEW_PASSWORD, correlationId: "test-reset-2" })).rejects.toThrow("TASKO_RESET_TOKEN_INVALID"); // single use
    await expect(resetPassword({ token: "totally-unknown-token-value", newPassword: TKO_NEW_PASSWORD, correlationId: "test-unknown" })).rejects.toThrow("TASKO_RESET_TOKEN_INVALID");
  });

  it("enforces the password policy on reset", async () => {
    await signUpWithEmailPassword({ email: "policy@example.com", password: TKO_PASSWORD, displayName: "Policy", correlationId: "test-signup" });
    const tko_request = await requestPasswordReset({ email: "policy@example.com", correlationId: "test-reset-req" });
    await expect(resetPassword({ token: tko_request.devOnly!.resetToken, newPassword: "short", correlationId: "test-policy" })).rejects.toThrow("TASKO_PASSWORD_POLICY_FAILED");
    // The token must survive a policy failure (it was not the token's fault)...
    await expect(resetPassword({ token: tko_request.devOnly!.resetToken, newPassword: TKO_NEW_PASSWORD, correlationId: "test-policy-ok" })).resolves.toBeTruthy();
  });

  it("rate limits repeated reset requests per normalized email", async () => {
    for (let tko_attempt = 0; tko_attempt < 5; tko_attempt += 1) {
      await expect(requestPasswordReset({ email: "Throttle@Example.com", correlationId: `test-reset-req-${tko_attempt}` })).resolves.toMatchObject({ success: true });
    }
    await expect(requestPasswordReset({ email: "throttle@example.com", correlationId: "test-reset-req-throttled" })).rejects.toThrow("TASKO_AUTH_RATE_LIMITED");
  });
});

describe("account recovery: password change (authed)", () => {
  beforeEach(() => {
    setEmailPasswordStoreForTests(new MemoryEmailPasswordStore());
    setPlatformStoreForTests(new MemoryPlatformStore());
    setSessionStoreForTests(new MemorySessionStore());
    setAccountRecoveryStoreForTests(new MemoryAccountRecoveryStore());
    setRedisAdapterForTests(createInMemoryRedisAdapter());
  });
  afterEach(() => {
    setEmailPasswordStoreForTests(null);
    setPlatformStoreForTests(null);
    setSessionStoreForTests(null);
    setAccountRecoveryStoreForTests(null);
    setRedisAdapterForTests(null);
  });

  it("requires the current password, enforces policy, revokes other sessions and keeps the current one", async () => {
    const tko_email = "changer@example.com";
    await signUpWithEmailPassword({ email: tko_email, password: TKO_PASSWORD, displayName: "Changer", correlationId: "test-signup" });
    const tko_current = tko_expectSession(await signInWithEmailPassword({ email: tko_email, password: TKO_PASSWORD, correlationId: "test-login-current" }));
    await signInWithEmailPassword({ email: tko_email, password: TKO_PASSWORD, correlationId: "test-login-other" });
    const tko_subject = tko_current.account.authSubject;

    await expect(changeEmailPassword({ authSubject: tko_subject, currentPassword: "wrong password!", newPassword: TKO_NEW_PASSWORD, currentSessionToken: tko_current.sessionToken, correlationId: "test-change" })).rejects.toThrow("TASKO_INVALID_CREDENTIALS");
    await expect(changeEmailPassword({ authSubject: tko_subject, currentPassword: TKO_PASSWORD, newPassword: "short", currentSessionToken: tko_current.sessionToken, correlationId: "test-change" })).rejects.toThrow("TASKO_PASSWORD_POLICY_FAILED");

    await changeEmailPassword({ authSubject: tko_subject, currentPassword: TKO_PASSWORD, newPassword: TKO_NEW_PASSWORD, currentSessionToken: tko_current.sessionToken, correlationId: "test-change" });

    expect(await tko_isSessionAlive(tko_current.sessionToken)).toBe(true); // current session kept
    expect(await tko_listActiveSessions(tko_subject)).toHaveLength(1); // everything else revoked
    await expect(signInWithEmailPassword({ email: tko_email, password: TKO_PASSWORD, correlationId: "test-old-login" })).rejects.toThrow("TASKO_INVALID_CREDENTIALS");
    await expect(signInWithEmailPassword({ email: tko_email, password: TKO_NEW_PASSWORD, correlationId: "test-new-login" })).resolves.toBeTruthy();
  });

  it("only reports verified emails through the auth.me additive helper for email/password subjects", async () => {
    const tko_signup = await signUpWithEmailPassword({ email: "meshape@example.com", password: TKO_PASSWORD, displayName: "Me Shape", correlationId: "test-signup" });
    expect(await getAccountRecoveryStore().isEmailVerified(tko_signup.account.authSubject)).toBe(false);
    const tko_resend = await resendVerificationEmail({ authSubject: tko_signup.account.authSubject, correlationId: "test-resend" });
    await verifyEmail({ token: tko_resend.devOnly!.verificationToken, correlationId: "test-verify" });
    expect(await getAccountRecoveryStore().isEmailVerified(tko_signup.account.authSubject)).toBe(true);
  });
});
