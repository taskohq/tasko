import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MemoryEmailPasswordStore, setEmailPasswordStoreForTests } from "../../packages/database/src/email-password-store";
import { MemoryPlatformStore, setPlatformStoreForTests } from "../../packages/database/src/platform-store";
import { createInMemoryRedisAdapter, setRedisAdapterForTests } from "../../packages/redis/src/redis-adapter";
import { signInWithEmailPassword, signUpWithEmailPassword } from "./src/email-password-service";
import { sdk } from "../../server/_core/sdk";

describe("email/password authentication", () => {
  beforeEach(() => {
    setEmailPasswordStoreForTests(new MemoryEmailPasswordStore());
    setPlatformStoreForTests(new MemoryPlatformStore());
    setRedisAdapterForTests(createInMemoryRedisAdapter());
  });
  afterEach(() => {
    setEmailPasswordStoreForTests(null);
    setPlatformStoreForTests(null);
    setRedisAdapterForTests(null);
  });

  it("creates a KDF credential, provisions an owner workspace and issues a compatible session", async () => {
    const tko_result = await signUpWithEmailPassword({ email: "Owner@Example.com", password: "a secure password 123", displayName: "Owner", correlationId: "test-signup" });
    expect(tko_result.account.email).toBe("owner@example.com");
    expect(tko_result.account.authSubject).toMatch(/^email:/);
    const tko_store = await import("../../packages/database/src/email-password-store");
    const tko_account = await tko_store.getEmailPasswordStore().getByEmail("owner@example.com");
    expect(tko_account?.passwordHash).toMatch(/^scrypt\$16384\$8\$1\$/);
    expect(tko_account?.passwordHash).not.toContain("a secure password 123");
    expect(await sdk.verifySession(tko_result.sessionToken)).toMatchObject({ openId: tko_result.account.authSubject, name: "Owner" });
    const tko_platform = await import("../../packages/database/src/platform-store");
    expect(await tko_platform.getPlatformStore().listMemberships(tko_result.account.authSubject)).toHaveLength(1);
    expect((await tko_platform.getPlatformStore().listOutbox()).some(tko_event => tko_event.eventType === "auth.login.v1")).toBe(true);
  });

  it("authenticates the correct password and refuses an invalid password with a generic error", async () => {
    await signUpWithEmailPassword({ email: "member@example.com", password: "a secure password 123", displayName: "Member", correlationId: "test-member" });
    await expect(signInWithEmailPassword({ email: "member@example.com", password: "a secure password 123", correlationId: "test-login" })).resolves.toMatchObject({ account: { email: "member@example.com" } });
    await expect(signInWithEmailPassword({ email: "member@example.com", password: "wrong password", correlationId: "test-invalid" })).rejects.toThrow("TASKO_INVALID_CREDENTIALS");
    await expect(signInWithEmailPassword({ email: "missing@example.com", password: "wrong password", correlationId: "test-missing" })).rejects.toThrow("TASKO_INVALID_CREDENTIALS");
  });

  it("rate limits repeated sign-in attempts by normalized email", async () => {
    for (let tko_attempt = 0; tko_attempt < 8; tko_attempt += 1) {
      await expect(signInWithEmailPassword({ email: "throttle@example.com", password: "wrong password", correlationId: `test-${tko_attempt}` })).rejects.toThrow("TASKO_INVALID_CREDENTIALS");
    }
    await expect(signInWithEmailPassword({ email: "THROTTLE@example.com", password: "wrong password", correlationId: "test-throttled" })).rejects.toThrow("TASKO_AUTH_RATE_LIMITED");
  });
});
