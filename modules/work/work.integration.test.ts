import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MemoryPlatformStore, setPlatformStoreForTests } from "../../packages/database/src/platform-store";
import { getRedisAdapter } from "../../packages/redis/src/redis-adapter";
import { MemoryWorkStore, setWorkStoreForTests } from "../../packages/database/src/work-store";
import { getWorkspaceStore, MemoryWorkspaceStore, setWorkspaceStoreForTests } from "../../packages/database/src/workspace-store";
import { resolveTenantRequestContext } from "../tenancy/src/tenant-context";
import { processOutboxOnce } from "../worker/src/worker-service";
import * as work from "./src/work-service";
import { registerWorkRealtimeWorker } from "./src/work-realtime-worker";
import { registerWorkspaceWorker } from "../workspace/src/workspace-worker";
import * as workspaceMembership from "../workspace/src/workspace-membership-service";

const tko_ownerSubject = "work-owner";
const tko_otherSubject = "work-other-owner";

describe("Work Alpha acceptance boundaries", () => {
  let tko_platformStore: MemoryPlatformStore;
  let tko_workStore: MemoryWorkStore;
  let tko_workspaceStore: MemoryWorkspaceStore;

  beforeEach(async () => {
    tko_platformStore = new MemoryPlatformStore();
    tko_workStore = new MemoryWorkStore();
    tko_workspaceStore = new MemoryWorkspaceStore();
    setPlatformStoreForTests(tko_platformStore);
    setWorkStoreForTests(tko_workStore);
    setWorkspaceStoreForTests(tko_workspaceStore);
    registerWorkRealtimeWorker();
    registerWorkspaceWorker();
    await tko_platformStore.seedDemoWorkspace({ ownerAuthSubject: tko_ownerSubject, tenantSlug: "tasko-demo" });
    await tko_platformStore.seedDemoWorkspace({ ownerAuthSubject: tko_otherSubject, tenantSlug: "other-workspace" });
  });

  afterEach(() => {
    setPlatformStoreForTests(null);
    setWorkStoreForTests(null);
    setWorkspaceStoreForTests(null);
  });

  async function tko_actor(tko_subject = tko_ownerSubject, tko_slug = "tasko-demo") {
    const tko_context = await resolveTenantRequestContext({ authSubject: tko_subject, candidateTenantSlug: tko_slug, correlationId: `test:${tko_subject}` });
    if (!tko_context) throw new Error("TEST_ACTOR_MISSING");
    return tko_context.actor;
  }

  it("materializes a durable notification for an active assignee after an outbox-backed board change", async () => {
    const tko_owner = await tko_actor();
    const tko_space = await work.createSpace(tko_owner, { name: "Notifications", slug: "notifications", visibility: "internal", correlationId: tko_owner.correlationId });
    const tko_project = await work.createProject({ actor: tko_owner, spaceId: tko_space.id, name: "Notifications", key: "NOT", methodology: "kanban", visibility: "internal", correlationId: tko_owner.correlationId });
    const tko_nonRecipientActor = { ...tko_owner, authSubject: "work-board-collaborator", memberId: "tko-member-collaborator", correlationId: "test:work-notification" };
    const tko_item = await work.createWorkItem({ actor: tko_nonRecipientActor, projectId: tko_project.id, title: "Notify assignee", assigneeMemberIds: [tko_owner.memberId], correlationId: tko_nonRecipientActor.correlationId });

    await processOutboxOnce(50);

    const tko_inbox = await getWorkspaceStore().listInbox(tko_owner.tenantId, tko_owner.memberId);
    expect(tko_inbox).toEqual(expect.arrayContaining([expect.objectContaining({ entityId: tko_item.id, kind: "assignment", sourceEventId: expect.any(String) })]));
    expect((await tko_platformStore.listAuditLogs()).some(tko_entry => tko_entry.action === "workspace.inbox.item_created")).toBe(true);
    expect((await tko_platformStore.listOutbox()).some(tko_entry => tko_entry.eventType === "workspace.inbox_item_created.v1")).toBe(true);
  });

  it("notifies active project members for @mentions and comment authors for reactions through idempotent outbox delivery", async () => {
    const tko_owner = await tko_actor();
    const tko_invitation = await workspaceMembership.createWorkspaceInvitation({ actor: tko_owner, email: "collaborator@example.test", role: "member", correlationId: "work-notification-member" });
    const tko_member = await workspaceMembership.redeemWorkspaceInvitation({ authSubject: "work-collaborator", email: "collaborator@example.test", displayName: "Alex Collaborator", token: tko_invitation.token, correlationId: "work-notification-member-redeem" });
    const tko_collaborator = await tko_actor("work-collaborator");
    const tko_space = await work.createSpace(tko_owner, { name: "Collaboration", slug: "collaboration", visibility: "internal", correlationId: tko_owner.correlationId });
    const tko_project = await work.createProject({ actor: tko_owner, spaceId: tko_space.id, name: "Collaboration", key: "COL", methodology: "kanban", visibility: "internal", correlationId: tko_owner.correlationId });
    await work.upsertProjectMember(tko_owner, { projectId: tko_project.id, memberId: tko_member.membership.id, projectRole: "editor", correlationId: tko_owner.correlationId });
    const tko_item = await work.createWorkItem({ actor: tko_owner, projectId: tko_project.id, title: "Review comment", correlationId: tko_owner.correlationId });
    const tko_comment = await work.createComment({ actor: tko_owner, workItemId: tko_item.id, body: "@Alex Collaborator please review this update.", correlationId: tko_owner.correlationId });
    await work.toggleCommentReaction(tko_collaborator, { workItemId: tko_item.id, commentId: tko_comment.id, emoji: "👍", correlationId: tko_collaborator.correlationId });
    await work.toggleCommentReaction(tko_owner, { workItemId: tko_item.id, commentId: tko_comment.id, emoji: "👀", correlationId: tko_owner.correlationId });

    await processOutboxOnce(100);
    const tko_collaboratorInbox = await getWorkspaceStore().listInbox(tko_owner.tenantId, tko_collaborator.memberId);
    const tko_ownerInbox = await getWorkspaceStore().listInbox(tko_owner.tenantId, tko_owner.memberId);
    expect(tko_collaboratorInbox).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "mention", entityId: tko_item.id })]));
    expect(tko_ownerInbox.filter(tko_entry => tko_entry.kind === "comment" && tko_entry.entityId === tko_item.id)).toHaveLength(1);
    expect((await tko_platformStore.listOutbox()).map(tko_entry => tko_entry.eventType)).toEqual(expect.arrayContaining(["work.comment_created.v1", "work.comment_reaction_added.v1", "workspace.inbox_item_created.v1"]));
  });

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
    expect((await work.board(tko_owner, tko_project.id)).latestStatusChangeByWorkItemId[tko_item.id]).toEqual(expect.objectContaining({ actorMemberId: tko_owner.memberId, actorDisplayName: expect.any(String), changedAt: expect.any(Date) }));
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

  it("starts one durable sprint and exposes project-scoped overview and custom search", async () => {
    const tko_owner = await tko_actor();
    const tko_guest = { ...tko_owner, authSubject: "pm-guest", memberId: "guest-member", role: "guest" as const };
    const tko_space = await work.createSpace(tko_owner, { name: "Project management", slug: "project-management", visibility: "guest_shared", correlationId: tko_owner.correlationId });
    const tko_project = await work.createProject({ actor: tko_owner, spaceId: tko_space.id, name: "Searchable delivery", key: "PM", methodology: "scrum", visibility: "guest_shared", correlationId: tko_owner.correlationId });
    const tko_item = await work.createWorkItem({ actor: tko_owner, projectId: tko_project.id, title: "Plan release discovery", description: "Find project-management acceptance evidence.", assigneeMemberIds: [tko_owner.memberId], estimateMinutes: 120, correlationId: tko_owner.correlationId });
    const tko_attachment = await tko_workStore.createAttachment(tko_owner, { workItemId: tko_item.id, objectKey: `tenants/${tko_owner.tenantId}/attachments/release-notes.pdf`, filename: "release-notes.pdf", contentType: "application/pdf", byteSize: 512, correlationId: tko_owner.correlationId });
    const tko_scheduled = await work.updateWorkItem({ actor: tko_owner, workItemId: tko_item.id, expectedVersion: tko_item.version, startAt: new Date("2026-08-25T12:00:00.000Z"), dueAt: new Date("2026-08-29T12:00:00.000Z"), correlationId: tko_owner.correlationId });
    const tko_sprint = await work.createSprint({ actor: tko_owner, projectId: tko_project.id, name: "Release planning", goal: "Prove the project overview", correlationId: tko_owner.correlationId });
    const tko_secondSprint = await work.createSprint({ actor: tko_owner, projectId: tko_project.id, name: "Follow-up", correlationId: tko_owner.correlationId });

    const tko_started = await work.startSprint(tko_owner, { projectId: tko_project.id, sprintId: tko_sprint.id, correlationId: tko_owner.correlationId });
    const tko_overview = await work.overview(tko_owner, tko_project.id);
    const tko_results = await work.searchProject(tko_owner, { projectId: tko_project.id, query: "release" });
    const tko_ownerDisplayName = (await tko_platformStore.listTenantMembers(tko_owner.tenantId)).find(tko_member => tko_member.id === tko_owner.memberId)?.displayName;
    const tko_memberResults = await work.searchProject(tko_owner, { projectId: tko_project.id, query: tko_ownerDisplayName ?? "" });
    const tko_projectFiles = await work.projectFiles(tko_owner, tko_project.id);

    expect(tko_started).toEqual(expect.objectContaining({ id: tko_sprint.id, state: "active", startAt: expect.any(Date) }));
    expect(tko_overview).toEqual(expect.objectContaining({ projectId: tko_project.id, totalItems: 1, backlogItems: 1, activeSprint: expect.objectContaining({ id: tko_sprint.id }) }));
    expect(tko_overview.workload).toEqual(expect.arrayContaining([expect.objectContaining({ memberId: tko_owner.memberId, assignedItems: 1, estimatedMinutes: 120 })]));
    expect(tko_results).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "work_item", id: tko_item.id }), expect.objectContaining({ kind: "sprint", id: tko_sprint.id }), expect.objectContaining({ kind: "file", id: tko_attachment.id, workItemId: tko_item.id })]));
    expect(tko_memberResults).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "member", id: tko_owner.memberId })]));
    expect(tko_scheduled).toEqual(expect.objectContaining({ id: tko_item.id, startAt: new Date("2026-08-25T12:00:00.000Z"), dueAt: new Date("2026-08-29T12:00:00.000Z") }));
    expect(tko_projectFiles).toEqual(expect.arrayContaining([expect.objectContaining({ id: tko_attachment.id, workItemId: tko_item.id, workItemKey: tko_item.key, filename: "release-notes.pdf" })]));
    await expect(work.updateWorkItem({ actor: tko_owner, workItemId: tko_item.id, expectedVersion: tko_scheduled.version, startAt: new Date("2026-09-01T12:00:00.000Z"), dueAt: new Date("2026-08-29T12:00:00.000Z"), correlationId: tko_owner.correlationId })).rejects.toThrow("WORK_ITEM_DATE_RANGE_INVALID");
    await expect(work.startSprint(tko_owner, { projectId: tko_project.id, sprintId: tko_secondSprint.id, correlationId: tko_owner.correlationId })).rejects.toThrow("WORK_SPRINT_ACTIVE_EXISTS");
    await expect(work.startSprint(tko_guest, { projectId: tko_project.id, sprintId: tko_secondSprint.id, correlationId: tko_guest.correlationId })).rejects.toThrow("TASKO_AUTHORIZATION_DENIED:capability_missing");
    expect((await tko_platformStore.listAuditLogs()).some(tko_event => tko_event.action === "work.sprint.started" && tko_event.metadata.sprintId === tko_sprint.id)).toBe(true);
    expect((await tko_platformStore.listOutbox()).some(tko_event => tko_event.eventType === "work.sprint_started.v1" && tko_event.payload.sprintId === tko_sprint.id)).toBe(true);
  });

  it("projects tenant-safe My Work, Ops Update and Calendar read models without durable writes", async () => {
    const tko_owner = await tko_actor();
    const tko_otherTenant = { ...tko_owner, authSubject: tko_otherSubject, tenantId: "tko-tenant-other-workspace", tenantSlug: "other-workspace", memberId: "tko-member-other-workspace-owner", correlationId: "test:work-views-other-tenant" };
    const tko_space = await work.createSpace(tko_owner, { name: "Operating cadence", slug: "operating-cadence", visibility: "internal", correlationId: tko_owner.correlationId });
    const tko_project = await work.createProject({ actor: tko_owner, spaceId: tko_space.id, name: "Service operations", key: "OPS", methodology: "kanban", visibility: "internal", correlationId: tko_owner.correlationId });
    const tko_item = await work.createWorkItem({ actor: tko_owner, projectId: tko_project.id, title: "Review service health", assigneeMemberIds: [tko_owner.memberId], correlationId: tko_owner.correlationId });
    const tko_startAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const tko_dueAt = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
    await work.updateWorkItem({ actor: tko_owner, workItemId: tko_item.id, expectedVersion: tko_item.version, startAt: tko_startAt, dueAt: tko_dueAt, correlationId: tko_owner.correlationId });
    const tko_auditBefore = (await tko_platformStore.listAuditLogs()).length;
    const tko_outboxBefore = (await tko_platformStore.listOutbox()).length;

    const tko_myWork = await work.myWork(tko_owner, { due: "soon" });
    const tko_opsUpdate = await work.opsUpdate(tko_owner, { since: new Date(Date.now() - 24 * 60 * 60 * 1000) });
    const tko_calendar = await work.calendar(tko_owner, { startAt: new Date(Date.now()), endAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) });

    expect(tko_myWork).toEqual(expect.arrayContaining([expect.objectContaining({ workItemId: tko_item.id, projectId: tko_project.id, statusName: expect.any(String) })]));
    expect(tko_opsUpdate).toEqual(expect.arrayContaining([expect.objectContaining({ workItemId: tko_item.id, actorMemberId: tko_owner.memberId, field: "fields" })]));
    expect(tko_calendar).toEqual(expect.arrayContaining([expect.objectContaining({ workItemId: tko_item.id, startAt: tko_startAt, dueAt: tko_dueAt })]));
    const tko_otherTenantWorkItemIds = (await work.myWork(tko_otherTenant, { due: "all" })).map(tko_entry => tko_entry.workItemId);
    expect(tko_otherTenantWorkItemIds).not.toContain(tko_item.id);
    await expect(work.calendar(tko_owner, { startAt: tko_dueAt, endAt: tko_startAt })).rejects.toThrow("WORK_CALENDAR_RANGE_INVALID");
    await expect(work.opsUpdate(tko_owner, { since: new Date(Date.now() - 32 * 24 * 60 * 60 * 1000) })).rejects.toThrow("WORK_OPS_UPDATE_RANGE_INVALID");
    expect((await tko_platformStore.listAuditLogs()).length).toBe(tko_auditBefore);
    expect((await tko_platformStore.listOutbox()).length).toBe(tko_outboxBefore);
  });

  it("creates visible task comments and archives a task without bypassing RBAC, history or outbox", async () => {
    const tko_owner = await tko_actor();
    const tko_otherTenant = { ...tko_owner, authSubject: tko_otherSubject, tenantId: "tko-tenant-other-workspace", tenantSlug: "other-workspace", memberId: "tko-member-demo-owner", correlationId: "test:archive-other-tenant" };
    const tko_guest = { ...tko_owner, authSubject: "archive-guest", memberId: "archive-guest-member", role: "guest" as const, correlationId: "test:archive-guest" };
    const tko_space = await work.createSpace(tko_owner, { name: "Operations", slug: "operations", visibility: "guest_shared", correlationId: tko_owner.correlationId });
    const tko_project = await work.createProject({ actor: tko_owner, spaceId: tko_space.id, name: "Incident response", key: "INC", methodology: "kanban", visibility: "guest_shared", correlationId: tko_owner.correlationId });
    const tko_item = await work.createWorkItem({ actor: tko_owner, projectId: tko_project.id, title: "Document the handoff", correlationId: tko_owner.correlationId });

    const tko_comment = await work.createComment({ actor: tko_owner, workItemId: tko_item.id, body: "The on-call handoff is complete.", correlationId: tko_owner.correlationId });
    expect((await work.itemDetails(tko_owner, tko_item.id)).comments).toEqual(expect.arrayContaining([expect.objectContaining({ id: tko_comment.id, body: "The on-call handoff is complete.", authorMemberId: tko_owner.memberId })]));
    expect((await tko_platformStore.listOutbox()).some(tko_event => tko_event.eventType === "work.comment_created.v1" && tko_event.payload.commentId === tko_comment.id)).toBe(true);

    await expect(work.archiveWorkItem({ actor: tko_guest, workItemId: tko_item.id, expectedVersion: tko_item.version, correlationId: tko_guest.correlationId })).rejects.toThrow("TASKO_AUTHORIZATION_DENIED:capability_missing");
    await expect(work.archiveWorkItem({ actor: tko_otherTenant, workItemId: tko_item.id, expectedVersion: tko_item.version, correlationId: tko_otherTenant.correlationId })).rejects.toThrow("WORK_ITEM_NOT_FOUND");
    await expect(work.archiveWorkItem({ actor: tko_owner, workItemId: tko_item.id, expectedVersion: tko_item.version + 1, correlationId: tko_owner.correlationId })).rejects.toThrow("WORK_ITEM_VERSION_CONFLICT");

    const tko_archived = await work.archiveWorkItem({ actor: tko_owner, workItemId: tko_item.id, expectedVersion: tko_item.version, correlationId: tko_owner.correlationId });
    expect(tko_archived).toEqual(expect.objectContaining({ id: tko_item.id, archivedAt: expect.any(Date), version: 2 }));
    expect((await work.board(tko_owner, tko_project.id)).items.map(tko_entry => tko_entry.id)).not.toContain(tko_item.id);
    await expect(work.itemDetails(tko_owner, tko_item.id)).rejects.toThrow("WORK_ITEM_NOT_FOUND");
    expect((await tko_workStore.listHistory(tko_owner.tenantId, tko_item.id)).at(-1)).toEqual(expect.objectContaining({ field: "archived", before: false, after: true, actorMemberId: tko_owner.memberId }));
    expect((await tko_platformStore.listAuditLogs()).some(tko_event => tko_event.action === "work.work_item.archived" && tko_event.resourceId === tko_item.id)).toBe(true);
    expect((await tko_platformStore.listOutbox()).some(tko_event => tko_event.eventType === "work.work_item_archived.v1" && tko_event.payload.workItemId === tko_item.id)).toBe(true);
  });

  it("shares private projects through explicit project roles while preserving viewer limits, admin control, audit/outbox and tenant isolation", async () => {
    const tko_owner = await tko_actor();
    const tko_member = await tko_actor("demo-member:tasko-demo");
    const tko_admin = await tko_actor("demo-admin:tasko-demo");
    const tko_otherTenant = { ...tko_owner, authSubject: tko_otherSubject, tenantId: "tko-tenant-other-workspace", tenantSlug: "other-workspace", memberId: "tko-member-other-workspace-owner", correlationId: "test:project-sharing-other-tenant" };
    const tko_space = await work.createSpace(tko_owner, { name: "Secure delivery", slug: "secure-delivery", visibility: "internal", correlationId: tko_owner.correlationId });
    const tko_project = await work.createProject({ actor: tko_owner, spaceId: tko_space.id, name: "Private launch", key: "PRIV", methodology: "kanban", visibility: "private", correlationId: tko_owner.correlationId });
    const tko_item = await work.createWorkItem({ actor: tko_owner, projectId: tko_project.id, title: "Owner-only initial task", correlationId: tko_owner.correlationId });

    expect((await work.projects(tko_member)).map(tko_entry => tko_entry.id)).not.toContain(tko_project.id);
    await expect(work.board(tko_member, tko_project.id)).rejects.toThrow("TASKO_AUTHORIZATION_DENIED:private_resource");
    await expect(work.updateProjectVisibility(tko_member, { projectId: tko_project.id, visibility: "internal", correlationId: tko_member.correlationId })).rejects.toThrow("TASKO_AUTHORIZATION_DENIED:capability_missing");
    await expect(work.upsertProjectMember(tko_otherTenant, { projectId: tko_project.id, memberId: tko_member.memberId, projectRole: "viewer", correlationId: tko_otherTenant.correlationId })).rejects.toThrow("WORK_PROJECT_NOT_FOUND");

    await work.upsertProjectMember(tko_owner, { projectId: tko_project.id, memberId: tko_member.memberId, projectRole: "viewer", correlationId: tko_owner.correlationId });
    const tko_roster = await work.projectMembers(tko_owner, tko_project.id);
    expect(tko_roster).toEqual(expect.arrayContaining([expect.objectContaining({ id: tko_owner.memberId, isOwner: true, projectRole: "editor" }), expect.objectContaining({ id: tko_member.memberId, isProjectMember: true, projectRole: "viewer" })]));
    expect((await work.projects(tko_member)).map(tko_entry => tko_entry.id)).toContain(tko_project.id);
    expect((await work.board(tko_member, tko_project.id)).project.id).toBe(tko_project.id);
    await expect(work.updateWorkItem({ actor: tko_member, workItemId: tko_item.id, expectedVersion: tko_item.version, title: "Viewer must not edit", correlationId: tko_member.correlationId })).rejects.toThrow("TASKO_AUTHORIZATION_DENIED:project_role_read_only");

    await work.upsertProjectMember(tko_owner, { projectId: tko_project.id, memberId: tko_member.memberId, projectRole: "editor", correlationId: tko_owner.correlationId });
    const tko_updated = await work.updateWorkItem({ actor: tko_member, workItemId: tko_item.id, expectedVersion: tko_item.version, title: "Editor can update", correlationId: tko_member.correlationId });
    expect(tko_updated.title).toBe("Editor can update");
    await work.updateProjectVisibility(tko_admin, { projectId: tko_project.id, visibility: "guest_shared", correlationId: tko_admin.correlationId });
    await work.removeProjectMember(tko_owner, { projectId: tko_project.id, memberId: tko_member.memberId, correlationId: tko_owner.correlationId });
    expect((await work.projectMembers(tko_owner, tko_project.id)).find(tko_entry => tko_entry.id === tko_member.memberId)).toEqual(expect.objectContaining({ isProjectMember: false, projectRole: null }));
    await expect(work.removeProjectMember(tko_owner, { projectId: tko_project.id, memberId: tko_owner.memberId, correlationId: tko_owner.correlationId })).rejects.toThrow("WORK_PROJECT_OWNER_MEMBER_REQUIRED");
    expect((await tko_platformStore.listAuditLogs()).filter(tko_event => ["work.project.member_upserted", "work.project.visibility_updated", "work.project.member_removed"].includes(tko_event.action))).toHaveLength(4);
    expect((await tko_platformStore.listOutbox()).filter(tko_event => ["work.project_member_upserted.v1", "work.project_visibility_updated.v1", "work.project_member_removed.v1"].includes(tko_event.eventType))).toHaveLength(4);
  });

  it("issues one-time project invitation links with a durable permission activity feed and blocks unauthorized redemption paths", async () => {
    const tko_owner = await tko_actor();
    const tko_member = await tko_actor("demo-member:tasko-demo");
    const tko_otherTenant = { ...tko_owner, authSubject: tko_otherSubject, tenantId: "tko-tenant-other-workspace", tenantSlug: "other-workspace", memberId: "tko-member-other-workspace-owner", correlationId: "test:invitation-other-tenant" };
    const tko_space = await work.createSpace(tko_owner, { name: "Invited delivery", slug: "invited-delivery", visibility: "internal", correlationId: tko_owner.correlationId });
    const tko_project = await work.createProject({ actor: tko_owner, spaceId: tko_space.id, name: "Invite-only project", key: "INVT", methodology: "kanban", visibility: "private", correlationId: tko_owner.correlationId });

    const tko_issue = await work.createProjectInvitation(tko_owner, { projectId: tko_project.id, inviteeEmail: null, projectRole: "viewer", expiresAt: new Date(Date.now() + 86_400_000), correlationId: tko_owner.correlationId });
    expect(tko_issue.token).toEqual(expect.any(String));
    expect(tko_issue.invitation).toEqual(expect.objectContaining({ projectId: tko_project.id, projectRole: "viewer", redeemedAt: null, revokedAt: null }));
    expect(await work.projectInvitations(tko_owner, tko_project.id)).toEqual(expect.arrayContaining([expect.objectContaining({ id: tko_issue.invitation.id, projectId: tko_project.id })]));
    await expect(work.createProjectInvitation(tko_member, { projectId: tko_project.id, projectRole: "viewer", expiresAt: new Date(Date.now() + 86_400_000), correlationId: tko_member.correlationId })).rejects.toThrow("TASKO_AUTHORIZATION_DENIED:capability_missing");
    await expect(work.projectInvitations(tko_otherTenant, tko_project.id)).rejects.toThrow("WORK_PROJECT_NOT_FOUND");

    const tko_redeemed = await work.redeemProjectInvitation(tko_member, { token: tko_issue.token, recipientEmail: null, correlationId: tko_member.correlationId });
    expect(tko_redeemed).toEqual(expect.objectContaining({ projectId: tko_project.id, memberId: tko_member.memberId, projectRole: "viewer", addedByMemberId: tko_member.memberId }));
    expect((await work.projects(tko_member)).map(tko_entry => tko_entry.id)).toContain(tko_project.id);
    await expect(work.redeemProjectInvitation(tko_member, { token: tko_issue.token, recipientEmail: null, correlationId: tko_member.correlationId })).rejects.toThrow("WORK_PROJECT_INVITATION_REDEEMED");

    const tko_secondIssue = await work.createProjectInvitation(tko_owner, { projectId: tko_project.id, inviteeEmail: "invitee@example.com", projectRole: "editor", expiresAt: new Date(Date.now() + 86_400_000), correlationId: tko_owner.correlationId });
    await work.revokeProjectInvitation(tko_owner, { projectId: tko_project.id, invitationId: tko_secondIssue.invitation.id, correlationId: tko_owner.correlationId });
    expect((await work.projectInvitations(tko_owner, tko_project.id)).find(tko_invitation => tko_invitation.id === tko_secondIssue.invitation.id)?.revokedAt).toEqual(expect.any(Date));
    await expect(work.redeemProjectInvitation(tko_member, { token: tko_secondIssue.token, recipientEmail: "invitee@example.com", correlationId: tko_member.correlationId })).rejects.toThrow("WORK_PROJECT_INVITATION_REVOKED");
    const tko_activity = await work.projectPermissionActivity(tko_owner, tko_project.id);
    expect(tko_activity.items.map(tko_entry => tko_entry.action)).toEqual(expect.arrayContaining(["work.project.invitation_created", "work.project.invitation_redeemed", "work.project.invitation_revoked"]));
    expect((await tko_platformStore.listOutbox()).filter(tko_event => ["work.project_invitation_created.v1", "work.project_invitation_redeemed.v1", "work.project_invitation_revoked.v1"].includes(tko_event.eventType))).toHaveLength(4);
  });

  it("manages invitation resend and filters project permission activity without leaking other project events", async () => {
    const tko_owner = await tko_actor();
    const tko_member = await tko_actor("demo-member:tasko-demo");
    const tko_space = await work.createSpace(tko_owner, { name: "Invitation operations", slug: "invitation-operations", visibility: "internal", correlationId: tko_owner.correlationId });
    const tko_project = await work.createProject({ actor: tko_owner, spaceId: tko_space.id, name: "Invitation control", key: "ICL", methodology: "kanban", visibility: "private", correlationId: tko_owner.correlationId });
    const tko_issue = await work.createProjectInvitation(tko_owner, { projectId: tko_project.id, inviteeEmail: "member@example.com", projectRole: "editor", expiresAt: new Date(Date.now() + 86_400_000), correlationId: tko_owner.correlationId });
    const tko_resent = await work.resendProjectInvitation(tko_owner, { projectId: tko_project.id, invitationId: tko_issue.invitation.id, expiresAt: new Date(Date.now() + 172_800_000), correlationId: tko_owner.correlationId });

    const tko_invitations = await work.projectInvitations(tko_owner, tko_project.id);
    expect(tko_resent.invitation.id).not.toBe(tko_issue.invitation.id);
    expect(tko_invitations.find(tko_invitation => tko_invitation.id === tko_issue.invitation.id)?.revokedAt).toEqual(expect.any(Date));
    expect(tko_invitations.find(tko_invitation => tko_invitation.id === tko_resent.invitation.id)).toEqual(expect.objectContaining({ inviteeEmail: "member@example.com", projectRole: "editor", revokedAt: null }));
    await expect(work.resendProjectInvitation(tko_member, { projectId: tko_project.id, invitationId: tko_resent.invitation.id, expiresAt: new Date(Date.now() + 172_800_000), correlationId: tko_member.correlationId })).rejects.toThrow("TASKO_AUTHORIZATION_DENIED:capability_missing");

    const tko_filtered = await work.projectPermissionActivity(tko_owner, tko_project.id, { actorMemberId: tko_owner.memberId, action: "work.project.invitation_resent" });
    expect(tko_filtered.items).toEqual([expect.objectContaining({ action: "work.project.invitation_resent", actorMemberId: tko_owner.memberId, projectId: tko_project.id })]);
    expect((await work.projectPermissionActivity(tko_owner, tko_project.id, { from: new Date(Date.now() + 86_400_000) })).items).toEqual([]);
    const tko_firstPage = await work.projectPermissionActivity(tko_owner, tko_project.id, { limit: 1 });
    expect(tko_firstPage.items).toHaveLength(1);
    expect(tko_firstPage.nextCursor).toEqual(expect.any(String));
    const tko_secondPage = await work.projectPermissionActivity(tko_owner, tko_project.id, { limit: 1, cursor: tko_firstPage.nextCursor ?? undefined });
    expect(tko_secondPage.items).toHaveLength(1);
    expect(tko_secondPage.items[0]?.id).not.toBe(tko_firstPage.items[0]?.id);
    expect((await tko_platformStore.listOutbox()).some(tko_event => tko_event.eventType === "work.project_invitation_resent.v1" && tko_event.payload.projectId === tko_project.id)).toBe(true);
  });

  it("hydrates comment reactions and image metadata while rejecting viewer collaboration mutations", async () => {
    const tko_owner = await tko_actor();
    const tko_viewer = await tko_actor("demo-member:tasko-demo");
    const tko_space = await work.createSpace(tko_owner, { name: "Comment collaboration", slug: "comment-collaboration", visibility: "internal", correlationId: tko_owner.correlationId });
    const tko_project = await work.createProject({ actor: tko_owner, spaceId: tko_space.id, name: "Comment evidence", key: "CMT", methodology: "kanban", visibility: "private", correlationId: tko_owner.correlationId });
    const tko_item = await work.createWorkItem({ actor: tko_owner, projectId: tko_project.id, title: "Review annotated screenshot", correlationId: tko_owner.correlationId });
    const tko_comment = await work.createComment({ actor: tko_owner, workItemId: tko_item.id, body: "Please verify this screenshot.", correlationId: tko_owner.correlationId });
    await tko_workStore.createCommentAttachment(tko_owner, { commentId: tko_comment.id, objectKey: `tenants/${tko_owner.tenantId}/work-comments/${tko_comment.id}/evidence.png`, filename: "evidence.png", contentType: "image/png", byteSize: 68, correlationId: tko_owner.correlationId });

    const tko_reacted = await work.toggleCommentReaction(tko_owner, { workItemId: tko_item.id, commentId: tko_comment.id, emoji: "👍", correlationId: tko_owner.correlationId });
    const tko_detail = await work.itemDetails(tko_owner, tko_item.id);
    expect(tko_reacted.reactions).toEqual(expect.arrayContaining([expect.objectContaining({ emoji: "👍", memberId: tko_owner.memberId })]));
    expect(tko_detail.comments.find(tko_entry => tko_entry.id === tko_comment.id)).toEqual(expect.objectContaining({ attachments: [expect.objectContaining({ filename: "evidence.png", contentType: "image/png", byteSize: 68 })] }));
    await work.upsertProjectMember(tko_owner, { projectId: tko_project.id, memberId: tko_viewer.memberId, projectRole: "viewer", correlationId: tko_owner.correlationId });
    await expect(work.toggleCommentReaction(tko_viewer, { workItemId: tko_item.id, commentId: tko_comment.id, emoji: "👀", correlationId: tko_viewer.correlationId })).rejects.toThrow("TASKO_AUTHORIZATION_DENIED:project_role_read_only");
    expect((await tko_platformStore.listAuditLogs()).some(tko_event => tko_event.action === "work.comment.reaction_added" && tko_event.resourceId === tko_comment.id)).toBe(true);
    expect((await tko_platformStore.listOutbox()).some(tko_event => tko_event.eventType === "work.comment_reaction_added.v1" && tko_event.payload.commentId === tko_comment.id)).toBe(true);
  });
});
