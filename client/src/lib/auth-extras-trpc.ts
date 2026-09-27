import { trpc } from "@/lib/trpc";

// Typed surface for the auth-extra procedures that live in server/routers.auth-extras.ts.
// The orchestrator spreads tkoAuthExtraProcedures into the `auth:` section of appRouter; until that
// wiring lands, this shim keeps the client compiling by describing exactly the hooks it consumes
// (same pattern as lib/work-extras-trpc.ts). The shapes mirror tRPC v11 react-query hooks
// (superjson inputs, mutate/mutateAsync/isPending).
//
// `signInWithEmailPassword` SUPERSEDES the base procedure: for non-MFA accounts the response is the
// historical `{ account: { email, displayName } }`; for MFA accounts it is
// `{ mfaRequired: true, challengeToken }` (no session cookie is set until `mfaVerifyLogin`).

export type TkoAuthAccountResponse = { account: { email: string; displayName: string } };
export type TkoAuthMfaChallengeResponse = { mfaRequired: true; challengeToken: string };
export type TkoAuthSignInResponse = TkoAuthAccountResponse | TkoAuthMfaChallengeResponse;
export type TkoAuthPasswordResetRequestResponse = { success: true; devOnly?: { resetToken: string } };
export type TkoAuthResendVerificationResponse = { sent: boolean; alreadyVerified: boolean; devOnly?: { verificationToken: string } };
export type TkoAuthMeShape = {
  openId: string;
  name: string | null;
  email: string | null;
  loginMethod: string | null;
  emailVerified: boolean | null;
};

export type TkoAuthQueryHook<TInput, TOutput> = {
  useQuery: (
    tko_input: TInput,
    tko_opts?: { enabled?: boolean; retry?: boolean; refetchOnWindowFocus?: boolean },
  ) => {
    data: TOutput | undefined;
    isLoading: boolean;
    isError: boolean;
    refetch: () => Promise<unknown>;
  };
};

export type TkoAuthMutationHook<TInput, TOutput> = {
  useMutation: (tko_opts?: {
    onSuccess?: (tko_data: TOutput, tko_input: TInput) => unknown | Promise<unknown>;
    onError?: (tko_error: { message: string }, tko_input: TInput) => unknown;
  }) => {
    mutateAsync: (tko_input: TInput) => Promise<TOutput>;
    mutate: (tko_input: TInput) => void;
    isPending: boolean;
  };
};

/** Mutation with no input variables. */
export type TkoAuthActionHook<TOutput> = {
  useMutation: (tko_opts?: {
    onSuccess?: (tko_data: TOutput) => unknown | Promise<unknown>;
    onError?: (tko_error: { message: string }) => unknown;
  }) => {
    mutateAsync: (tko_input?: void) => Promise<TOutput>;
    mutate: () => void;
    isPending: boolean;
  };
};

export type TkoAuthExtrasHooks = {
  me: TkoAuthQueryHook<void, TkoAuthMeShape | null>;
  signInWithEmailPassword: TkoAuthMutationHook<{ email: string; password: string }, TkoAuthSignInResponse>;
  requestPasswordReset: TkoAuthMutationHook<{ email: string }, TkoAuthPasswordResetRequestResponse>;
  resetPassword: TkoAuthMutationHook<{ token: string; newPassword: string }, TkoAuthAccountResponse>;
  verifyEmail: TkoAuthMutationHook<{ token: string }, { verified: true; email: string | null }>;
  resendVerificationEmail: TkoAuthActionHook<TkoAuthResendVerificationResponse>;
  changePassword: TkoAuthMutationHook<{ currentPassword: string; newPassword: string }, { success: true }>;
  mfaStatus: TkoAuthQueryHook<void, { enabled: boolean }>;
  mfaStartEnrollment: TkoAuthActionHook<{ secret: string; otpauthUri: string }>;
  mfaConfirmEnrollment: TkoAuthMutationHook<{ code: string }, { recoveryCodes: string[] }>;
  mfaDisable: TkoAuthMutationHook<{ password: string }, { success: true }>;
  mfaVerifyLogin: TkoAuthMutationHook<{ challengeToken: string; code: string }, TkoAuthAccountResponse>;
};

/** Casts the typed auth router onto the extras hook surface (runtime identity, compile-time bridge). */
export function tko_authExtrasHooks(tko_router: unknown): TkoAuthExtrasHooks {
  return tko_router as TkoAuthExtrasHooks;
}
