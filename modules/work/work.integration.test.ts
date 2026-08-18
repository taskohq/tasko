import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MemoryPlatformStore, setPlatformStoreForTests } from "../../packages/database/src/platform-store";
import { getRedisAdapter } from "../../packages/redis/src/redis-adapter";
import { MemoryWorkStore, setWorkStoreForTests } from "../../packages/database/src/work-store";
import { resolveTenantRequestContext } from "../tenancy/src/tenant-context";
import { processOutboxOnce } from "../worker/src/worker-service";
import * as work from "./src/work-service";

const tko_ownerSubject = "work-owner";
const tko_otherSubject = "work-other-owner";

describe("Work Alpha acceptance boundaries", () => {
  let tko_platformStore: MemoryPlatformStore;
  let tko_workStore: MemoryWorkStore;

  beforeEach(async () => {
    tko_platformStore = new MemoryPlatformStore();
    tko_workStore = new MemoryWorkStore();
    setPlatformStoreForTests(tko_platformStore);
    setWorkStoreForTests(tko_workStore);
    await tko_platformStore.seedDemoWorkspace({ ownerAuthSubject: tko_ownerSubject, tenantSlug: "tasko-demo" });
    await tko_platformStore.seedDemoWorkspace({ ownerAuthSubject: tko_otherSubject, tenantSlug: "other-workspace" });
  });

  afterEach(() => {
    setPlatformStoreForTests(null);
    setWorkStoreForTests(null);
  });

  async function tko_actor(tko_subject = tko_ownerSubject, tko_slug = "tasko-demo") {
    const tko_context = await resolveTenantRequestContext({ authSubject: tko_subject, candidateTenantSlug: tko_slug, correlationId: `test:${tko_subject}` });
    if (!tko_context) throw new Error("TEST_ACTOR_MISSING");
    return tko_context.actor;
  }

  it("delivers the board + sprint acceptance flow with stable project keys and durable history", async () => {
    const tko_owner = await tko_actor();
    const tko_space = await work.createSpace(tko_owner, { name: "Product", slug: "product", visibility: "internal", correlationId: tko_owner.correlationId });
    const tko_project = await work.createProject({ actor: tko_owner, spaceId: tko_space.id, name: "Work Alpha", key: "WA", methodology: "scrum", visibility: "internal", correlationId: tko_owner.correlationId });
    const tko_item = await work.createWorkItem({ actor: tko_owner, projectId: tko_project.id, title: "Launch board", priority: "high", correlationId: tko_owner.correlationId });
    const tko_board = await work.board(tko_owner, tko_project.id);
    const tko_inProgress = tko_board.statuses.find(tko_status => tko_status.category === "in_progress");
    if (!tko_inProgress) throw new Error("TEST_STATUS_MISSING");
    const tko_transitioned = await work.transitionWorkItem({ actor: tko_owner, workItemId: tko_item.id, targetStatusId: tko_inProgress.id, expectedVersion: 1, correlationId: tko_owner.correlationId });
    const tko_sprint = await work.createSprint({ actor: tko_owner, projectId: tko_project.id, name: "Sprint 1", goal: "Board flow", correlationId: tko_owner.correlationId });
    await work.addItemsToSprint(tko_owner, { sprintId: tko_sprint.id, workItemIds: [tko_item.id], correlationId: tko_owner.correlationId });

    expect(tko_item.key).toBe("WA-1");
    expect(tko_board.statuses.map(tko_status => tko_status.name)).toEqual(["To do", "In progress", "Done"]);
    expect(tko_transitioned.version).toBe(2);
    expect((await tko_workStore.listHistory(tko_owner.tenantId, tko_item.id)).map(tko_entry => tko_entry.field)).toEqual(["created", "status_id"]);
    expect((await tko_platformStore.listAuditLogs()).filter(tko_event => tko_event.action.startsWith("work."))).toHaveLength(6);
    expect((await work.board(tko_owner, tko_project.id)).items[0]?.sprintId).toBe(tko_sprint.id);
  });

  it("does not expose another tenant's project or work item", async () => {
    const tko_owner = await tko_actor();
    const tko_other = {
      ...tko_owner,
      authSubject: tko_otherSubject,
      tenantId: "tko-tenant-other-workspace",
      tenantSlug: "other-workspace",
      memberId: "tko-member-demo-owner",
      correlationId: "test:work-other-owner",
    };
    const tko_space = await work.createSpace(tko_owner, { name: "Product", slug: "product", visibility: "internal", correlationId: tko_owner.correlationId });
    const tko_project = await work.createProject({ actor: tko_owner, spaceId: tko_space.id, name: "Work Alpha", key: "WA", methodology: "kanban", visibility: "internal", correlationId: tko_owner.correlationId });
    const tko_item = await work.createWorkItem({ actor: tko_owner, projectId: tko_project.id, title: "Private tenant issue", correlationId: tko_owner.correlationId });

    await expect(work.board(tko_other, tko_project.id)).rejects.toThrow("WORK_PROJECT_NOT_FOUND");
    await expect(work.transitionWorkItem({ actor: tko_other, workItemId: tko_item.id, targetStatusId: "00000000-0000-0000-0000-000000000001", expectedVersion: 1, correlationId: tko_other.correlationId })).rejects.toThrow("WORK_ITEM_NOT_FOUND");
  });

  it("rejects a guest's workflow transition while permitting only granted reading", async () => {
    const tko_owner = await tko_actor();
    const tko_guest = { ...tko_owner, authSubject: "guest-user", memberId: "guest-member", role: "guest" as const };
    const tko_space = await work.createSpace(tko_owner, { name: "Product", slug: "product", visibility: "guest_shared", correlationId: tko_owner.correlationId });
    const tko_project = await work.createProject({ actor: tko_owner, spaceId: tko_space.id, name: "Work Alpha", key: "WA", methodology: "kanban", visibility: "guest_shared", correlationId: tko_owner.correlationId });
    const tko_item = await work.createWorkItem({ actor: tko_owner, projectId: tko_project.id, title: "Review only", correlationId: tko_owner.correlationId });
    const tko_board = await work.board(tko_owner, tko_project.id);

    await expect(work.transitionWorkItem({ actor: tko_guest, workItemId: tko_item.id, targetStatusId: tko_board.statuses[1].id, expectedVersion: 1, correlationId: tko_guest.correlationId })).rejects.toThrow("TASKO_AUTHORIZATION_DENIED:capability_missing");
  });

  it("completes a ten-item sprint and publishes board changes only to the tenant channel", async () => {
    const tko_owner = await tko_actor();
    const tko_receivedEvents: string[] = [];
    const tko_unsubscribe = await getRedisAdapter().subscribeTenant(tko_owner.tenantId, tko_event => tko_receivedEvents.push(tko_event.eventType));
    const tko_space = await work.createSpace(tko_owner, { name: "Engineering", slug: "engineering", visibility: "internal", correlationId: tko_owner.correlationId });
    const tko_project = await work.createProject({ actor: tko_owner, spaceId: tko_space.id, name: "Sprint project", key: "ENG", methodology: "scrum", visibility: "internal", correlationId: tko_owner.correlationId });
    const tko_items = [];
    for (let tko_index = 0; tko_index < 10; tko_index += 1) {
      tko_items.push(await work.createWorkItem({ actor: tko_owner, projectId: tko_project.id, title: `Sprint item ${tko_index + 1}`, correlationId: tko_owner.correlationId }));
    }
    const tko_board = await work.board(tko_owner, tko_project.id);
    const tko_done = tko_board.statuses.find(tko_status => tko_status.category === "done");
    if (!tko_done) throw new Error("TEST_DONE_STATUS_MISSING");
    for (const tko_item of tko_items.slice(0, 7)) {
      await work.transitionWorkItem({ actor: tko_owner, workItemId: tko_item.id, targetStatusId: tko_done.id, expectedVersion: 1, correlationId: tko_owner.correlationId });
    }
    const tko_sprint = await work.createSprint({ actor: tko_owner, projectId: tko_project.id, name: "Sprint acceptance", correlationId: tko_owner.correlationId });
    await work.addItemsToSprint(tko_owner, { sprintId: tko_sprint.id, workItemIds: tko_items.map(tko_item => tko_item.id), correlationId: tko_owner.correlationId });
    await work.completeSprint(tko_owner, { sprintId: tko_sprint.id, incompleteDisposition: "backlog", correlationId: tko_owner.correlationId });

    await processOutboxOnce(100);
    const tko_resultBoard = await work.board(tko_owner, tko_project.id);
    expect(tko_resultBoard.items.filter(tko_item => tko_item.sprintId === tko_sprint.id)).toHaveLength(7);
    expect(tko_resultBoard.items.filter(tko_item => tko_item.sprintId === null)).toHaveLength(3);
    expect(tko_receivedEvents).toContain("work.work_item_status_changed.v1");
    expect(tko_receivedEvents).toContain("work.sprint_completed.v1");
    await tko_unsubscribe();
  });

  it("keeps custom fields tenant and project scoped while rejecting guest administration", async () => {
    const tko_owner = await tko_actor();
    const tko_guest = { ...tko_owner, authSubject: "demo-guest:tasko-demo", memberId: "guest-member", role: "guest" as const };
    const tko_space = await work.createSpace(tko_owner, { name: "Design", slug: "design", visibility: "guest_shared", correlationId: tko_owner.correlationId });
    const tko_project = await work.createProject({ actor: tko_owner, spaceId: tko_space.id, name: "Field project", key: "FLD", methodology: "kanban", visibility: "guest_shared", correlationId: tko_owner.correlationId });
    const tko_item = await work.createWorkItem({ actor: tko_owner, projectId: tko_project.id, title: "Record research confidence", correlationId: tko_owner.correlationId });
    const tko_field = await work.createCustomField(tko_owner, { projectId: tko_project.id, name: "Confidence", fieldType: "number", correlationId: tko_owner.correlationId });
    await work.setCustomFieldValue(tko_owner, { workItemId: tko_item.id, fieldId: tko_field.id, value: 82, correlationId: tko_owner.correlationId });

    expect(await work.customFields(tko_owner, tko_project.id)).toMatchObject([{ id: tko_field.id, name: "Confidence", fieldType: "number" }]);
    expect((await work.itemDetails(tko_owner, tko_item.id)).customValues).toMatchObject([{ fieldId: tko_field.id, value: 82 }]);
    await expect(work.createCustomField(tko_guest, { projectId: tko_project.id, name: "Nope", fieldType: "text", correlationId: tko_guest.correlationId })).rejects.toThrow("TASKO_AUTHORIZATION_DENIED:capability_missing");
    await expect(work.setCustomFieldValue(tko_owner, { workItemId: tko_item.id, fieldId: "00000000-0000-0000-0000-000000000001", value: 1, correlationId: tko_owner.correlationId })).rejects.toThrow("WORK_CUSTOM_FIELD_NOT_FOUND");
  });
});
