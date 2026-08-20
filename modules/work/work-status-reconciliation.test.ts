import { describe, expect, it } from "vitest";
import { tko_displayWorkflowStatus } from "../../client/src/lib/work-status-reconciliation";

describe("Work status reconciliation", () => {
  it("uses the exact workflow status identity shared by Board and Backlog", () => {
    const tko_statuses = [
      { id: "status-todo", name: "To do" },
      { id: "status-qa", name: "Ready for QA" },
      { id: "status-done", name: "Done" },
    ];

    expect(tko_displayWorkflowStatus("status-qa", tko_statuses, "Unknown status")).toBe("Ready for QA");
  });

  it("keeps a safe fallback until an optimistic or stale item is reconciled", () => {
    expect(tko_displayWorkflowStatus("removed-status", [{ id: "status-todo", name: "To do" }], "Unknown status")).toBe("Unknown status");
  });
});
