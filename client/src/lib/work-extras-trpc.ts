// Typed surface for the M1 work-extra procedures that live in server/routers.work-extras.ts.
// The orchestrator spreads tkoWorkExtraProcedures into the `work:` section of appRouter; until that
// wiring lands, this shim keeps the client compiling by describing exactly the hooks it consumes.
// The shapes mirror tRPC v11 react-query hooks (superjson inputs, mutate/mutateAsync/isPending).

export type TkoWorkLabelRow = { id: string; name: string; colorToken: string };
export type TkoWorkTypeRow = { id: string; name: string; category: string; icon: string };
export type TkoTimeLogRow = { id: string; memberId: string; minutes: number; startedAt: Date; note: string };
export type TkoTransitionRow = { fromStatusId: string | null; toStatusId: string; allowed: boolean };
export type TkoWatcherRow = { memberId: string; displayName: string };
export type TkoSavedViewRecord = {
  id: string;
  tenantId: string;
  ownerMemberId: string;
  projectId: string;
  name: string;
  renderer: string;
  visibility: "private" | "workspace";
  filter: Record<string, unknown>;
  layout: Record<string, unknown>;
};
export type TkoWorkItemSummary = { id: string; key: string; title: string; labelIds: string[]; workTypeId: string; statusId: string; rank: string; version: number };

export type TkoQueryHook<TInput, TOutput> = {
  useQuery: (
    tko_input: TInput,
    tko_opts?: { enabled?: boolean },
  ) => {
    data: TOutput | undefined;
    isLoading: boolean;
    isError: boolean;
    refetch: () => Promise<unknown>;
  };
};

export type TkoMutationHook<TInput, TOutput> = {
  useMutation: (tko_opts?: {
    onMutate?: (tko_input: TInput) => unknown | Promise<unknown>;
    onSuccess?: (tko_data: TOutput, tko_input: TInput, tko_context: unknown) => unknown | Promise<unknown>;
    onError?: (tko_error: { message: string }, tko_input: TInput, tko_context: unknown) => unknown;
  }) => {
    mutate: (tko_input: TInput) => void;
    mutateAsync: (tko_input: TInput) => Promise<TOutput>;
    isPending: boolean;
  };
};

export interface TkoWorkExtrasHooks {
  labels: TkoQueryHook<{ projectId: string }, TkoWorkLabelRow[]>;
  workTypes: TkoQueryHook<{ projectId: string }, TkoWorkTypeRow[]>;
  workflowTransitions: TkoQueryHook<{ projectId: string }, { projectId: string; workflowId: string; transitions: TkoTransitionRow[] }>;
  views: TkoQueryHook<{ projectId: string }, TkoSavedViewRecord[]>;
  watchers: TkoQueryHook<{ workItemId: string }, TkoWatcherRow[]>;
  timeLogs: TkoQueryHook<{ workItemId: string }, { logs: TkoTimeLogRow[]; totalMinutes: number }>;
  createLabel: TkoMutationHook<{ projectId: string; name: string; colorToken: string }, TkoWorkLabelRow>;
  updateLabel: TkoMutationHook<{ projectId: string; labelId: string; name?: string; colorToken?: string }, TkoWorkLabelRow>;
  deleteLabel: TkoMutationHook<{ projectId: string; labelId: string }, void>;
  setItemLabels: TkoMutationHook<{ workItemId: string; labelIds: string[] }, TkoWorkItemSummary>;
  addWatcher: TkoMutationHook<{ workItemId: string; memberId?: string | null }, TkoWorkItemSummary>;
  removeWatcher: TkoMutationHook<{ workItemId: string; memberId?: string | null }, TkoWorkItemSummary>;
  addTimeLog: TkoMutationHook<{ workItemId: string; minutes: number; startedAt?: Date | null; note?: string }, TkoTimeLogRow>;
  deleteTimeLog: TkoMutationHook<{ workItemId: string; timeLogId: string }, void>;
  setTransitionAllowed: TkoMutationHook<{ projectId: string; fromStatusId: string | null; toStatusId: string; allowed: boolean }, TkoTransitionRow[]>;
  createWorkType: TkoMutationHook<{ projectId: string; name: string; category: string; icon?: string }, TkoWorkTypeRow>;
  updateWorkType: TkoMutationHook<{ projectId: string; workTypeId: string; name?: string; icon?: string }, TkoWorkTypeRow>;
  setItemType: TkoMutationHook<{ workItemId: string; workTypeId: string }, TkoWorkItemSummary>;
  duplicateItem: TkoMutationHook<{ workItemId: string }, TkoWorkItemSummary>;
  moveItemToProject: TkoMutationHook<{ workItemId: string; targetProjectId: string }, TkoWorkItemSummary>;
  deleteView: TkoMutationHook<{ projectId: string; viewId: string }, void>;
}

export type TkoWorkExtrasUtils = Record<string, { invalidate: (tko_input?: unknown) => Promise<void> } | undefined>;

/** Casts the typed work router onto the extras hook surface (runtime identity, compile-time bridge). */
export function tko_workExtrasHooks(tko_router: unknown): TkoWorkExtrasHooks {
  return tko_router as TkoWorkExtrasHooks;
}
