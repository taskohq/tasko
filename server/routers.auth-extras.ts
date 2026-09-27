import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { parse as parseCookie } from "cookie";
import { COOKIE_NAME } from "@shared/const";
import { publicProcedure, protectedProcedure } from "./_core/trpc";
import { setSessionCookie } from "./_core/session-cookies";
import type { TrpcContext } from "./_core/context";
import { tko_isEmailPasswordSubject, changeEmailPassword } from "../modules/auth/src/email-password-service";
import {
  requestPasswordReset,
  resetPassword,
  resendVerificationEmail,
  verifyEmail,
} from "../modules/auth/src/account-recovery-service";
import {
  confirmEnrollment,
  disableMfa,
  mfaStatus,
  mfaVerifyLogin,
  startEnrollment,
} from "../modules/auth/src/mfa-service";
import type {
  TkoMfaChallengeOutcome,
  TkoSignInResult,
} from "../modules/auth/src/email-password-service";

/**
 * Account-recovery + MFA extras (spec 06 §2 P1). Kept out of server/routers.ts
 * so it can be merged without collisions — the orchestrator spreads
 * `tkoAuthExtraProcedures` into the `auth:` section:
 *
 *   auth: router({ ...tkoAuthExtraProcedures, me, signUpWithEmailPassword, signInWithEmailPassword, logout })
 *
 * SUPERSEDED base procedures (the orchestrator must DROP these from the base
 * `auth:` section when spreading):
 *  - `me` — this file exports an additive superset that appends `emailVerified`
 *    (boolean for email/password accounts, null otherwise) to the existing user
 *    shape; existing consumers are unaffected.
 *  - `signInWithEmailPassword` — the base procedure is replaced wholesale by
 *    `signInWithEmailPasswordExtra` below, which preserves the exact current
 *    response shape `{ account: { email, displayName } }` for non-MFA accounts
 *    and adds the `{ mfaRequired: true, challengeToken }` outcome for MFA
 *    accounts (never mints/sets a cookie in that case).
 *
 * Cookie writes go ONLY through the session-cookies helpers.
 */

function tko_currentSessionToken(tko_ctx: TrpcContext): string | null {
  const tko_fromCookie = parseCookie(tko_ctx.req.headers.cookie ?? "")[COOKIE_NAME];
  if (tko_fromCookie) return tko_fromCookie;
  const tko_authorization = tko_ctx.req.headers.authorization;
  return tko_authorization?.startsWith("Bearer ") ? tko_authorization.slice(7) || null : null;
}

function tko_mapAuthError(tko_error: unknown, tko_fallbackMessage: string): TRPCError {
  const tko_code = tko_error instanceof Error ? tko_error.message : "";
  if (tko_code === "TASKO_AUTH_RATE_LIMITED") return new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Please wait before trying again." });
  if (tko_code === "TASKO_PASSWORD_POLICY_FAILED") return new TRPCError({ code: "BAD_REQUEST", message: "Password does not meet the security requirements." });
  if (tko_code === "TASKO_RESET_TOKEN_INVALID") return new TRPCError({ code: "BAD_REQUEST", message: "This password reset link is invalid or has expired." });
  if (tko_code === "TASKO_VERIFY_TOKEN_INVALID") return new TRPCError({ code: "BAD_REQUEST", message: "This email verification link is invalid or has expired." });
  if (tko_code === "TASKO_INVALID_CREDENTIALS") return new TRPCError({ code: "UNAUTHORIZED", message: "Invalid email or password." });
  if (tko_code === "TASKO_MFA_CHALLENGE_INVALID") return new TRPCError({ code: "UNAUTHORIZED", message: "Your sign-in session expired. Please sign in again." });
  if (tko_code === "TASKO_MFA_CODE_INVALID") return new TRPCError({ code: "UNAUTHORIZED", message: "That code is not valid." });
  if (tko_code === "TASKO_MFA_ALREADY_ENABLED") return new TRPCError({ code: "CONFLICT", message: "Two-factor authentication is already enabled." });
  if (tko_code === "TASKO_MFA_NOT_ENABLED") return new TRPCError({ code: "CONFLICT", message: "Two-factor authentication is not enabled." });
  if (tko_code === "TASKO_MFA_ENROLLMENT_NOT_STARTED") return new TRPCError({ code: "BAD_REQUEST", message: "Start two-factor enrollment first." });
  if (tko_code === "TASKO_AUTH_ACCOUNT_UNKNOWN") return new TRPCError({ code: "NOT_FOUND", message: "This account does not use email and password." });
  if (tko_code === "TASKO_EMAIL_APP_ORIGIN_REQUIRED") return new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "TASKO_APP_ORIGIN must be configured to send auth emails." });
  return new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: tko_fallbackMessage });
}

const tko_emailInput = z.object({ email: z.string().email().max(254) });

export const tkoAuthExtraProcedures = {
  /**
   * SUPERSEDES base `auth.me`: identical user payload plus an additive
   * `emailVerified` field (boolean for email/password accounts, null for
   * OAuth/cron principals). Existing consumers keep working unchanged.
   */
  me: publicProcedure.query(async ({ ctx }) => {
    if (!ctx.user) return null;
    const tko_emailVerified = tko_isEmailPasswordSubject(ctx.user.openId) ? await import("../modules/auth/src/account-recovery-service").then(({ isEmailVerified }) => isEmailVerified(ctx.user!.openId)) : null;
    return { ...ctx.user, emailVerified: tko_emailVerified };
  }),

  // --- Password reset (public) ---------------------------------------------
  requestPasswordReset: publicProcedure
    .input(tko_emailInput)
    .mutation(async ({ input }) => {
      try {
        // Same generic response whether or not the account exists.
        return await requestPasswordReset({ email: input.email, correlationId: "public" });
      } catch (tko_error) {
        throw tko_mapAuthError(tko_error, "Unable to process the request.");
      }
    }),
  resetPassword: publicProcedure
    .input(z.object({ token: z.string().min(16).max(200), newPassword: z.string().min(12).max(128) }))
    .mutation(async ({ ctx, input }) => {
      try {
        const tko_result = await resetPassword({ token: input.token, newPassword: input.newPassword, correlationId: ctx.correlationId });
        setSessionCookie(ctx, tko_result.sessionToken); // user lands logged-in
        return { account: { email: tko_result.account.email, displayName: tko_result.account.displayName } };
      } catch (tko_error) {
        throw tko_mapAuthError(tko_error, "Unable to reset the password.");
      }
    }),

  // --- Email verification ----------------------------------------------------
  verifyEmail: publicProcedure
    .input(z.object({ token: z.string().min(16).max(200) }))
    .mutation(async ({ input }) => {
      try {
        return await verifyEmail({ token: input.token, correlationId: "public" });
      } catch (tko_error) {
        throw tko_mapAuthError(tko_error, "Unable to verify the email.");
      }
    }),
  resendVerificationEmail: protectedProcedure.mutation(async ({ ctx }) => {
    try {
      return await resendVerificationEmail({ authSubject: ctx.user.openId, correlationId: ctx.correlationId });
    } catch (tko_error) {
      throw tko_mapAuthError(tko_error, "Unable to resend the verification email.");
    }
  }),

  // --- Password change (authed) ----------------------------------------------
  changePassword: protectedProcedure
    .input(z.object({ currentPassword: z.string().min(1).max(128), newPassword: z.string().min(12).max(128) }))
    .mutation(async ({ ctx, input }) => {
      try {
        await changeEmailPassword({ authSubject: ctx.user.openId, currentPassword: input.currentPassword, newPassword: input.newPassword, currentSessionToken: tko_currentSessionToken(ctx), correlationId: ctx.correlationId });
        return { success: true } as const;
      } catch (tko_error) {
        throw tko_mapAuthError(tko_error, "Unable to change the password.");
      }
    }),

  // --- TOTP MFA ---------------------------------------------------------------
  mfaStatus: protectedProcedure.query(({ ctx }) => mfaStatus(ctx.user.openId)),
  mfaStartEnrollment: protectedProcedure.mutation(async ({ ctx }) => {
    try {
      const tko_account = await import("../modules/auth/src/email-password-service").then(({ getEmailPasswordAccount }) => getEmailPasswordAccount(ctx.user.openId));
      if (!tko_account) throw new TRPCError({ code: "NOT_FOUND", message: "This account does not use email and password." });
      return await startEnrollment({ authSubject: ctx.user.openId, accountEmail: tko_account.email, correlationId: ctx.correlationId });
    } catch (tko_error) {
      if (tko_error instanceof TRPCError) throw tko_error;
      throw tko_mapAuthError(tko_error, "Unable to start two-factor enrollment.");
    }
  }),
  mfaConfirmEnrollment: protectedProcedure
    .input(z.object({ code: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code from your authenticator app.") }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await confirmEnrollment({ authSubject: ctx.user.openId, code: input.code, correlationId: ctx.correlationId });
      } catch (tko_error) {
        throw tko_mapAuthError(tko_error, "Unable to confirm two-factor enrollment.");
      }
    }),
  mfaDisable: protectedProcedure
    .input(z.object({ password: z.string().min(1).max(128) }))
    .mutation(async ({ ctx, input }) => {
      try {
        await disableMfa({ authSubject: ctx.user.openId, password: input.password, correlationId: ctx.correlationId });
        return { success: true } as const;
      } catch (tko_error) {
        throw tko_mapAuthError(tko_error, "Unable to disable two-factor authentication.");
      }
    }),

  /**
   * SUPERSEDES base `auth.signInWithEmailPassword` (same procedure name — the
   * orchestrator drops the base one when spreading): a full superset. Non-MFA
   * accounts get the exact historical response (`{ account: { email,
   * displayName } }` + session cookie). MFA accounts get
   * `{ mfaRequired: true, challengeToken }` with NO cookie — the client then
   * calls `mfaVerifyLogin` with the code to land logged-in.
   */
  signInWithEmailPassword: publicProcedure
    .input(z.object({ email: z.string().email().max(254), password: z.string().min(1).max(128) }))
    .mutation(async ({ ctx, input }) => {
      const { signInWithEmailPassword } = await import("../modules/auth/src/email-password-service");
      let tko_result: TkoSignInResult;
      try {
        tko_result = await signInWithEmailPassword({ ...input, correlationId: ctx.correlationId });
      } catch (tko_error) {
        const tko_code = tko_error instanceof Error ? tko_error.message : "";
        if (tko_code === "TASKO_AUTH_RATE_LIMITED") throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Please wait before trying again." });
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid email or password." });
      }
      if ((tko_result as TkoMfaChallengeOutcome).mfaRequired) {
        const tko_challenge = tko_result as TkoMfaChallengeOutcome;
        return { mfaRequired: true as const, challengeToken: tko_challenge.challengeToken };
      }
      setSessionCookie(ctx, (tko_result as Exclude<TkoSignInResult, TkoMfaChallengeOutcome>).sessionToken);
      return { account: { email: (tko_result as Exclude<TkoSignInResult, TkoMfaChallengeOutcome>).account.email, displayName: (tko_result as Exclude<TkoSignInResult, TkoMfaChallengeOutcome>).account.displayName } };
    }),

  /** Exchanges a challenge token + TOTP/recovery code for a real session. */
  mfaVerifyLogin: publicProcedure
    .input(z.object({ challengeToken: z.string().min(20).max(2_000), code: z.string().trim().min(6).max(40) }))
    .mutation(async ({ ctx, input }) => {
      try {
        const tko_result = await mfaVerifyLogin({ challengeToken: input.challengeToken, code: input.code, correlationId: ctx.correlationId });
        setSessionCookie(ctx, tko_result.sessionToken);
        return { account: { email: tko_result.account.email, displayName: tko_result.account.displayName } };
      } catch (tko_error) {
        throw tko_mapAuthError(tko_error, "Unable to verify the sign-in code.");
      }
    }),
};
