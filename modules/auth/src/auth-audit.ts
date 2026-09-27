import type { PlatformActor } from "../../../packages/contracts/src/platform";
import { tko_logger } from "../../../packages/observability/src/logger";

/**
 * Audit helper for account-recovery and MFA flows (spec 06 §2 P1).
 *
 * Durable audit rows live under a tenant FK, so events for known accounts are
 * recorded via `recordAuditedEvent` after resolving an active membership; the
 * platform-level actor is passed through when the caller already has one.
 * Events without a tenant (e.g. a password-reset request for an unknown email)
 * fall back to the structured logger — they never fail the request and never
 * reveal whether the account exists.
 */

export const TKO_AUTH_AUDIT = {
  passwordResetRequested: { action: "auth.password_reset.requested", eventType: "auth.password_reset.requested.v1" },
  passwordResetCompleted: { action: "auth.password_reset.completed", eventType: "auth.password_reset.completed.v1" },
  passwordChanged: { action: "auth.password.changed", eventType: "auth.password.changed.v1" },
  emailVerified: { action: "auth.email.verified", eventType: "auth.email.verified.v1" },
  mfaEnabled: { action: "auth.mfa.enabled", eventType: "auth.mfa.enabled.v1" },
  mfaDisabled: { action: "auth.mfa.disabled", eventType: "auth.mfa.disabled.v1" },
  mfaChallengePassed: { action: "auth.mfa.challenge_passed", eventType: "auth.mfa.challenge_passed.v1" },
  mfaChallengeFailed: { action: "auth.mfa.challenge_failed", eventType: "auth.mfa.challenge_failed.v1" },
} as const;

type TkoAuditAction = (typeof TKO_AUTH_AUDIT)[keyof typeof TKO_AUTH_AUDIT];

async function tko_resolveTenantActor(tko_authSubject: string): Promise<PlatformActor | null> {
  const { getPlatformStore } = await import("../../../packages/database/src/platform-store");
  const { createPlatformActor } = await import("../../tenancy/src/tenant-context");
  const tko_memberships = await getPlatformStore().listMemberships(tko_authSubject);
  const tko_membership = tko_memberships.find(tko_item => tko_item.status === "active") ?? tko_memberships[0];
  return tko_membership ? createPlatformActor(tko_membership) : null;
}

export async function tko_recordAuthAudit(tko_input: {
  audit: TkoAuditAction;
  authSubject: string | null;
  resourceId: string;
  correlationId: string;
  actor?: PlatformActor | null;
  tenantId?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    const tko_actor = tko_input.actor ?? (tko_input.authSubject ? await tko_resolveTenantActor(tko_input.authSubject) : null);
    const tko_tenantId = tko_input.tenantId ?? tko_actor?.tenantId ?? null;
    if (!tko_tenantId) {
      tko_logger.warn({ authAudit: { action: tko_input.audit.action, authSubject: tko_input.authSubject, resourceId: tko_input.resourceId, correlationId: tko_input.correlationId, durable: false } }, "auth audit event without tenant context logged only");
      return;
    }
    const { recordAuditedEvent } = await import("../../audit/src/audit-service");
    await recordAuditedEvent({
      actor: tko_actor,
      tenantId: tko_tenantId,
      eventType: tko_input.audit.eventType,
      topic: "security.authentication",
      payload: { authSubject: tko_input.authSubject, action: tko_input.audit.action },
      action: tko_input.audit.action,
      resourceType: "account_security",
      resourceId: tko_input.resourceId,
      correlationId: tko_input.correlationId,
      metadata: tko_input.metadata,
    });
  } catch (tko_error) {
    // Auditing must never break the security flow it documents.
    tko_logger.error({ authAudit: { action: tko_input.audit.action, correlationId: tko_input.correlationId }, error: String(tko_error) }, "auth audit write failed");
  }
}
