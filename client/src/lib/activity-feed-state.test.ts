import { describe, expect, it } from "vitest";
import { tko_activityFeedState } from "./activity-feed-state";

describe("tko_activityFeedState", () => {
  it("keeps first-page loading distinct from an empty activity feed", () => {
    expect(tko_activityFeedState({ tko_isLoading: true, tko_isError: false, tko_itemCount: 0 })).toBe("loading");
    expect(tko_activityFeedState({ tko_isLoading: false, tko_isError: false, tko_itemCount: 0 })).toBe("empty");
  });

  it("prioritizes a request error and treats loaded pages as ready", () => {
    expect(tko_activityFeedState({ tko_isLoading: false, tko_isError: true, tko_itemCount: 0 })).toBe("error");
    expect(tko_activityFeedState({ tko_isLoading: false, tko_isError: false, tko_itemCount: 20 })).toBe("ready");
  });
});
