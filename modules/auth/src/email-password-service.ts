import { createHash, randomUUID } from "node:crypto";
import { getEmailPasswordStore, type EmailPasswordAccount } from "../../../packages/database/src/email-password-store";
import { getPlatformStore } from "../../../packages/database/src/platform-store";
import { getRedisAdapter } from "../../../packages/redis/src/redis-adapter";
import { recordAuthenticationEvent } from "../../audit/src/audit-service";
import { createPlatformActor, resolveTenantRequestContext } from "../../tenancy/src/tenant-context";
import { sdk } from "../../../server/_core/sdk";
import { ONE_YEAR_MS } from "../../../shared/const";
import { tko_hashSessionToken, tko_revokeAllSessionsForSubject } from "./session-service";
import { tko_passwordHash, tko_passwordPolicySatisfied, tko_verifyPassword } from "./password-crypto";
import { issueEmailVerificationForSignup, tko_verifyCurrentPassword } from "./account-recovery-service";
import { tko_issueLoginChallenge, tko_mfaLoginRequired } from "./mfa-service";
import { TKO_AUTH_AUDIT, tko_recordAuthAudit } from "./auth-audit";

/**
 * Email/password credential service (spec 06 §2 P1).
 *
 * Backward compatible: for accounts without TOTP MFA, `signInWithEmailPassword`
 * returns exactly the historical `EmailPasswordAuthResult`. When MFA is
 * enabled it instead returns `{ mfaRequired: true, challengeToken }` and does
 * NOT mint a session — `mfaVerifyLogin` exchanges the challenge for a session.
 */

const TKO_EMAIL_SUBJECT_PREFIX = "email:";

export type EmailPasswordAuthResult = { account: Pick<EmailPasswordAccount, "authSubject" | "email" | "displayName">; sessionToken: string };
export type TkoMfaChallengeOutcome = { mfaRequired: true; challengeToken: string };
export type TkoSignInResult = EmailPasswordAuthResult | TkoMfaChallengeOutcome;

function tko_normalizeEmail(tko_email: string): string { return tko_email.trim().toLowerCase(); }
function tko_emailKey(tko_email: string): string { return createHash("sha256").update(tko_email).digest("hex"); }
function tko_workspaceSlug(tko_email: string): string { const tko_base = tko_email.split("@")[0]?.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "workspace"; return `${tko_base.slice(0, 28)}-${randomUUID().slice(0, 8)}`; }
async function tko_takeCredentialRateLimit(tko_action: "login" | "signup", tko_email: string): Promise<void> { const tko_result = await getRedisAdapter().takeRateLimit(`auth:${tko_action}:${tko_emailKey(tko_email)}`, tko_action === "login" ? 8 : 4, 15 * 60_000); if (!tko_result.allowed) throw new Error("TASKO_AUTH_RATE_LIMITED"); }

export function tko_isEmailPasswordSubject(tko_authSubject: string): boolean { return tko_authSubject.startsWith(TKO_EMAIL_SUBJECT_PREFIX); }
export async function getEmailPasswordAccount(tko_authSubject: string): Promise<EmailPasswordAccount | null> { return tko_isEmailPasswordSubject(tko_authSubject) ? getEmailPasswordStore().getByAuthSubject(tko_authSubject) : null; }

export async function signUpWithEmailPassword(tko_input: { email: string; password: string; displayName: string; workspaceName?: string; correlationId: string }): Promise<EmailPasswordAuthResult> {
  const tko_email = tko_normalizeEmail(tko_input.email);
  if (!tko_passwordPolicySatisfied(tko_input.password)) throw new Error("TASKO_PASSWORD_POLICY_FAILED");
  await tko_takeCredentialRateLimit("signup", tko_email);
  const tko_authSubject = `${TKO_EMAIL_SUBJECT_PREFIX}${randomUUID()}`;
  const tko_account = await getEmailPasswordStore().create({ authSubject: tko_authSubject, email: tko_email, displayName: tko_input.displayName.trim(), passwordHash: await tko_passwordHash(tko_input.password) });
  let tko_provisioned: { tenant: { id: string } };
  try {
    tko_provisioned = await getPlatformStore().provisionTenant({ name: tko_input.workspaceName?.trim() || `${tko_account.displayName}'s Workspace`, slug: tko_workspaceSlug(tko_email), ownerAuthSubject: tko_authSubject, ownerDisplayName: tko_account.displayName, planKey: "starter", idempotencyKey: `email-signup:${tko_authSubject}`, correlationId: tko_input.correlationId });
  } catch (tko_error) { await getEmailPasswordStore().delete(tko_authSubject); throw tko_error; }
  const tko_membership = (await getPlatformStore().listMemberships(tko_authSubject)).find(tko_item => tko_item.tenant.id === tko_provisioned.tenant.id && tko_item.status === "active");
  if (!tko_membership) throw new Error("TASKO_SIGNUP_TENANT_MISSING");
  await recordAuthenticationEvent({ actor: createPlatformActor(tko_membership, tko_input.correlationId), action: "login", correlationId: tko_input.correlationId, metadata: { loginMethod: "email_password", enrollment: "signup" } });
  // Spec 06 §2 P1: every signup gets a verification email. Never blocks signup.
  await issueEmailVerificationForSignup(tko_account, tko_input.correlationId);
  return { account: tko_account, sessionToken: await sdk.createSessionToken(tko_authSubject, { name: tko_account.displayName, expiresInMs: ONE_YEAR_MS, tenantId: tko_provisioned.tenant.id }) };
}

export async function signInWithEmailPassword(tko_input: { email: string; password: string; correlationId: string }): Promise<TkoSignInResult> {
  const tko_email = tko_normalizeEmail(tko_input.email); await tko_takeCredentialRateLimit("login", tko_email);
  const tko_account = await getEmailPasswordStore().getByEmail(tko_email);
  if (!tko_account || !(await tko_verifyPassword(tko_input.password, tko_account.passwordHash))) throw new Error("TASKO_INVALID_CREDENTIALS");
  const tko_context = await resolveTenantRequestContext({ authSubject: tko_account.authSubject, correlationId: tko_input.correlationId });
  if (!tko_context) throw new Error("TASKO_INVALID_CREDENTIALS");
  // MFA accounts stop here: no session, no last-sign-in touch — the challenge
  // exchange (mfaVerifyLogin) completes the login after a valid code.
  if (await tko_mfaLoginRequired(tko_account.authSubject)) {
    return { mfaRequired: true, challengeToken: await tko_issueLoginChallenge(tko_account.authSubject) };
  }
  await getEmailPasswordStore().touchLastSignedIn(tko_account.authSubject);
  await recordAuthenticationEvent({ actor: createPlatformActor(tko_context.membership, tko_input.correlationId), action: "login", correlationId: tko_input.correlationId, metadata: { loginMethod: "email_password" } });
  return { account: tko_account, sessionToken: await sdk.createSessionToken(tko_account.authSubject, { name: tko_account.displayName, expiresInMs: ONE_YEAR_MS, tenantId: tko_context.membership.tenant.id }) };
}

/** Change password for the signed-in account (spec 06 §2 P1, Security settings). */
export async function changeEmailPassword(tko_input: { authSubject: string; currentPassword: string; newPassword: string; currentSessionToken: string | null; correlationId: string }): Promise<void> {
  const tko_account = await tko_verifyCurrentPassword(tko_input.authSubject, tko_input.currentPassword); // TASKO_INVALID_CREDENTIALS on mismatch
  if (!tko_passwordPolicySatisfied(tko_input.newPassword)) throw new Error("TASKO_PASSWORD_POLICY_FAILED");
  await getEmailPasswordStore().updatePasswordHash(tko_account.authSubject, await tko_passwordHash(tko_input.newPassword));
  const tko_currentHash = tko_input.currentSessionToken ? tko_hashSessionToken(tko_input.currentSessionToken) : null;
  const tko_revokedOthers = await tko_revokeAllSessionsForSubject(tko_account.authSubject, tko_currentHash); // keep the current session
  await tko_recordAuthAudit({ audit: TKO_AUTH_AUDIT.passwordChanged, authSubject: tko_account.authSubject, resourceId: tko_account.authSubject, correlationId: tko_input.correlationId, metadata: { revokedOtherSessions: tko_revokedOthers } });
}
