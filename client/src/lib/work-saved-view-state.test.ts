import { describe, expect, it } from "vitest";
import { tko_defaultWorkFilterState, tko_filterStateToPayload, tko_payloadToFilterState, tko_rendererForView, tko_viewForRenderer } from "./work-saved-view-state";

describe("Saved view filter state mapping", () => {
  it("round-trips filter state through a durable payload", () => {
    const tko_state = { kanbanFilter: "high_priority" as const, grouping: "assignee" as const, labelIds: ["l1", "l2", "l2"] };
    const tko_payload = tko_filterStateToPayload(tko_state);
    expect(tko_payload).toEqual({ kind: "tasko.work.filter.v1", kanbanFilter: "high_priority", grouping: "assignee", labelIds: ["l1", "l2"] });
    expect(tko_payloadToFilterState(tko_payload)).toEqual({ kanbanFilter: "high_priority", grouping: "assignee", labelIds: ["l1", "l2"] });
  });

  it("falls back to the default state for foreign or malformed payloads", () => {
    expect(tko_payloadToFilterState(null)).toBeNull();
    expect(tko_payloadToFilterState("nope")).toBeNull();
    expect(tko_payloadToFilterState({ kind: "crm.filter.v1" })).toBeNull();
    expect(tko_payloadToFilterState({ kind: "tasko.work.filter.v1", kanbanFilter: "bogus", grouping: 42, labelIds: "no" })).toEqual(tko_defaultWorkFilterState);
  });

  it("maps views onto renderers and back", () => {
    expect(tko_rendererForView("board")).toBe("board");
    expect(tko_rendererForView("list")).toBe("list");
    expect(tko_rendererForView("overview")).toBeNull();
    expect(tko_viewForRenderer("timeline")).toBe("timeline");
    expect(tko_viewForRenderer("unknown")).toBe("board");
  });
});
