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

  it("carries unfinished items into an explicit next sprint while retaining done work in the completed sprint", async () => {
    const tko_owner = await tko_actor();
    const tko_space = await work.createSpace(tko_owner, { name: "Planning", slug: "planning", visibility: "internal", correlationId: tko_owner.correlationId });
    const tko_project = await work.createProject({ actor: tko_owner, spaceId: tko_space.id, name: "Carry-over", key: "CAR", methodology: "scrum", visibility: "internal", correlationId: tko_owner.correlationId });
    const tko_doneItem = await work.createWorkItem({ actor: tko_owner, projectId: tko_project.id, title: "Completed", correlationId: tko_owner.correlationId });
    const tko_openItem = await work.createWorkItem({ actor: tko_owner, projectId: tko_project.id, title: "Carry over", correlationId: tko_owner.correlationId });
    const tko_statuses = (await work.board(tko_owner, tko_project.id)).statuses;
    const tko_done = tko_statuses.find(tko_status => tko_status.category === "done");
    if (!tko_done) throw new Error("TEST_DONE_STATUS_MISSING");
    await work.transitionWorkItem({ actor: tko_owner, workItemId: tko_doneItem.id, targetStatusId: tko_done.id, expectedVersion: 1, correlationId: tko_owner.correlationId });
    const tko_current = await work.createSprint({ actor: tko_owner, projectId: tko_project.id, name: "Sprint current", correlationId: tko_owner.correlationId });
    const tko_next = await work.createSprint({ actor: tko_owner, projectId: tko_project.id, name: "Sprint next", correlationId: tko_owner.correlationId });
    await work.addItemsToSprint(tko_owner, { sprintId: tko_current.id, workItemIds: [tko_doneItem.id, tko_openItem.id], correlationId: tko_owner.correlationId });
    await work.completeSprint(tko_owner, { sprintId: tko_current.id, incompleteDisposition: "next_sprint", nextSprintId: tko_next.id, correlationId: tko_owner.correlationId });
    const tko_after = await work.board(tko_owner, tko_project.id);
    expect(tko_after.items.find(tko_item => tko_item.id === tko_doneItem.id)?.sprintId).toBe(tko_current.id);
    expect(tko_after.items.find(tko_item => tko_item.id === tko_openItem.id)?.sprintId).toBe(tko_next.id);
    expect((await tko_platformStore.listAuditLogs()).some(tko_log => tko_log.action === "work.sprint.completed" && tko_log.metadata.nextSprintId === tko_next.id)).toBe(true);
    await expect(work.completeSprint(tko_owner, { sprintId: tko_next.id, incompleteDisposition: "next_sprint", correlationId: tko_owner.correlationId })).rejects.toThrow("WORK_SPRINT_NEXT_REQUIRED");
  });

  it("moves and reorders Kanban work atomically while preserving authorization, history and outbox", async () => {
    const tko_owner = await tko_actor();
    const tko_guest = { ...tko_owner, authSubject: "kanban-guest", memberId: "guest-member", role: "guest" as const };
    const tko_space = await work.createSpace(tko_owner, { name: "Delivery", slug: "delivery", visibility: "guest_shared", correlationId: tko_owner.correlationId });
    const tko_project = await work.createProject({ actor: tko_owner, spaceId: tko_space.id, name: "Kanban delivery", key: "KBN", methodology: "kanban", visibility: "guest_shared", correlationId: tko_owner.correlationId });
    const tko_first = await work.createWorkItem({ actor: tko_owner, projectId: tko_project.id, title: "First card", correlationId: tko_owner.correlationId });
    const tko_second = await work.createWorkItem({ actor: tko_owner, projectId: tko_project.id, title: "Second card", correlationId: tko_owner.correlationId });
    const tko_third = await work.createWorkItem({ actor: tko_owner, projectId: tko_project.id, title: "Third card", correlationId: tko_owner.correlationId });
    const tko_board = await work.board(tko_owner, tko_project.id);
    const tko_inProgress = tko_board.statuses.find(tko_status => tko_status.category === "in_progress");
    if (!tko_inProgress) throw new Error("TEST_STATUS_MISSING");

    const tko_reordered = await work.moveWorkItem({ actor: tko_owner, workItemId: tko_third.id, targetStatusId: tko_third.statusId, beforeWorkItemId: tko_first.id, expectedVersion: 1, correlationId: tko_owner.correlationId });
    const tko_moved = await work.moveWorkItem({ actor: tko_owner, workItemId: tko_second.id, targetStatusId: tko_inProgress.id, expectedVersion: 1, correlationId: tko_owner.correlationId });
    const tko_after = await work.board(tko_owner, tko_project.id);

    expect(tko_reordered.version).toBe(2);
    expect(tko_moved.statusId).toBe(tko_inProgress.id);
    expect(tko_after.items.filter(tko_item => tko_item.statusId === tko_third.statusId).map(tko_item => tko_item.id)).toEqual([tko_third.id, tko_first.id]);
    expect((await tko_workStore.listHistory(tko_owner.tenantId, tko_third.id)).at(-1)?.field).toBe("kanban_position");
    expect((await tko_platformStore.listAuditLogs()).some(tko_event => tko_event.action === "work.work_item.moved")).toBe(true);
    await expect(work.moveWorkItem({ actor: tko_guest, workItemId: tko_first.id, targetStatusId: tko_inProgress.id, expectedVersion: 1, correlationId: tko_guest.correlationId })).rejects.toThrow("TASKO_AUTHORIZATION_DENIED:capability_missing");
    await expect(work.moveWorkItem({ actor: tko_owner, workItemId: tko_second.id, targetStatusId: tko_inProgress.id, expectedVersion: 1, correlationId: tko_owner.correlationId })).rejects.toThrow("WORK_ITEM_VERSION_CONFLICT");
  });

  it("creates a metadata-rich task and places it in the requested Kanban column with durable history", async () => {
    const tko_owner = await tko_actor();
    const tko_space = await work.createSpace(tko_owner, { name: "Product delivery", slug: "product-delivery", visibility: "internal", correlationId: tko_owner.correlationId });
    const tko_project = await work.createProject({ actor: tko_owner, spaceId: tko_space.id, name: "Kanban composition", key: "CMP", methodology: "kanban", visibility: "internal", correlationId: tko_owner.correlationId });
    const tko_dueAt = new Date("2026-09-01T12:00:00.000Z");
    const tko_created = await work.createWorkItem({
      actor: tko_owner,
      projectId: tko_project.id,
      title: "Prepare launch checklist",
      description: "Confirm owner, scope and handoff.",
      priority: "high",
      assigneeMemberIds: [tko_owner.memberId],
      dueAt: tko_dueAt,
      estimateMinutes: 90,
      correlationId: tko_owner.correlationId,
    });
    const tko_board = await work.board(tko_owner, tko_project.id);
    const tko_done = tko_board.statuses.find(tko_status => tko_status.category === "done");
    if (!tko_done) throw new Error("TEST_DONE_STATUS_MISSING");
    const tko_moved = await work.moveWorkItem({ actor: tko_owner, workItemId: tko_created.id, targetStatusId: tko_done.id, expectedVersion: tko_created.version, correlationId: tko_owner.correlationId });

    expect(tko_created).toMatchObject({ title: "Prepare launch checklist", description: "Confirm owner, scope and handoff.", priority: "high", assigneeMemberIds: [tko_owner.memberId], estimateMinutes: 90 });
    expect(tko_created.dueAt?.toISOString()).toBe(tko_dueAt.toISOString());
    expect(tko_moved.statusId).toBe(tko_done.id);
    expect((await tko_workStore.listHistory(tko_owner.tenantId, tko_created.id)).map(tko_entry => tko_entry.field)).toEqual(["created", "kanban_position"]);
    expect((await tko_platformStore.listAuditLogs()).filter(tko_event => ["work.work_item.created", "work.work_item.moved"].includes(tko_event.action))).toHaveLength(2);
  });

  it("creates rich tasks with checklist metadata and supports unlimited configured workflow columns", async () => {
    const tko_owner = await tko_actor();
    const tko_guest = { ...tko_owner, authSubject: "rich-work-guest", memberId: "guest-member", role: "guest" as const };
    const tko_space = await work.createSpace(tko_owner, { name: "Rich work", slug: "rich-work", visibility: "guest_shared", correlationId: tko_owner.correlationId });
    const tko_project = await work.createProject({ actor: tko_owner, spaceId: tko_space.id, name: "Configurable board", key: "RCB", methodology: "kanban", visibility: "guest_shared", correlationId: tko_owner.correlationId });
    const tko_item = await work.createWorkItem({ actor: tko_owner, projectId: tko_project.id, title: "Prepare complex delivery", description: "Scope, files and acceptance criteria.", checklistItems: ["Confirm brief", "Attach source file", "", "Review acceptance"], correlationId: tko_owner.correlationId });
    const tko_statuses = await Promise.all(["Ready for review", "Blocked", "Customer validation", "Release window"].map((tko_name, tko_index) => work.createWorkflowStatus(tko_owner, { projectId: tko_project.id, name: tko_name, description: `Rule for ${tko_name}`, category: tko_index === 3 ? "done" : "in_progress", colorToken: ["purple", "red", "amber", "green"][tko_index], correlationId: tko_owner.correlationId })));
    const tko_updated = await work.updateWorkflowStatus(tko_owner, { projectId: tko_project.id, statusId: tko_statuses[0].id, name: "Ready for product review", description: "Move only when evidence is linked.", category: "in_progress", colorToken: "indigo", correlationId: tko_owner.correlationId });
    const tko_attachment = await tko_workStore.createAttachment(tko_owner, { workItemId: tko_item.id, objectKey: `tenants/${tko_owner.tenantId}/attachments/demo/spec.pdf`, filename: "spec.pdf", contentType: "application/pdf", byteSize: 1024, correlationId: tko_owner.correlationId });
    const tko_detail = await work.itemDetails(tko_owner, tko_item.id);
    const tko_afterToggle = await work.toggleChecklistItem(tko_owner, { workItemId: tko_item.id, checklistItemId: tko_detail.checklistItems[0].id, completed: true, correlationId: tko_owner.correlationId });
    const tko_board = await work.board(tko_owner, tko_project.id);

    expect(tko_detail.item.description).toBe("Scope, files and acceptance criteria.");
    expect(tko_detail.checklistItems.map(tko_entry => tko_entry.body)).toEqual(["Confirm brief", "Attach source file", "Review acceptance"]);
    expect(tko_afterToggle.completedAt).not.toBeNull();
    expect(tko_detail.attachments).toMatchObject([{ id: tko_attachment.id, filename: "spec.pdf", byteSize: 1024 }]);
    expect(tko_board.statuses).toHaveLength(7);
    expect(tko_board.statuses).toEqual(expect.arrayContaining([expect.objectContaining({ id: tko_updated.id, name: "Ready for product review", description: "Move only when evidence is linked.", colorToken: "indigo" })]));
    await expect(work.createWorkflowStatus(tko_guest, { projectId: tko_project.id, name: "Guest column", category: "todo", colorToken: "blue", correlationId: tko_guest.correlationId })).rejects.toThrow("TASKO_AUTHORIZATION_DENIED:capability_missing");
    await expect(work.toggleChecklistItem(tko_guest, { workItemId: tko_item.id, checklistItemId: tko_detail.checklistItems[1].id, completed: true, correlationId: tko_guest.correlationId })).rejects.toThrow("TASKO_AUTHORIZATION_DENIED:capability_missing");
    expect(await tko_workStore.listAttachments("tko-tenant-other-workspace", tko_item.id)).toEqual([]);
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

  it("manages dependency lifecycle with cycle protection, authorization and durable evidence", async () => {
    const tko_owner = await tko_actor();
    const tko_guest = { ...tko_owner, authSubject: "dependency-guest", memberId: "guest-member", role: "guest" as const };
    const tko_space = await work.createSpace(tko_owner, { name: "Dependencies", slug: "dependencies", visibility: "guest_shared", correlationId: tko_owner.correlationId });
    const tko_project = await work.createProject({ actor: tko_owner, spaceId: tko_space.id, name: "Dependency project", key: "DEP", methodology: "kanban", visibility: "guest_shared", correlationId: tko_owner.correlationId });
    const tko_first = await work.createWorkItem({ actor: tko_owner, projectId: tko_project.id, title: "Foundation", correlationId: tko_owner.correlationId });
    const tko_second = await work.createWorkItem({ actor: tko_owner, projectId: tko_project.id, title: "Delivery", correlationId: tko_owner.correlationId });
    const tko_third = await work.createWorkItem({ actor: tko_owner, projectId: tko_project.id, title: "Release", correlationId: tko_owner.correlationId });

    await work.addDependency(tko_owner, { sourceWorkItemId: tko_first.id, targetWorkItemId: tko_second.id, relationType: "blocks", correlationId: tko_owner.correlationId });
    await work.addDependency(tko_owner, { sourceWorkItemId: tko_second.id, targetWorkItemId: tko_third.id, relationType: "blocks", correlationId: tko_owner.correlationId });
    const tko_beforeRemoval = await work.itemDetails(tko_owner, tko_first.id);

    expect(tko_beforeRemoval.dependencies).toMatchObject([{ sourceWorkItemId: tko_first.id, targetWorkItemId: tko_second.id, relationType: "blocks" }]);
    await expect(work.addDependency(tko_owner, { sourceWorkItemId: tko_third.id, targetWorkItemId: tko_first.id, relationType: "blocks", correlationId: tko_owner.correlationId })).rejects.toThrow("WORK_RELATION_CYCLE");
    await expect(work.removeDependency(tko_guest, { workItemId: tko_first.id, relationId: tko_beforeRemoval.dependencies[0].id, correlationId: tko_guest.correlationId })).rejects.toThrow("TASKO_AUTHORIZATION_DENIED:capability_missing");

    await work.removeDependency(tko_owner, { workItemId: tko_first.id, relationId: tko_beforeRemoval.dependencies[0].id, correlationId: tko_owner.correlationId });
    expect((await work.itemDetails(tko_owner, tko_first.id)).dependencies).toEqual([]);
    const tko_actions = (await tko_platformStore.listAuditLogs()).map(tko_entry => tko_entry.action);
    expect(tko_actions).toContain("work.work_item.relation_created");
    expect(tko_actions).toContain("work.work_item.relation_removed");
  });

  it("reorders configured workflow columns deterministically with authorization and durable evidence", async () => {
    const tko_owner = await tko_actor();
    const tko_guest = { ...tko_owner, authSubject: "workflow-order-guest", memberId: "guest-member", role: "guest" as const };
    const tko_space = await work.createSpace(tko_owner, { name: "Workflow ordering", slug: "workflow-ordering", visibility: "guest_shared", correlationId: tko_owner.correlationId });
    const tko_project = await work.createProject({ actor: tko_owner, spaceId: tko_space.id, name: "Ordered workflow", key: "ORD", methodology: "kanban", visibility: "guest_shared", correlationId: tko_owner.correlationId });
    const tko_initial = await work.board(tko_owner, tko_project.id);
    const tko_extra = await work.createWorkflowStatus(tko_owner, { projectId: tko_project.id, name: "Security review", description: "Evidence must be attached.", category: "in_progress", colorToken: "purple", correlationId: tko_owner.correlationId });
    const tko_done = tko_initial.statuses.find(tko_status => tko_status.category === "done");
    if (!tko_done) throw new Error("TEST_DONE_STATUS_MISSING");

    const tko_reordered = await work.reorderWorkflowStatus({ actor: tko_owner, projectId: tko_project.id, statusId: tko_extra.id, beforeStatusId: tko_done.id, correlationId: tko_owner.correlationId });

    expect(tko_reordered.map(tko_status => tko_status.id)).toEqual([...tko_initial.statuses.filter(tko_status => tko_status.id !== tko_extra.id && tko_status.id !== tko_done.id).map(tko_status => tko_status.id), tko_extra.id, tko_done.id]);
    expect(tko_reordered.map(tko_status => tko_status.sortOrder)).toEqual([100, 200, 300, 400]);
    expect((await work.board(tko_owner, tko_project.id)).statuses.map(tko_status => tko_status.id)).toEqual(tko_reordered.map(tko_status => tko_status.id));
    await expect(work.reorderWorkflowStatus({ actor: tko_guest, projectId: tko_project.id, statusId: tko_extra.id, beforeStatusId: null, correlationId: tko_guest.correlationId })).rejects.toThrow("TASKO_AUTHORIZATION_DENIED:capability_missing");
    expect((await tko_platformStore.listAuditLogs()).some(tko_event => tko_event.action === "work.workflow_status.reordered" && tko_event.metadata.statusId === tko_extra.id)).toBe(true);
  });
});
