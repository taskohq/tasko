import { describe, expect, it } from "vitest";
import { tko_addOptimistic, tko_applyOptimisticMove, tko_removeOptimistic, tko_runOptimisticCreate } from "../../client/src/lib/kanban-optimistic";

describe("Kanban optimistic create helpers", () => {
  it("adds a temporary card immediately and removes only that card after server reconciliation", () => {
    const tko_pending = { id: "optimistic:create-1", title: "Create release notes" };
    const tko_before = [{ id: "WI-1", title: "Existing work" }];
    const tko_withPending = tko_addOptimistic(tko_before, tko_pending);

    expect(tko_withPending).toEqual([...tko_before, tko_pending]);
    expect(tko_removeOptimistic(tko_withPending, tko_pending.id)).toEqual(tko_before);
  });

  it("rolls back a failed create without removing other concurrent pending cards", () => {
    const tko_first = { id: "optimistic:create-1", title: "First" };
    const tko_second = { id: "optimistic:create-2", title: "Second" };
    const tko_withPending = tko_addOptimistic(tko_addOptimistic([], tko_first), tko_second);

    expect(tko_removeOptimistic(tko_withPending, tko_first.id)).toEqual([tko_second]);
  });

  it("moves the dragged card to its target column immediately and preserves the requested before-card order", () => {
    const tko_before = [
      { id: "WI-1", statusId: "todo" },
      { id: "WI-2", statusId: "in_progress" },
      { id: "WI-3", statusId: "in_progress" },
    ];

    const tko_moved = tko_applyOptimisticMove(tko_before, "WI-1", "in_progress", "WI-3");
    expect(tko_moved.find(tko_item => tko_item.id === "WI-1")).toMatchObject({ statusId: "in_progress", tkoOptimisticOrder: 1 });
    expect(tko_moved.find(tko_item => tko_item.id === "WI-2")).toMatchObject({ tkoOptimisticOrder: 0 });
    expect(tko_moved.find(tko_item => tko_item.id === "WI-3")).toMatchObject({ tkoOptimisticOrder: 2 });
    expect(tko_before[0]?.statusId).toBe("todo");
  });

  it("inserts a pending card before create resolves, then rolls it back when create fails", async () => {
    const tko_events: string[] = [];
    const tko_result = await tko_runOptimisticCreate({
      onOptimistic: () => tko_events.push("pending"),
      onRollback: () => tko_events.push("rollback"),
      onReconciled: () => tko_events.push("reconciled"),
      create: async () => { throw new Error("CREATE_FAILED"); },
      shouldMove: () => false,
      move: async () => ({ id: "never" }),
    });

    expect(tko_result).toEqual({ outcome: "create-failed" });
    expect(tko_events).toEqual(["pending", "rollback"]);
  });

  it("rolls back the pending card but retains the server-created task when move fails", async () => {
    const tko_events: string[] = [];
    const tko_created = { id: "WI-33", statusId: "todo" };
    const tko_result = await tko_runOptimisticCreate({
      onOptimistic: () => tko_events.push("pending"),
      onRollback: () => tko_events.push("rollback"),
      onReconciled: () => tko_events.push("reconciled"),
      create: async () => tko_created,
      shouldMove: () => true,
      move: async () => { throw new Error("MOVE_FAILED"); },
    });

    expect(tko_result).toEqual({ outcome: "move-failed", created: tko_created });
    expect(tko_events).toEqual(["pending", "rollback"]);
  });

  it("reconciles the temporary card after create and move both succeed", async () => {
    const tko_events: string[] = [];
    const tko_result = await tko_runOptimisticCreate({
      onOptimistic: () => tko_events.push("pending"),
      onRollback: () => tko_events.push("rollback"),
      onReconciled: () => tko_events.push("reconciled"),
      create: async () => ({ id: "WI-34", statusId: "todo" }),
      shouldMove: () => true,
      move: async tko_created => ({ ...tko_created, statusId: "done", version: 2 }),
    });

    expect(tko_result).toEqual({ outcome: "success", item: { id: "WI-34", statusId: "done", version: 2 } });
    expect(tko_events).toEqual(["pending", "reconciled"]);
  });
});
