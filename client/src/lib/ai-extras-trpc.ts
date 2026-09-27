import { trpc } from "@/lib/trpc";

// Typed surface for the AI extra procedure that lives in server/routers.ai-extras.ts.
// The orchestrator spreads tkoAiExtraProcedures into the `ai:` section of appRouter; until that
// wiring lands, this shim keeps the client compiling by describing exactly the hook it consumes
// (same pattern as lib/auth-extras-trpc.ts and lib/work-extras-trpc.ts). Runtime identity holds
// before and after wiring, so no call-site changes are needed once tkoAiExtraProcedures is spread.

export type TkoAIProposalShape = {
  id: string;
  runId: string;
  toolName: string;
  risk: string;
  input: Record<string, unknown>;
  preview: Record<string, unknown>;
  idempotencyKey: string;
  status: string;
  proposedByMemberId: string;
  confirmedByMemberId: string | null;
  executedAt: Date | null;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
};

export type TkoAIProposeToolInput = {
  toolName: string;
  input: Record<string, unknown>;
  idempotencyKey?: string;
};

export type TkoAIMutationHook<TInput, TOutput> = {
  useMutation: (tko_opts?: {
    onSuccess?: (tko_data: TOutput, tko_input: TInput) => unknown | Promise<unknown>;
    onError?: (tko_error: { message: string }, tko_input: TInput) => unknown;
  }) => {
    mutateAsync: (tko_input: TInput) => Promise<TOutput>;
    mutate: (tko_input: TInput) => void;
    isPending: boolean;
  };
};

export type TkoAIExtrasHooks = {
  proposeTool: TkoAIMutationHook<TkoAIProposeToolInput, TkoAIProposalShape>;
};

/** Casts the typed ai router onto the extras hook surface (runtime identity, compile-time bridge). */
export function tko_aiExtrasHooks(tko_router: unknown): TkoAIExtrasHooks {
  return tko_router as TkoAIExtrasHooks;
}
