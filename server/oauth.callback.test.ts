import { describe, expect, it, vi } from "vitest";
import { COOKIE_NAME, encodeOAuthState, OAUTH_STATE_COOKIE } from "@shared/const";
import {
  tko_createOAuthCallbackHandler,
  tko_isValidOAuthCallbackRedirectUri,
  tko_validateOAuthCallbackInput,
} from "./_core/oauth";
import { tko_requireOAuthServerUrl } from "./_core/sdk";

const tko_nonce = "oauth-nonce-for-test";
const tko_cookieHeader = `${OAUTH_STATE_COOKIE}=${tko_nonce}`;
const tko_validState = encodeOAuthState({
  redirectUri: "https://tasko.manus.space/api/oauth/callback",
  nonce: tko_nonce,
});

function tko_mockResponse() {
  return {
    statusCode: 200,
    body: undefined as unknown,
    cookies: [] as Array<{ name: string; value: string; options: Record<string, unknown> }>,
    cleared: [] as string[],
    redirectTarget: undefined as string | undefined,
    status(tko_status: number) {
      this.statusCode = tko_status;
      return this;
    },
    json(tko_body: unknown) {
      this.body = tko_body;
      return this;
    },
    cookie(tko_name: string, tko_value: string, tko_options: Record<string, unknown>) {
      this.cookies.push({ name: tko_name, value: tko_value, options: tko_options });
      return this;
    },
    clearCookie(tko_name: string) {
      this.cleared.push(tko_name);
      return this;
    },
    redirect(tko_status: number, tko_target: string) {
      this.statusCode = tko_status;
      this.redirectTarget = tko_target;
      return this;
    },
  };
}

function tko_mockRequest() {
  return {
    query: { code: "authorization-code", state: tko_validState },
    headers: { cookie: tko_cookieHeader },
    header: () => undefined,
  };
}

describe("OAuth callback contracts", () => {
  it("accepts a browser-bound callback whose redirect URI matches the app callback", () => {
    expect(
      tko_validateOAuthCallbackInput({
        code: "authorization-code",
        state: tko_validState,
        cookieHeader: tko_cookieHeader,
      }),
    ).toEqual({ ok: true, code: "authorization-code", state: tko_validState });
  });

  it("fails closed before exchange for missing state, a nonce mismatch, or an unsafe redirect", () => {
    expect(tko_validateOAuthCallbackInput({ state: tko_validState })).toEqual({
      ok: false,
      status: 400,
      error: "code and state are required",
    });
    expect(
      tko_validateOAuthCallbackInput({
        code: "authorization-code",
        state: tko_validState,
        cookieHeader: `${OAUTH_STATE_COOKIE}=attacker-nonce`,
      }),
    ).toEqual({ ok: false, status: 403, error: "invalid oauth state" });

    const tko_unsafeState = encodeOAuthState({
      redirectUri: "https://attacker.invalid/callback",
      nonce: tko_nonce,
    });
    expect(
      tko_validateOAuthCallbackInput({
        code: "authorization-code",
        state: tko_unsafeState,
        cookieHeader: tko_cookieHeader,
      }),
    ).toEqual({ ok: false, status: 400, error: "invalid oauth redirect uri" });
  });

  it("allows only known callback shapes and rejects malformed OAuth server configuration", () => {
    expect(tko_isValidOAuthCallbackRedirectUri("http://localhost:3000/api/oauth/callback")).toBe(true);
    expect(tko_isValidOAuthCallbackRedirectUri("https://tasko.manus.space/api/oauth/callback?next=/")).toBe(false);
    expect(tko_requireOAuthServerUrl("https://api.manus.im/")).toBe("https://api.manus.im");
    expect(() => tko_requireOAuthServerUrl("base")).toThrow("absolute HTTP(S) URL");
    expect(() => tko_requireOAuthServerUrl("https://base")).toThrow("valid OAuth server host");
  });

  it("sets a session cookie and redirects after a valid mocked provider exchange", async () => {
    const tko_res = tko_mockResponse();
    const tko_handler = tko_createOAuthCallbackHandler({
      exchangeCodeForToken: vi.fn().mockResolvedValue({ accessToken: "access-token" }) as never,
      getUserInfo: vi.fn().mockResolvedValue({ openId: "open-id", name: "Tasko User", email: null, platform: "google" }) as never,
      createSessionToken: vi.fn().mockResolvedValue("session-token") as never,
      upsertUser: vi.fn().mockResolvedValue(undefined) as never,
      listMemberships: vi.fn().mockResolvedValue([]) as never,
      recordAuthenticationEvent: vi.fn().mockResolvedValue(undefined) as never,
      getSessionCookieOptions: vi.fn().mockReturnValue({ httpOnly: true, secure: true }) as never,
      newRequestId: () => "request-id",
    });

    await tko_handler(tko_mockRequest() as never, tko_res as never);

    expect(tko_res.statusCode).toBe(302);
    expect(tko_res.redirectTarget).toBe("/");
    expect(tko_res.cleared).toContain(OAUTH_STATE_COOKIE);
    expect(tko_res.cookies).toEqual([
      expect.objectContaining({ name: COOKIE_NAME, value: "session-token", options: expect.objectContaining({ httpOnly: true }) }),
    ]);
  });

  it("returns a generic 502 for a DNS provider failure after valid state validation", async () => {
    const tko_res = tko_mockResponse();
    const tko_dnsError = Object.assign(new Error("getaddrinfo ENOTFOUND base"), {
      code: "ENOTFOUND",
      hostname: "base",
    });
    const tko_handler = tko_createOAuthCallbackHandler({
      exchangeCodeForToken: vi.fn().mockRejectedValue(tko_dnsError) as never,
      getUserInfo: vi.fn() as never,
      createSessionToken: vi.fn() as never,
      upsertUser: vi.fn() as never,
      listMemberships: vi.fn() as never,
      recordAuthenticationEvent: vi.fn() as never,
      getSessionCookieOptions: vi.fn() as never,
      newRequestId: () => "request-id",
    });

    await tko_handler(tko_mockRequest() as never, tko_res as never);

    expect(tko_res.statusCode).toBe(502);
    expect(tko_res.body).toEqual({ error: "OAuth provider unavailable" });
    expect(JSON.stringify(tko_res.body)).not.toContain("base");
  });
});
