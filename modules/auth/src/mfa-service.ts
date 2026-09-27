import { createHash } from "node:crypto";
import type { EmailPasswordAccount } from "../../../packages/database/src/email-password-store";
import { getEmailPasswordStore } from "../../../packages/database/src/email-password-store";
import { getRedisAdapter } from "../../../packages/redis/src/redis-adapter";
import { ONE_YEAR_MS } from "../../../shared/const";
import { TKO_AUTH_AUDIT, tko_recordAuthAudit } from "./auth-audit";
import {
  tko_challengeConsumed,
  tko_markChallengeConsumed,
  tko_mintMfaChallenge,
  tko_verifyMfaChallenge,
} from "./mfa-challenge";
import { tko_verifyCurrentPassword } from "./account-recovery-service";
import { tko_decryptSecret, tko_encryptSecret } from "./secret-box";
import { getTotpStore, type TotpRecoveryCodeRecord } from "./totp-store";
import { tko_generateRecoveryCodes, tko_generateTotpSecret, tko_otpauthUri, tko_timingSafeStringEqual, tko_verifyTotpCode } from "./totp";
import { sdk } from "../../../server/_core/sdk";
import { resolveTenantRequestContext } from "../../tenancy/src/tenant-context";

/**
 * TOTP MFA services (spec 06 §2 P1, RFC 6238 via totp.ts).
 *
 * Enrollment: startEnrollment stores an AES-256-GCM-encrypted pending secret;
 * confirmEnrollment verifies one code, activates MFA and returns 8 recovery
 * codes exactly once (only SHA-256 hashes are persisted). Login with MFA
 * enabled never mints a session directly — signInWithEmailPassword returns a
 * short-lived challenge token which mfaVerifyLogin exchanges (TOTP or unused
 * recovery code) for a real session.
 */

const TKO_RECOVERY_CODE_COUNT = 8;
const TKO_ENROLL_LIMIT = 5;
const TKO_ENROLL_WINDOW_MS = 60 * 60_000;
const TKO_VERIFY_ATTEMPT_LIMIT = 8;
const TKO_VERIFY_ATTEMPT_WINDOW_MS = 15 * 60_000;

export type TkoMfaStatus = { enabled: boolean };
export type TkoMfaEnrollmentStart = { secret: string; otpauthUri: string };
export type TkoMfaEnrollmentConfirmation = { recoveryCodes: string[] };

function tko_sha256Hex(tko_value: string): string {
  return createHash("sha256").update(tko_value).digest("hex");
}

function tko_subjectHash(tko_authSubject: string): string {
  return tko_sha256Hex(tko_authSubject);
}

async function tko_takeMfaRateLimit(tko_key: string, tko_limit: number, tko_windowMs: number): Promise<void> {
  const tko_result = await getRedisAdapter().takeRateLimit(tko_key, tko_limit, tko_windowMs);
  if (!tko_result.allowed) throw new Error("TASKO_AUTH_RATE_LIMITED");
}

export async function mfaStatus(tko_authSubject: string): Promise<TkoMfaStatus> {
  return { enabled: await getTotpStore().isMfaEnabled(tko_authSubject) };
}

export async function startEnrollment(tko_input: { authSubject: string; accountEmail: string; correlationId: string }): Promise<TkoMfaEnrollmentStart> {
  await tko_takeMfaRateLimit(`auth:mfa-enroll:${tko_subjectHash(tko_input.authSubject)}`, TKO_ENROLL_LIMIT, TKO_ENROLL_WINDOW_MS);
  if (await getTotpStore().isMfaEnabled(tko_input.authSubject)) throw new Error("TASKO_MFA_ALREADY_ENABLED");
  const tko_secret = tko_generateTotpSecret();
  await getTotpStore().upsertPending({ authSubject: tko_input.authSubject, secretEncrypted: tko_encryptSecret(tko_secret) });
  return { secret: tko_secret, otpauthUri: tko_otpauthUri({ accountEmail: tko_input.accountEmail, secretBase32: tko_secret }) };
}

export async function confirmEnrollment(tko_input: { authSubject: string; code: string; correlationId: string }): Promise<TkoMfaEnrollmentConfirmation> {
  const tko_store = getTotpStore();
  const tko_credential = await tko_store.getBySubject(tko_input.authSubject);
  if (!tko_credential) throw new Error("TASKO_MFA_ENROLLMENT_NOT_STARTED");
  if (tko_credential.confirmedAt) throw new Error("TASKO_MFA_ALREADY_ENABLED");
  const tko_secret = tko_decryptSecret(tko_credential.secretEncrypted);
  if (!tko_verifyTotpCode(tko_secret, tko_input.code)) throw new Error("TASKO_MFA_CODE_INVALID");
  const tko_recoveryCodes = tko_generateRecoveryCodes(TKO_RECOVERY_CODE_COUNT);
  const tko_hashedCodes: TotpRecoveryCodeRecord[] = tko_recoveryCodes.map(tko_code => ({ hash: tko_sha256Hex(tko_code), usedAt: null }));
  await tko_store.activate({ authSubject: tko_input.authSubject, confirmedAt: new Date(), recoveryCodes: tko_hashedCodes });
  await tko_recordAuthAudit({ audit: TKO_AUTH_AUDIT.mfaEnabled, authSubject: tko_input.authSubject, resourceId: tko_input.authSubject, correlationId: tko_input.correlationId, metadata: { method: "totp" } });
  return { recoveryCodes: tko_recoveryCodes };
}

export async function disableMfa(tko_input: { authSubject: string; password: string; correlationId: string }): Promise<void> {
  const tko_account = await tko_verifyCurrentPassword(tko_input.authSubject, tko_input.password); // TASKO_INVALID_CREDENTIALS on mismatch
  const tko_store = getTotpStore();
  if (!(await tko_store.isMfaEnabled(tko_input.authSubject))) throw new Error("TASKO_MFA_NOT_ENABLED");
  await tko_store.delete(tko_input.authSubject);
  await tko_recordAuthAudit({ audit: TKO_AUTH_AUDIT.mfaDisabled, authSubject: tko_input.authSubject, resourceId: tko_input.authSubject, correlationId: tko_input.correlationId, metadata: { method: "password_confirmation" } });
}

/** Whether sign-in for this account must stop at the MFA challenge. */
export async function tko_mfaLoginRequired(tko_authSubject: string): Promise<boolean> {
  return getTotpStore().isMfaEnabled(tko_authSubject);
}

/** Minted by signInWithEmailPassword instead of a session when MFA is enabled. */
export async function tko_issueLoginChallenge(tko_authSubject: string): Promise<string> {
  return tko_mintMfaChallenge(tko_authSubject);
}

export type TkoMfaLoginResult = { account: Pick<EmailPasswordAccount, "authSubject" | "email" | "displayName">; sessionToken: string };

/**
 * Exchange a valid challenge token + TOTP/recovery code for a real session.
 * The challenge is single-use; attempts are rate limited per challenge; a
 * recovery code is burned on first successful use.
 */
export async function mfaVerifyLogin(tko_input: { challengeToken: string; code: string; correlationId: string }): Promise<TkoMfaLoginResult> {
  const tko_challenge = await tko_verifyMfaChallenge(tko_input.challengeToken); // TASKO_MFA_CHALLENGE_INVALID
  if (await tko_challengeConsumed(tko_challenge.jti)) throw new Error("TASKO_MFA_CHALLENGE_INVALID");
  await tko_takeMfaRateLimit(`auth:mfa-verify:${tko_challenge.jti}`, TKO_VERIFY_ATTEMPT_LIMIT, TKO_VERIFY_ATTEMPT_WINDOW_MS);
  const tko_store = getTotpStore();
  const tko_credential = await tko_store.getBySubject(tko_challenge.authSubject);
  if (!tko_credential || !tko_credential.confirmedAt || !tko_credential.enabledAt) throw new Error("TASKO_MFA_CHALLENGE_INVALID");

  let tko_usedRecoveryCodeIndex: number | null = null;
  if (tko_verifyTotpCode(tko_decryptSecret(tko_credential.secretEncrypted), tko_input.code)) {
    // TOTP path.
  } else {
    const tko_codes = tko_credential.recoveryCodes ?? [];
    const tko_candidateHash = tko_sha256Hex((tko_input.code ?? "").trim());
    for (let tko_index = 0; tko_index < tko_codes.length; tko_index += 1) {
      const tko_record = tko_codes[tko_index];
      if (tko_record.usedAt) continue;
      if (!tko_timingSafeStringEqual(tko_record.hash, tko_candidateHash)) continue;
      tko_usedRecoveryCodeIndex = tko_index;
      break;
    }
    if (tko_usedRecoveryCodeIndex === null) {
      await tko_recordAuthAudit({ audit: TKO_AUTH_AUDIT.mfaChallengeFailed, authSubject: tko_challenge.authSubject, resourceId: tko_challenge.jti, correlationId: tko_input.correlationId, metadata: { method: "totp_or_recovery" } });
      throw new Error("TASKO_MFA_CODE_INVALID");
    }
    const tko_updated = tko_codes.map((tko_record, tko_index) => (tko_index === tko_usedRecoveryCodeIndex ? { ...tko_record, usedAt: new Date().toISOString() } : { ...tko_record }));
    await tko_store.updateRecoveryCodes(tko_challenge.authSubject, tko_updated);
  }

  const tko_account: EmailPasswordAccount | null = await getEmailPasswordStore().getByAuthSubject(tko_challenge.authSubject);
  if (!tko_account) throw new Error("TASKO_MFA_CHALLENGE_INVALID");
  await tko_markChallengeConsumed(tko_challenge.jti, tko_challenge.expiresInMs);
  const tko_context = await resolveTenantRequestContext({ authSubject: tko_account.authSubject, correlationId: tko_input.correlationId });
  if (!tko_context) throw new Error("TASKO_INVALID_CREDENTIALS");
  await getEmailPasswordStore().touchLastSignedIn(tko_account.authSubject);
  await tko_recordAuthAudit({ audit: TKO_AUTH_AUDIT.mfaChallengePassed, authSubject: tko_account.authSubject, resourceId: tko_challenge.jti, correlationId: tko_input.correlationId, metadata: { method: tko_usedRecoveryCodeIndex === null ? "totp" : "recovery_code" } });
  const tko_sessionToken = await sdk.createSessionToken(tko_account.authSubject, { name: tko_account.displayName, expiresInMs: ONE_YEAR_MS, tenantId: tko_context.membership.tenant.id });
  return { account: { authSubject: tko_account.authSubject, email: tko_account.email, displayName: tko_account.displayName }, sessionToken: tko_sessionToken };
}
