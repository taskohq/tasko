import { describe, expect, it } from "vitest";
import { tko_filterItemsByLabels, tko_labelChipSummary } from "./work-label-filters";

describe("Work label filters", () => {
  it("keeps every item when no label filter is applied", () => {
    const tko_items = [
      { id: "a", labelIds: ["l1"] },
      { id: "b", labelIds: [] },
    ];
    expect(tko_filterItemsByLabels(tko_items, [])).toEqual(tko_items);
  });

  it("keeps only items carrying at least one requested label", () => {
    const tko_items = [
      { id: "a", labelIds: ["l1", "l3"] },
      { id: "b", labelIds: [] },
      { id: "c", labelIds: ["l2"] },
    ];
    expect(tko_filterItemsByLabels(tko_items, ["l1", "l2"]).map(tko_item => tko_item.id)).toEqual(["a", "c"]);
    expect(tko_filterItemsByLabels(tko_items, ["missing"])).toEqual([]);
  });

  it("summarizes chips with an overflow count", () => {
    expect(tko_labelChipSummary(["infra", "support", "billing"])).toEqual({ visible: ["infra", "support"], overflow: 1 });
    expect(tko_labelChipSummary(["infra"], 3)).toEqual({ visible: ["infra"], overflow: 0 });
  });
});
