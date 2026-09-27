import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse as parseCookie } from "cookie";
import { appRouter } from "./routers";
import { COOKIE_NAME } from "../shared/const";
import type { TrpcContext } from "./_core/context";
import { tko_extractSessionTokenFromHeaders, tko_shouldRevokeSessionForRequest } from "./_core/security";
import { tko_hashSessionToken, tko_revokeSessionByToken } from "../modules/auth/src/session-service";
import { sdk } from "./_core/sdk";
import { MemoryEmailPasswordStore, setEmailPasswordStoreForTests } from "../packages/database/src/email-password-store";
import { MemoryPlatformStore, setPlatformStoreForTests } from "../packages/database/src/platform-store";
import { MemorySessionStore, getSessionStore, setSessionStoreForTests } from "../packages/database/src/session-store";
import { createInMemoryRedisAdapter, setRedisAdapterForTests } from "../packages/redis/src/redis-adapter";
import { signUpWithEmailPassword } from "../modules/auth/src/email-password-service";

type CookieCall = {
  name: string;
  options: Record<string, unknown>;
};

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createAuthContext(): { ctx: TrpcContext; clearedCookies: CookieCall[] } {
  const clearedCookies: CookieCall[] = [];

  const user: AuthenticatedUser = {
    id: 1,
    openId: "sample-user",
    email: "sample@example.com",
    name: "Sample User",
    loginMethod: "manus",
    role: "user",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };

  const ctx: TrpcContext = {
    user,
    platform: null,
    correlationId: "test-correlation-id",
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: (name: string, options: Record<string, unknown>) => {
        clearedCookies.push({ name, options });
      },
    } as TrpcContext["res"],
  };

  return { ctx, clearedCookies };
}

describe("auth.logout", () => {
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

  it("clears the session cookie (sameSite lax) and reports success", async () => {
    const { ctx, clearedCookies } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.auth.logout();

    expect(result).toEqual({ success: true });
    expect(clearedCookies).toHaveLength(1);
    expect(clearedCookies[0]?.name).toBe(COOKIE_NAME);
    expect(clearedCookies[0]?.options).toMatchObject({
      maxAge: -1,
      secure: true,
      sameSite: "lax",
      httpOnly: true,
      path: "/",
    });
  });

  it("flags the logout tRPC procedure as a session-revocation request", () => {
    expect(tko_shouldRevokeSessionForRequest({ method: "POST", path: "/auth.logout" })).toBe(true);
    expect(tko_shouldRevokeSessionForRequest({ method: "POST", path: "/auth.logout,auth.me" })).toBe(true);
    expect(tko_shouldRevokeSessionForRequest({ method: "GET", path: "/auth.logout" })).toBe(false);
    expect(tko_shouldRevokeSessionForRequest({ method: "POST", path: "/auth.me" })).toBe(false);
  });

  it("revokes the presented session row so the cookie stops authenticating", async () => {
    // Mirror of the express interceptor wired in server/_core/index.ts: match
    // the logout procedure, extract the presented token, revoke its row.
    const tko_signup = await signUpWithEmailPassword({
      email: "logout@example.com",
      password: "a secure password 123",
      displayName: "Logout Tester",
      correlationId: "test-logout",
    });
    const tko_cookieHeader = `${COOKIE_NAME}=${tko_signup.sessionToken}`;
    expect((await sdk.authenticateRequest({ headers: { cookie: tko_cookieHeader } } as never)).openId).toBe(
      tko_signup.account.authSubject,
    );

    expect(tko_shouldRevokeSessionForRequest({ method: "POST", path: "/auth.logout" })).toBe(true);
    const tko_token = tko_extractSessionTokenFromHeaders({
      cookieHeader: tko_cookieHeader,
      authorizationHeader: undefined,
      parseCookie: tko_header => parseCookie(tko_header),
    });
    expect(tko_token).toBe(tko_signup.sessionToken);
    await tko_revokeSessionByToken(tko_token as string);

    await expect(sdk.authenticateRequest({ headers: { cookie: tko_cookieHeader } } as never)).rejects.toThrow(
      "Session is no longer active",
    );
    expect(await getSessionStore().findByTokenHash(tko_hashSessionToken(tko_signup.sessionToken))).toMatchObject({
      authSubject: tko_signup.account.authSubject,
      revokedAt: expect.any(Date),
    });
  });
});
