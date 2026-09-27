export type TkoWorkLabelFilterItem = { labelIds: readonly string[] };

/** Keeps only items carrying at least one of the requested labels; empty filter is a pass-through. */
export function tko_filterItemsByLabels<T extends TkoWorkLabelFilterItem>(tko_items: T[], tko_labelIds: readonly string[]): T[] {
  if (!tko_labelIds.length) return tko_items;
  return tko_items.filter(tko_item => tko_labelIds.some(tko_labelId => tko_item.labelIds.includes(tko_labelId)));
}

/** Stable compact chip summary used by cards and rows: at most two names plus an overflow count. */
export function tko_labelChipSummary(tko_names: string[], tko_max = 2): { visible: string[]; overflow: number } {
  const tko_visible = tko_names.slice(0, Math.max(tko_max, 0));
  return { visible: tko_visible, overflow: Math.max(tko_names.length - tko_visible.length, 0) };
}
