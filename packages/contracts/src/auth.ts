/**
 * Auth contracts: account-recovery and MFA flows (spec 06 §2 P1).
 *
 * Shared between the server tRPC layer and clients so the password-reset,
 * email-verification and TOTP-MFA surfaces cannot drift. Account-shape
 * additions live in identity.ts.
 */

/** `auth.requestPasswordReset` — identical response whether or not the account exists. */
export type PasswordResetRequestResult = {
  success: true;
  /** ONLY when NODE_ENV !== "production" and the email provider is unconfigured. */
  devOnly?: { resetToken: string };
};

/** `auth.resetPassword` — the caller lands logged-in (session cookie is set server-side). */
export type PasswordResetResult = {
  account: { email: string; displayName: string };
};

/** `auth.verifyEmail` */
export type EmailVerificationResult = {
  verified: true;
  email: string | null;
};

/** `auth.resendVerificationEmail` (authed, rate limited) */
export type ResendVerificationResult = {
  sent: boolean;
  alreadyVerified: boolean;
  devOnly?: { verificationToken: string };
};

/** `auth.signInWithEmailPassword` outcome for MFA-enabled accounts (no session is minted). */
export type MfaLoginChallenge = {
  mfaRequired: true;
  challengeToken: string;
};

/** `auth.mfaStatus` */
export type MfaStatusResult = {
  enabled: boolean;
};

/** `auth.mfaStartEnrollment` — secret is shown once; stored encrypted at rest. */
export type MfaEnrollmentStartResult = {
  secret: string;
  otpauthUri: string;
};

/** `auth.mfaConfirmEnrollment` — recovery codes are returned exactly once (stored hashed). */
export type MfaEnrollmentConfirmResult = {
  recoveryCodes: string[];
};
