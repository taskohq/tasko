import { createHash, randomBytes } from "node:crypto";
import type { EmailPasswordAccount } from "../../../packages/database/src/email-password-store";
import { getEmailPasswordStore } from "../../../packages/database/src/email-password-store";
import { tko_logger } from "../../../packages/observability/src/logger";
import { getRedisAdapter } from "../../../packages/redis/src/redis-adapter";
import { ONE_YEAR_MS } from "../../../shared/const";
import { TKO_AUTH_AUDIT, tko_recordAuthAudit } from "./auth-audit";
import {
  buildEmailVerificationEmail,
  buildPasswordResetEmail,
  tko_authEmailProviderConfigured,
  tko_devTokenExposureAllowed,
  tko_emailVerificationUrl,
  tko_passwordResetUrl,
  tko_sendAuthEmail,
} from "./auth-email-service";
import { getAccountRecoveryStore } from "./account-recovery-store";
import { tko_passwordHash, tko_passwordPolicySatisfied, tko_verifyPassword } from "./password-crypto";
import { tko_revokeAllSessionsForSubject } from "./session-service";
import { sdk } from "../../../server/_core/sdk";
import { resolveTenantRequestContext } from "../../tenancy/src/tenant-context";

/**
 * Account recovery services (spec 06 §2 P1): self-service password reset and
 * email verification.
 *
 * Security invariants:
 *  - tokens are 256-bit random, stored only as SHA-256 hashes with expiry and
 *    single-use atomic consumption;
 *  - `requestPasswordReset` returns the SAME generic response whether or not
 *    the email exists — no account enumeration;
 *  - completing a reset revokes every active session of the account;
 *  - all token endpoints are rate limited (redis takeRateLimit);
 *  - when the email provider is unconfigured and NODE_ENV !== "production",
 *    the raw token is exposed to the caller behind an explicit `devOnly` flag
 *    (testability); never in production, never logged.
 */

const TKO_RESET_TOKEN_TTL_MS = 60 * 60_000; // 1 hour per spec
const TKO_VERIFICATION_TOKEN_TTL_MS = 24 * 60 * 60_000;
const TKO_RESET_REQUEST_LIMIT = 5;
const TKO_RESET_REQUEST_WINDOW_MS = 60 * 60_000;
const TKO_TOKEN_ATTEMPT_LIMIT = 20;
const TKO_TOKEN_ATTEMPT_WINDOW_MS = 15 * 60_000;
const TKO_RESEND_LIMIT = 3;
const TKO_RESEND_WINDOW_MS = 60 * 60_000;

export type TkoPasswordResetRequestResult = { success: true; devOnly?: { resetToken: string } };
export type TkoPasswordResetResult = { account: Pick<EmailPasswordAccount, "authSubject" | "email" | "displayName">; sessionToken: string };
export type TkoEmailVerificationResult = { verified: true; email: string | null };
export type TkoResendVerificationResult = { sent: boolean; alreadyVerified: boolean; devOnly?: { verificationToken: string } };

function tko_sha256Hex(tko_value: string): string {
  return createHash("sha256").update(tko_value).digest("hex");
}

function tko_normalizeEmail(tko_email: string): string {
  return tko_email.trim().toLowerCase();
}

async function tko_takeTokenRateLimit(tko_key: string, tko_limit: number, tko_windowMs: number): Promise<void> {
  const tko_result = await getRedisAdapter().takeRateLimit(tko_key, tko_limit, tko_windowMs);
  if (!tko_result.allowed) throw new Error("TASKO_AUTH_RATE_LIMITED");
}

/**
 * Absolute link when Resend is configured (TASKO_APP_ORIGIN is then required);
 * otherwise a relative developer-facing link — the raw token is surfaced via
 * the `devOnly` response flag, so flows stay testable without configuration.
 */
function tko_recoveryLink(tko_buildAbsolute: (tko_token: string) => string, tko_paramName: string, tko_token: string): string {
  if (tko_authEmailProviderConfigured()) return tko_buildAbsolute(tko_token);
  return `/login?${tko_paramName}=${encodeURIComponent(tko_token)}`;
}

async function tko_issueRecoveryToken(tko_input: { authSubject: string; ttlMs: number; kind: "password_reset" | "email_verification" }): Promise<string> {
  const tko_token = randomBytes(32).toString("base64url");
  const tko_store = getAccountRecoveryStore();
  if (tko_input.kind === "password_reset") {
    await tko_store.clearPendingPasswordResetTokens(tko_input.authSubject);
    await tko_store.createPasswordResetToken({ authSubject: tko_input.authSubject, tokenHash: tko_sha256Hex(tko_token), expiresAt: new Date(Date.now() + tko_input.ttlMs) });
  } else {
    await tko_store.clearPendingEmailVerificationTokens(tko_input.authSubject);
    await tko_store.createEmailVerificationToken({ authSubject: tko_input.authSubject, tokenHash: tko_sha256Hex(tko_token), expiresAt: new Date(Date.now() + tko_input.ttlMs) });
  }
  return tko_token;
}

/**
 * Request a password reset. Always resolves with the same generic response;
 * an email with a single-use 1h link is sent only when the account exists.
 */
export async function requestPasswordReset(tko_input: { email: string; correlationId: string }): Promise<TkoPasswordResetRequestResult> {
  const tko_email = tko_normalizeEmail(tko_input.email);
  await tko_takeTokenRateLimit(`auth:password-reset:${tko_sha256Hex(tko_email)}`, TKO_RESET_REQUEST_LIMIT, TKO_RESET_REQUEST_WINDOW_MS);
  const tko_account = await getEmailPasswordStore().getByEmail(tko_email);
  if (!tko_account) {
    await tko_recordAuthAudit({ audit: TKO_AUTH_AUDIT.passwordResetRequested, authSubject: null, resourceId: tko_sha256Hex(tko_email), correlationId: tko_input.correlationId, metadata: { outcome: "unknown_email" } });
    return { success: true };
  }
  const tko_token = await tko_issueRecoveryToken({ authSubject: tko_account.authSubject, ttlMs: TKO_RESET_TOKEN_TTL_MS, kind: "password_reset" });
  const tko_resetUrl = tko_recoveryLink(tko_passwordResetUrl, "resetToken", tko_token);
  const tko_emailBody = buildPasswordResetEmail({ resetUrl: tko_resetUrl, expiresAt: new Date(Date.now() + TKO_RESET_TOKEN_TTL_MS) });
  const tko_delivery = await tko_sendAuthEmail({ to: tko_account.email, subject: "Đặt lại mật khẩu Tasko", html: tko_emailBody.html, text: tko_emailBody.text, idempotencyKey: `password-reset:${tko_sha256Hex(tko_token)}` });
  await tko_recordAuthAudit({ audit: TKO_AUTH_AUDIT.passwordResetRequested, authSubject: tko_account.authSubject, resourceId: tko_account.authSubject, correlationId: tko_input.correlationId, metadata: { outcome: "issued", delivered: tko_delivery.delivered } });
  if (!tko_delivery.delivered && tko_devTokenExposureAllowed()) {
    return { success: true, devOnly: { resetToken: tko_token } };
  }
  return { success: true };
}

/**
 * Complete a password reset with a one-time token. Marks the token used
 * atomically, rehashes the password with the shared scrypt parameters, and
 * revokes every active session of the account. Then mints a fresh session so
 * the user lands logged-in.
 */
export async function resetPassword(tko_input: { token: string; newPassword: string; correlationId: string }): Promise<TkoPasswordResetResult> {
  if (!tko_passwordPolicySatisfied(tko_input.newPassword)) throw new Error("TASKO_PASSWORD_POLICY_FAILED");
  const tko_tokenHash = tko_sha256Hex(tko_input.token);
  await tko_takeTokenRateLimit(`auth:reset-consume:${tko_tokenHash}`, TKO_TOKEN_ATTEMPT_LIMIT, TKO_TOKEN_ATTEMPT_WINDOW_MS);
  const tko_consumed = await getAccountRecoveryStore().consumePasswordResetToken(tko_tokenHash);
  if (!tko_consumed) throw new Error("TASKO_RESET_TOKEN_INVALID");
  const tko_account = await getEmailPasswordStore().getByAuthSubject(tko_consumed.authSubject);
  if (!tko_account) throw new Error("TASKO_RESET_TOKEN_INVALID");
  await getEmailPasswordStore().updatePasswordHash(tko_account.authSubject, await tko_passwordHash(tko_input.newPassword));
  const tko_revokedSessions = await tko_revokeAllSessionsForSubject(tko_account.authSubject);
  await tko_recordAuthAudit({ audit: TKO_AUTH_AUDIT.passwordResetCompleted, authSubject: tko_account.authSubject, resourceId: tko_account.authSubject, correlationId: tko_input.correlationId, metadata: { revokedSessions: tko_revokedSessions } });
  const tko_context = await resolveTenantRequestContext({ authSubject: tko_account.authSubject, correlationId: tko_input.correlationId });
  if (!tko_context) throw new Error("TASKO_RESET_TOKEN_INVALID");
  const tko_sessionToken = await sdk.createSessionToken(tko_account.authSubject, { name: tko_account.displayName, expiresInMs: ONE_YEAR_MS, tenantId: tko_context.membership.tenant.id });
  return { account: { authSubject: tko_account.authSubject, email: tko_account.email, displayName: tko_account.displayName }, sessionToken: tko_sessionToken };
}

/** Called on signup (spec 06 §2 P1): issue + send a verification email. Never blocks signup. */
export async function issueEmailVerificationForSignup(tko_account: EmailPasswordAccount, tko_correlationId: string): Promise<void> {
  try {
    const tko_token = await tko_issueRecoveryToken({ authSubject: tko_account.authSubject, ttlMs: TKO_VERIFICATION_TOKEN_TTL_MS, kind: "email_verification" });
    const tko_verifyUrl = tko_recoveryLink(tko_emailVerificationUrl, "verifyToken", tko_token);
    const tko_emailBody = buildEmailVerificationEmail({ verifyUrl: tko_verifyUrl, expiresAt: new Date(Date.now() + TKO_VERIFICATION_TOKEN_TTL_MS) });
    await tko_sendAuthEmail({ to: tko_account.email, subject: "Xác thực email Tasko", html: tko_emailBody.html, text: tko_emailBody.text, idempotencyKey: `email-verification:${tko_sha256Hex(tko_token)}` });
  } catch (tko_error) {
    // Email verification must never break account creation.
    tko_logger.error({ authFlow: "email_verification", correlationId: tko_correlationId, error: String(tko_error) }, "signup verification email failed");
  }
}

/** Verify an email address with a one-time token. */
export async function verifyEmail(tko_input: { token: string; correlationId: string }): Promise<TkoEmailVerificationResult> {
  const tko_tokenHash = tko_sha256Hex(tko_input.token);
  await tko_takeTokenRateLimit(`auth:email-verify:${tko_tokenHash}`, TKO_TOKEN_ATTEMPT_LIMIT, TKO_TOKEN_ATTEMPT_WINDOW_MS);
  const tko_consumed = await getAccountRecoveryStore().consumeEmailVerificationToken(tko_tokenHash);
  if (!tko_consumed) throw new Error("TASKO_VERIFY_TOKEN_INVALID");
  const tko_account = await getEmailPasswordStore().getByAuthSubject(tko_consumed.authSubject);
  await tko_recordAuthAudit({ audit: TKO_AUTH_AUDIT.emailVerified, authSubject: tko_consumed.authSubject, resourceId: tko_consumed.authSubject, correlationId: tko_input.correlationId, metadata: { outcome: "verified" } });
  return { verified: true, email: tko_account?.email ?? null };
}

/** Authed resend of the verification email (rate limited per account). */
export async function resendVerificationEmail(tko_input: { authSubject: string; correlationId: string }): Promise<TkoResendVerificationResult> {
  const tko_account = await getEmailPasswordStore().getByAuthSubject(tko_input.authSubject);
  if (!tko_account) throw new Error("TASKO_AUTH_ACCOUNT_UNKNOWN");
  if (await getAccountRecoveryStore().isEmailVerified(tko_account.authSubject)) return { sent: false, alreadyVerified: true };
  await tko_takeTokenRateLimit(`auth:email-verify-resend:${tko_sha256Hex(tko_account.email)}`, TKO_RESEND_LIMIT, TKO_RESEND_WINDOW_MS);
  const tko_token = await tko_issueRecoveryToken({ authSubject: tko_account.authSubject, ttlMs: TKO_VERIFICATION_TOKEN_TTL_MS, kind: "email_verification" });
  const tko_verifyUrl = tko_recoveryLink(tko_emailVerificationUrl, "verifyToken", tko_token);
  const tko_emailBody = buildEmailVerificationEmail({ verifyUrl: tko_verifyUrl, expiresAt: new Date(Date.now() + TKO_VERIFICATION_TOKEN_TTL_MS) });
  const tko_delivery = await tko_sendAuthEmail({ to: tko_account.email, subject: "Xác thực email Tasko", html: tko_emailBody.html, text: tko_emailBody.text, idempotencyKey: `email-verification:${tko_sha256Hex(tko_token)}` });
  if (!tko_delivery.delivered && tko_devTokenExposureAllowed()) {
    return { sent: true, alreadyVerified: false, devOnly: { verificationToken: tko_token } };
  }
  return { sent: true, alreadyVerified: false };
}

export async function isEmailVerified(tko_authSubject: string): Promise<boolean> {
  return getAccountRecoveryStore().isEmailVerified(tko_authSubject);
}

/** Shared credential check for password-gated flows (MFA disable, change password). */
export async function tko_verifyCurrentPassword(tko_authSubject: string, tko_password: string): Promise<EmailPasswordAccount> {
  const tko_account = await getEmailPasswordStore().getByAuthSubject(tko_authSubject);
  if (!tko_account || !(await tko_verifyPassword(tko_password, tko_account.passwordHash))) throw new Error("TASKO_INVALID_CREDENTIALS");
  return tko_account;
}
