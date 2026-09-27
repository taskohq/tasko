import { COOKIE_NAME, ONE_YEAR_MS, OAUTH_STATE_COOKIE, decodeOAuthState } from "@shared/const";
import { parse as parseCookieHeader } from "cookie";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import * as db from "../db";
import { getSessionCookieOptions } from "./cookies";
import { sdk } from "./sdk";
import { getPlatformStore } from "../../packages/database/src/platform-store";
import { recordAuthenticationEvent } from "../../modules/audit/src/audit-service";
import { createPlatformActor } from "../../modules/tenancy/src/tenant-context";

function tko_headerValue(tko_raw: string | string[] | undefined): string | undefined {
  if (Array.isArray(tko_raw)) return tko_raw[0];
  return tko_raw;
}

function getQueryParam(req: FastifyRequest, key: string): string | undefined {
  const value = (req.query as Record<string, unknown> | null)?.[key];
  return typeof value === "string" ? value : undefined;
}

type TkoOAuthCallbackInput = {
  code?: string;
  state?: string;
  cookieHeader?: string;
};

type TkoOAuthCallbackValidation =
  | { ok: true; code: string; state: string }
  | { ok: false; status: 400 | 403; error: string };

type TkoOAuthCallbackDependencies = {
  exchangeCodeForToken: typeof sdk.exchangeCodeForToken;
  getUserInfo: typeof sdk.getUserInfo;
  createSessionToken: typeof sdk.createSessionToken;
  upsertUser: typeof db.upsertUser;
  listMemberships: ReturnType<typeof getPlatformStore>["listMemberships"];
  recordAuthenticationEvent: typeof recordAuthenticationEvent;
  getSessionCookieOptions: typeof getSessionCookieOptions;
  newRequestId: () => string;
};

const tko_defaultOAuthCallbackDependencies: TkoOAuthCallbackDependencies = {
  exchangeCodeForToken: (tko_code, tko_state) => sdk.exchangeCodeForToken(tko_code, tko_state),
  getUserInfo: tko_accessToken => sdk.getUserInfo(tko_accessToken),
  createSessionToken: (tko_openId, tko_options) => sdk.createSessionToken(tko_openId, tko_options),
  upsertUser: tko_input => db.upsertUser(tko_input),
  listMemberships: tko_openId => getPlatformStore().listMemberships(tko_openId),
  recordAuthenticationEvent,
  getSessionCookieOptions,
  newRequestId: () => crypto.randomUUID(),
};

/** Only accept the callback URL which the browser login action constructs. */
export function tko_isValidOAuthCallbackRedirectUri(tko_value: string): boolean {
  try {
    const tko_url = new URL(tko_value);
    const tko_isSecureOrigin =
      tko_url.protocol === "https:" ||
      (tko_url.protocol === "http:" && tko_url.hostname === "localhost");

    return (
      tko_isSecureOrigin &&
      tko_url.pathname === "/api/oauth/callback" &&
      !tko_url.search &&
      !tko_url.hash
    );
  } catch {
    return false;
  }
}

/**
 * Validate all untrusted callback input before invoking the OAuth service.
 * Keeping this pure makes the CSRF and redirect contract regression-testable.
 */
export function tko_validateOAuthCallbackInput(
  tko_input: TkoOAuthCallbackInput,
): TkoOAuthCallbackValidation {
  if (!tko_input.code || !tko_input.state) {
    return { ok: false, status: 400, error: "code and state are required" };
  }

  const tko_decodedState = decodeOAuthState(tko_input.state);
  const tko_expectedNonce = parseCookieHeader(tko_input.cookieHeader ?? "")[OAUTH_STATE_COOKIE];
  if (!tko_decodedState.nonce || tko_decodedState.nonce !== tko_expectedNonce) {
    return { ok: false, status: 403, error: "invalid oauth state" };
  }

  if (!tko_isValidOAuthCallbackRedirectUri(tko_decodedState.redirectUri)) {
    return { ok: false, status: 400, error: "invalid oauth redirect uri" };
  }

  return { ok: true, code: tko_input.code, state: tko_input.state };
}

function tko_isOAuthProviderNetworkError(tko_error: unknown): boolean {
  if (!tko_error || typeof tko_error !== "object") return false;
  const tko_code = (tko_error as { code?: unknown }).code;
  return tko_code === "ENOTFOUND" || tko_code === "ECONNREFUSED" || tko_code === "ETIMEDOUT";
}

/**
 * This handler is separated from route registration so callback behavior can be
 * tested with a mocked OAuth SDK without involving a real user login.
 */
export function tko_createOAuthCallbackHandler(
  tko_dependencies: TkoOAuthCallbackDependencies = tko_defaultOAuthCallbackDependencies,
) {
  return async (tko_req: FastifyRequest, tko_reply: FastifyReply) => {
    const tko_validation = tko_validateOAuthCallbackInput({
      code: getQueryParam(tko_req, "code"),
      state: getQueryParam(tko_req, "state"),
      cookieHeader: tko_req.headers.cookie,
    });
    if (!tko_validation.ok) {
      void tko_reply.code(tko_validation.status).send({ error: tko_validation.error });
      return;
    }
    void tko_reply.clearCookie(OAUTH_STATE_COOKIE, { path: "/", secure: true, sameSite: "none" });

    try {
      const tko_tokenResponse = await tko_dependencies.exchangeCodeForToken(tko_validation.code, tko_validation.state);
      const tko_userInfo = await tko_dependencies.getUserInfo(tko_tokenResponse.accessToken);

      if (!tko_userInfo.openId) {
        void tko_reply.code(400).send({ error: "openId missing from user info" });
        return;
      }

      await tko_dependencies.upsertUser({
        openId: tko_userInfo.openId,
        name: tko_userInfo.name || null,
        email: tko_userInfo.email ?? null,
        loginMethod: tko_userInfo.loginMethod ?? tko_userInfo.platform ?? null,
        lastSignedIn: new Date(),
      });

      const tko_requestId = tko_headerValue(tko_req.headers["x-request-id"]);
      const tko_memberships = await tko_dependencies.listMemberships(tko_userInfo.openId);
      await Promise.all(
        tko_memberships.map(tko_membership =>
          tko_dependencies.recordAuthenticationEvent({
            actor: createPlatformActor(tko_membership, tko_requestId ?? undefined),
            action: "login",
            correlationId: tko_requestId ?? tko_dependencies.newRequestId(),
            metadata: { loginMethod: tko_userInfo.loginMethod ?? tko_userInfo.platform ?? "oauth" },
          }),
        ),
      );

      const tko_sessionToken = await tko_dependencies.createSessionToken(tko_userInfo.openId, {
        name: tko_userInfo.name || "",
        expiresInMs: ONE_YEAR_MS,
      });

      const tko_cookieOptions = tko_dependencies.getSessionCookieOptions(tko_req);
      void tko_reply.setCookie(COOKIE_NAME, tko_sessionToken, { ...tko_cookieOptions, maxAge: ONE_YEAR_MS });
      void tko_reply.code(302).redirect("/");
    } catch (tko_error) {
      const tko_providerNetworkError = tko_isOAuthProviderNetworkError(tko_error);
      const tko_errorDetails = tko_error as { code?: unknown; hostname?: unknown; message?: unknown };
      console.error("[OAuth] Callback failed", {
        code: tko_errorDetails?.code,
        hostname: tko_errorDetails?.hostname,
        message: tko_errorDetails?.message,
      });
      void tko_reply.code(tko_providerNetworkError ? 502 : 500).send({
        error: tko_providerNetworkError ? "OAuth provider unavailable" : "OAuth callback failed",
      });
    }
  };
}

export function registerOAuthRoutes(tko_fastify: FastifyInstance) {
  tko_fastify.get("/api/oauth/callback", tko_createOAuthCallbackHandler());
}
