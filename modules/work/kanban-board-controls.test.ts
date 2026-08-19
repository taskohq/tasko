import { describe, expect, it } from "vitest";
import { tko_filterKanbanItems, tko_groupKanbanItems } from "../../client/src/lib/kanban-board-controls";

const tko_items = [
  { id: "WI-1", priority: "urgent", assignee: "ME" },
  { id: "WI-2", priority: "medium", assignee: "—" },
  { id: "WI-3", priority: "high", assignee: "AN" },
];

describe("Kanban board controls", () => {
  it("filters high-priority, assigned and unassigned tasks without changing the input", () => {
    expect(tko_filterKanbanItems(tko_items, "high_priority").map(tko_item => tko_item.id)).toEqual(["WI-1", "WI-3"]);
    expect(tko_filterKanbanItems(tko_items, "assigned").map(tko_item => tko_item.id)).toEqual(["WI-1", "WI-3"]);
    expect(tko_filterKanbanItems(tko_items, "unassigned").map(tko_item => tko_item.id)).toEqual(["WI-2"]);
    expect(tko_items).toHaveLength(3);
  });

  it("groups cards by priority in workflow order and by assignee with an explicit unassigned group", () => {
    expect(tko_groupKanbanItems(tko_items, "priority").map(tko_group => [tko_group.label, tko_group.items.map(tko_item => tko_item.id)])).toEqual([
      ["Urgent", ["WI-1"]], ["High", ["WI-3"]], ["Medium", ["WI-2"]],
    ]);
    expect(tko_groupKanbanItems(tko_items, "assignee").map(tko_group => tko_group.label)).toEqual(["Unassigned", "AN", "ME"]);
  });
});
