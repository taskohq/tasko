/**
 * Identity contracts: user-facing sessions and teams.
 *
 * These types are shared between the server tRPC layer and clients, so the
 * session/device-management and team-management surfaces cannot drift.
 */

export type SessionSummary = {
  id: string;
  device: string | null;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
  isCurrent: boolean;
};

export type TeamSummary = {
  id: string;
  tenantId: string;
  name: string;
  handle: string;
  memberCount: number;
  createdAt: Date;
};

export type TeamMemberSummary = {
  teamId: string;
  authSubject: string;
  displayName: string | null;
  createdAt: Date;
};

/** Durable event types emitted by the team service (outbox + audit). */
export const TKO_TEAM_EVENT_TYPES = {
  created: "team.created.v1",
  updated: "team.updated.v1",
  deleted: "team.deleted.v1",
  memberAdded: "team.member_added.v1",
  memberRemoved: "team.member_removed.v1",
} as const;

export type TKO_TeamEventType = (typeof TKO_TEAM_EVENT_TYPES)[keyof typeof TKO_TEAM_EVENT_TYPES];

// --- Account security (spec 06 §2 P1: recovery, verification, MFA) ----------
// Appended additively; the shapes above are unchanged.

/** `auth.me` payload gains this field additively (never null-blocking login). */
export type EmailVerifiedAccountShape = {
  /** `true`/`false` for email/password accounts; `null` for OAuth principals. */
  emailVerified: boolean | null;
};

/** Audit actions emitted by account-recovery and MFA flows (topic `security.authentication`). */
export const TKO_ACCOUNT_SECURITY_AUDIT_ACTIONS = {
  passwordResetRequested: "auth.password_reset.requested",
  passwordResetCompleted: "auth.password_reset.completed",
  passwordChanged: "auth.password.changed",
  emailVerified: "auth.email.verified",
  mfaEnabled: "auth.mfa.enabled",
  mfaDisabled: "auth.mfa.disabled",
  mfaChallengePassed: "auth.mfa.challenge_passed",
  mfaChallengeFailed: "auth.mfa.challenge_failed",
} as const;
