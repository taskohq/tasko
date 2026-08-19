import { describe, expect, it, vi } from "vitest";
import { tko_runBulkStatusMove } from "../../client/src/lib/bulk-work-status";

describe("tko_runBulkStatusMove", () => {
  it("moves eligible items sequentially and skips items already in the target status", async () => {
    const tko_move = vi.fn().mockResolvedValue(undefined);

    const tko_result = await tko_runBulkStatusMove({
      targetStatusId: "done-status",
      items: [
        { id: "work-1", statusId: "todo-status", version: 3 },
        { id: "work-2", statusId: "done-status", version: 2 },
        { id: "work-3", statusId: "in-progress-status", version: 4 },
      ],
      move: tko_move,
    });

    expect(tko_move.mock.calls).toEqual([
      [{ workItemId: "work-1", targetStatusId: "done-status", expectedVersion: 3 }],
      [{ workItemId: "work-3", targetStatusId: "done-status", expectedVersion: 4 }],
    ]);
    expect(tko_result).toEqual({ succeededIds: ["work-1", "work-3"], failedIds: [], skippedIds: ["work-2"] });
  });

  it("keeps independent items moving when one item fails so the UI can retain only retryable selections", async () => {
    const tko_move = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("version conflict"))
      .mockResolvedValueOnce(undefined);

    const tko_result = await tko_runBulkStatusMove({
      targetStatusId: "done-status",
      items: [
        { id: "work-1", statusId: "todo-status", version: 3 },
        { id: "work-2", statusId: "todo-status", version: 1 },
        { id: "work-3", statusId: "todo-status", version: 2 },
      ],
      move: tko_move,
    });

    expect(tko_result).toEqual({ succeededIds: ["work-1", "work-3"], failedIds: ["work-2"], skippedIds: [] });
    expect(tko_move).toHaveBeenCalledTimes(3);
  });

  it("skips an item without a persisted version instead of issuing an unsafe move", async () => {
    const tko_move = vi.fn().mockResolvedValue(undefined);

    const tko_result = await tko_runBulkStatusMove({
      targetStatusId: "done-status",
      items: [{ id: "pending-card", statusId: "todo-status", version: 0 }],
      move: tko_move,
    });

    expect(tko_move).not.toHaveBeenCalled();
    expect(tko_result).toEqual({ succeededIds: [], failedIds: [], skippedIds: ["pending-card"] });
  });
});
