import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { COOKIE_NAME } from "../../shared/const";
import { sdk } from "../../server/_core/sdk";
import { MemoryEmailPasswordStore, setEmailPasswordStoreForTests } from "../../packages/database/src/email-password-store";
import { MemoryPlatformStore, setPlatformStoreForTests } from "../../packages/database/src/platform-store";
import {
  MemorySessionStore,
  getSessionStore,
  setSessionStoreForTests,
  tko_isSessionRecordAlive,
} from "../../packages/database/src/session-store";
import { createInMemoryRedisAdapter, setRedisAdapterForTests } from "../../packages/redis/src/redis-adapter";
import { signInWithEmailPassword, signUpWithEmailPassword } from "./src/email-password-service";
import {
  tko_hashSessionToken,
  tko_isSessionAlive,
  tko_listActiveSessions,
  tko_revokeAllSessionsForSubject,
  tko_revokeSessionByToken,
  tko_shouldTrackSubject,
} from "./src/session-service";

function tko_cookieRequest(tko_sessionToken: string): Parameters<typeof sdk.authenticateRequest>[0] {
  return { headers: { cookie: `${COOKIE_NAME}=${tko_sessionToken}`, "user-agent": "VitestAgent/1.0" } } as never;
}

describe("session revocation (acceptance-test K)", () => {
  beforeEach(() => {
    setEmailPasswordStoreForTests(new MemoryEmailPasswordStore());
    setPlatformStoreForTests(new MemoryPlatformStore());
    setSessionStoreForTests(new MemorySessionStore());
    setRedisAdapterForTests(createInMemoryRedisAdapter());
  });

  afterEach(() => {
    setEmailPasswordStoreForTests(null);
    setPlatformStoreForTests(null);
    setSessionStoreForTests(null);
    setRedisAdapterForTests(null);
  });

  it("persists a revocable session row for every minted token", async () => {
    const tko_signup = await signUpWithEmailPassword({
      email: "sessions@example.com",
      password: "a secure password 123",
      displayName: "Session Tester",
      correlationId: "test-mint",
    });
    const tko_record = await getSessionStore().findByTokenHash(tko_hashSessionToken(tko_signup.sessionToken));
    expect(tko_record).not.toBeNull();
    expect(tko_record?.authSubject).toBe(tko_signup.account.authSubject);
    expect(tko_isSessionRecordAlive(tko_record)).toBe(true);
  });

  it("authenticates a minted session and captures the device label", async () => {
    const tko_signup = await signUpWithEmailPassword({
      email: "device@example.com",
      password: "a secure password 123",
      displayName: "Device Tester",
      correlationId: "test-device",
    });
    const tko_user = await sdk.authenticateRequest(tko_cookieRequest(tko_signup.sessionToken));
    expect(tko_user.openId).toBe(tko_signup.account.authSubject);
    const tko_active = await tko_listActiveSessions(tko_signup.account.authSubject);
    expect(tko_active).toHaveLength(1);
    expect(tko_active[0]?.device).toBe("VitestAgent/1.0");
  });

  it("rejects a revoked session immediately, including through the 30s verdict cache", async () => {
    const tko_signup = await signUpWithEmailPassword({
      email: "revoke@example.com",
      password: "a secure password 123",
      displayName: "Revoke Tester",
      correlationId: "test-revoke",
    });
    // Warms the alive verdict cache.
    expect(await tko_isSessionAlive(tko_signup.sessionToken)).toBe(true);
    expect((await sdk.authenticateRequest(tko_cookieRequest(tko_signup.sessionToken))).openId).toBe(
      tko_signup.account.authSubject,
    );

    expect(await tko_revokeSessionByToken(tko_signup.sessionToken)).toBe(true);

    // The cached "alive" verdict was overwritten on revocation, so the very
    // next request is rejected without waiting for cache expiry.
    await expect(tko_isSessionAlive(tko_signup.sessionToken)).resolves.toBe(false);
    await expect(sdk.authenticateRequest(tko_cookieRequest(tko_signup.sessionToken))).rejects.toThrow(
      "Session is no longer active",
    );
    const tko_record = await getSessionStore().findByTokenHash(tko_hashSessionToken(tko_signup.sessionToken));
    expect(tko_record?.revokedAt).not.toBeNull();
  });

  it("keeps unknown (never-minted) tokens out even when the JWT itself verifies", async () => {
    const tko_ghostToken = await sdk.signSession({ openId: "email:ghost", appId: "app", name: "Ghost" });
    await expect(sdk.authenticateRequest(tko_cookieRequest(tko_ghostToken))).rejects.toThrow("Session is no longer active");
  });

  it("revokes all sessions of a subject except the current one", async () => {
    const tko_email = "multidevice@example.com";
    const tko_password = "a secure password 123";
    await signUpWithEmailPassword({ email: tko_email, password: tko_password, displayName: "Multi", correlationId: "test-signup" });
    const tko_first = await signInWithEmailPassword({ email: tko_email, password: tko_password, correlationId: "test-login-1" });
    const tko_second = await signInWithEmailPassword({ email: tko_email, password: tko_password, correlationId: "test-login-2" });
    const tko_subject = tko_first.account.authSubject;
    expect(await tko_listActiveSessions(tko_subject)).toHaveLength(3); // signup + two sign-ins

    const tko_revoked = await tko_revokeAllSessionsForSubject(tko_subject, tko_hashSessionToken(tko_first.sessionToken));
    expect(tko_revoked).toBe(2);
    expect(await tko_listActiveSessions(tko_subject)).toHaveLength(1);
    expect((await tko_listActiveSessions(tko_subject))[0]?.tokenHash).toBe(tko_hashSessionToken(tko_first.sessionToken));

    await expect(sdk.authenticateRequest(tko_cookieRequest(tko_first.sessionToken))).resolves.toMatchObject({
      openId: tko_subject,
    });
    await expect(sdk.authenticateRequest(tko_cookieRequest(tko_second.sessionToken))).rejects.toThrow("Session is no longer active");
  });

  it("never tracks cron subjects", async () => {
    expect(tko_shouldTrackSubject("cron_daily-report")).toBe(false);
    expect(tko_shouldTrackSubject("email:abc")).toBe(true);
  });
});
