import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import type { TrpcContext } from "./context";
import { getSessionCookieOptions } from "./cookies";

/**
 * Framework-stable session cookie helpers for tRPC procedures.
 *
 * Procedures must NOT touch `ctx.res` (raw FastifyReply) directly. The HTTP
 * transport lives only here — procedure call sites stay identical if the
 * framework ever changes again.
 */
export function setSessionCookie(tko_ctx: TrpcContext, tko_sessionToken: string) {
  void tko_ctx.res.setCookie(COOKIE_NAME, tko_sessionToken, {
    ...getSessionCookieOptions(tko_ctx.req),
    maxAge: ONE_YEAR_MS,
  });
}

export function clearSessionCookie(tko_ctx: TrpcContext) {
  void tko_ctx.res.clearCookie(COOKIE_NAME, {
    ...getSessionCookieOptions(tko_ctx.req),
    maxAge: -1,
  });
}
