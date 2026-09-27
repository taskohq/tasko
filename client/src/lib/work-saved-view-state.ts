export type TkoSavedViewRenderer = "list" | "board" | "calendar" | "timeline";
export type TkoWorkFilterState = {
  kanbanFilter: "all" | "high_priority" | "assigned" | "unassigned";
  grouping: "none" | "priority" | "assignee";
  labelIds: string[];
};

export const tko_defaultWorkFilterState: TkoWorkFilterState = { kanbanFilter: "all", grouping: "none", labelIds: [] };

const tko_payloadKind = "tasko.work.filter.v1";

/** Serializes the client's ad-hoc filter state into a durable saved-view filter payload. */
export function tko_filterStateToPayload(tko_state: TkoWorkFilterState): Record<string, unknown> {
  return {
    kind: tko_payloadKind,
    kanbanFilter: tko_state.kanbanFilter,
    grouping: tko_state.grouping,
    labelIds: Array.from(new Set(tko_state.labelIds)),
  };
}

/** Restores filter state from a saved-view payload; returns null for foreign or malformed payloads. */
export function tko_payloadToFilterState(tko_payload: unknown): TkoWorkFilterState | null {
  if (!tko_payload || typeof tko_payload !== "object" || Array.isArray(tko_payload)) return null;
  const tko_record = tko_payload as Record<string, unknown>;
  if (tko_record.kind !== tko_payloadKind) return null;
  const tko_kanbanFilter = tko_record.kanbanFilter;
  const tko_grouping = tko_record.grouping;
  const tko_labelIds = tko_record.labelIds;
  return {
    kanbanFilter: tko_kanbanFilter === "high_priority" || tko_kanbanFilter === "assigned" || tko_kanbanFilter === "unassigned" ? tko_kanbanFilter : "all",
    grouping: tko_grouping === "priority" || tko_grouping === "assignee" ? tko_grouping : "none",
    labelIds: Array.isArray(tko_labelIds) ? tko_labelIds.filter((tko_id): tko_id is string => typeof tko_id === "string") : [],
  };
}

/** Maps a Work.tsx view id onto a persisted renderer; null for views that cannot be saved. */
export function tko_rendererForView(tko_view: string): TkoSavedViewRenderer | null {
  if (tko_view === "board" || tko_view === "list" || tko_view === "calendar" || tko_view === "timeline") return tko_view;
  return null;
}

/** Maps a persisted renderer back onto the Work.tsx view id that renders it. */
export function tko_viewForRenderer(tko_renderer: string): "board" | "list" | "calendar" | "timeline" {
  return tko_renderer === "list" || tko_renderer === "calendar" || tko_renderer === "timeline" ? tko_renderer : "board";
}
