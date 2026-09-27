// Typed surface for the M4 workspace-extra procedures that live in server/routers.workspace-extras.ts.
// The orchestrator spreads tkoWorkspaceExtraProcedures into the `workspace:` section of appRouter
// (and REPLACES the existing createAutomationRule with the v2 version); until that wiring lands,
// this shim keeps the client compiling by describing exactly the hooks it consumes.
// Same bridge pattern as lib/work-extras-trpc.ts: runtime identity, compile-time description.
import type { AutomationTriggerType, WorkspaceAutomationAction, WorkspaceAutomationCondition, WorkspaceAutomationRule, WorkspaceDocument, WorkspaceDocumentRevision, WorkspaceForm } from "../../../packages/contracts/src/workspace";

export type TkoWorkspaceExtrasUtils = Record<string, { invalidate: (tko_input?: unknown) => Promise<void> } | undefined>;

export type TkoQueryHook<TInput, TOutput> = {
  useQuery: (tko_input: TInput, tko_opts?: { enabled?: boolean }) => {
    data: TOutput | undefined;
    isLoading: boolean;
    isError: boolean;
    refetch: () => Promise<unknown>;
  };
};

export type TkoMutationHook<TInput, TOutput> = {
  useMutation: (tko_opts?: {
    onSuccess?: (tko_data: TOutput, tko_input: TInput, tko_context: unknown) => unknown | Promise<unknown>;
    onError?: (tko_error: { message: string }, tko_input: TInput, tko_context: unknown) => unknown;
  }) => {
    mutate: (tko_input: TInput) => void;
    mutateAsync: (tko_input: TInput) => Promise<TOutput>;
    isPending: boolean;
  };
};

export type TkoCreateAutomationRuleInput = {
  name: string;
  triggerType: AutomationTriggerType;
  condition?: Record<string, unknown>;
  conditions?: WorkspaceAutomationCondition[];
  actions: WorkspaceAutomationAction[];
};

export interface TkoWorkspaceExtrasHooks {
  documentRevisions: TkoQueryHook<{ documentId: string }, WorkspaceDocumentRevision[]>;
  restoreDocumentRevision: TkoMutationHook<{ documentId: string; revisionId: string }, { document: WorkspaceDocument; revision: WorkspaceDocumentRevision }>;
  setFormSharing: TkoMutationHook<{ formId: string; isPublic: boolean }, WorkspaceForm>;
  createAutomationRule: TkoMutationHook<TkoCreateAutomationRuleInput, WorkspaceAutomationRule>;
}

/** Casts the typed workspace router onto the extras hook surface (runtime identity, compile-time bridge). */
export function tko_workspaceExtrasHooks(tko_router: unknown): TkoWorkspaceExtrasHooks {
  return tko_router as TkoWorkspaceExtrasHooks;
}
