export type TkoKanbanFilter = "all" | "high_priority" | "assigned" | "unassigned";
export type TkoKanbanGrouping = "none" | "priority" | "assignee";

export type TkoKanbanControlItem = {
  id: string;
  priority: string;
  assignee: string;
};

export function tko_filterKanbanItems<T extends TkoKanbanControlItem>(tko_items: T[], tko_filter: TkoKanbanFilter): T[] {
  if (tko_filter === "high_priority") return tko_items.filter(tko_item => tko_item.priority === "urgent" || tko_item.priority === "high");
  if (tko_filter === "assigned") return tko_items.filter(tko_item => tko_item.assignee !== "—");
  if (tko_filter === "unassigned") return tko_items.filter(tko_item => tko_item.assignee === "—");
  return tko_items;
}

export function tko_groupKanbanItems<T extends TkoKanbanControlItem>(tko_items: T[], tko_grouping: TkoKanbanGrouping): Array<{ key: string; label: string; items: T[] }> {
  if (tko_grouping === "none") return [{ key: "all", label: "All tasks", items: tko_items }];
  const tko_groups = new Map<string, T[]>();
  for (const tko_item of tko_items) {
    const tko_key = tko_grouping === "priority" ? tko_item.priority : tko_item.assignee;
    tko_groups.set(tko_key, [...(tko_groups.get(tko_key) ?? []), tko_item]);
  }
  const tko_priorityOrder = ["urgent", "high", "medium", "low", "none"];
  return Array.from(tko_groups.entries())
    .sort(([tko_left], [tko_right]) => tko_grouping === "priority"
      ? tko_priorityOrder.indexOf(tko_left) - tko_priorityOrder.indexOf(tko_right)
      : tko_left.localeCompare(tko_right))
    .map(([tko_key, tko_groupItems]) => ({
      key: tko_key,
      label: tko_grouping === "priority" ? (tko_key === "none" ? "No priority" : `${tko_key[0].toUpperCase()}${tko_key.slice(1)}`) : (tko_key === "—" ? "Unassigned" : tko_key),
      items: tko_groupItems,
    }));
}
