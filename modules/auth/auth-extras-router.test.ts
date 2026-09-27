import { describe, expect, it } from "vitest";
import { tkoAuthExtraProcedures } from "../../server/routers.auth-extras";

/**
 * Guards the orchestrator wiring contract for spec 06 §2 P1:
 *  - every procedure the client shim (client/src/lib/auth-extras-trpc.ts) and
 *    SecuritySettings/Login expect must exist on `tkoAuthExtraProcedures`;
 *  - the orchestrator spreads this object into the `auth:` section and DROPS
 *    the base `me` and `signInWithEmailPassword` procedures (superseded here
 *    under the SAME names — `me` gains `emailVerified` additively;
 *    `signInWithEmailPassword` preserves the base response shape for non-MFA
 *    accounts and adds the `{ mfaRequired, challengeToken }` outcome for MFA
 *    accounts).
 */
describe("auth extras procedures (orchestrator wiring contract)", () => {
  it("exposes the full account-recovery and MFA surface", () => {
    expect(Object.keys(tkoAuthExtraProcedures).sort()).toEqual(
      [
        "changePassword",
        "me",
        "mfaConfirmEnrollment",
        "mfaDisable",
        "mfaStartEnrollment",
        "mfaStatus",
        "mfaVerifyLogin",
        "requestPasswordReset",
        "resetPassword",
        "resendVerificationEmail",
        "signInWithEmailPassword",
        "verifyEmail",
      ].sort(),
    );
  });
});
