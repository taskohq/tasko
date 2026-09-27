import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MemoryPlatformStore, setPlatformStoreForTests } from "../../packages/database/src/platform-store";
import { MemoryWorkStore, setWorkStoreForTests } from "../../packages/database/src/work-store";
import { resolveTenantRequestContext } from "../tenancy/src/tenant-context";
import * as work from "./src/work-service";

const tko_ownerSubject = "work-extras-owner";
const tko_otherSubject = "work-extras-other-owner";

describe("Work M1 extras acceptance boundaries", () => {
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

  async function tko_guestActor() {
    const tko_context = await resolveTenantRequestContext({ authSubject: "demo-guest:tasko-demo", candidateTenantSlug: "tasko-demo", correlationId: "test:extras-guest" });
    if (!tko_context) throw new Error("TEST_GUEST_ACTOR_MISSING");
    return tko_context.actor;
  }

  async function tko_projectFixture(tko_owner: Awaited<ReturnType<typeof tko_actor>>, tko_visibility: "internal" | "guest_shared" = "guest_shared", tko_key: string, tko_methodology: "kanban" | "scrum" | "simple" = "kanban") {
    const tko_space = await work.createSpace(tko_owner, { name: "Extras", slug: `extras-${tko_key.toLowerCase()}`, visibility: tko_visibility, correlationId: "test:extras-space" });
    const tko_project = await work.createProject({ actor: tko_owner, spaceId: tko_space.id, name: `Extras project ${tko_key}`, key: tko_key, methodology: tko_methodology, visibility: tko_visibility, correlationId: "test:extras-project" });
    return tko_project;
  }

  it("lets any reader self-watch while gating watcher administration behind project manage", async () => {
    const tko_owner = await tko_actor();
    const tko_member = await tko_actor("demo-member:tasko-demo");
    const tko_guest = await tko_guestActor();
    const tko_project = await tko_projectFixture(tko_owner, "guest_shared", "WA1");
    const tko_item = await work.createWorkItem({ actor: tko_owner, projectId: tko_project.id, title: "Watch me", correlationId: "test:watchers" });

    const tko_guestWatched = await work.addWorkItemWatcher(tko_guest, { workItemId: tko_item.id, memberId: null, correlationId: tko_guest.correlationId });
    expect(tko_guestWatched.watcherMemberIds).toContain(tko_guest.memberId);
    await expect(work.addWorkItemWatcher(tko_guest, { workItemId: tko_item.id, memberId: tko_owner.memberId, correlationId: tko_guest.correlationId })).rejects.toThrow("TASKO_AUTHORIZATION_DENIED:capability_missing");
    await expect(work.addWorkItemWatcher(tko_member, { workItemId: tko_item.id, memberId: tko_owner.memberId, correlationId: tko_member.correlationId })).rejects.toThrow("TASKO_AUTHORIZATION_DENIED:capability_missing");

    await work.addWorkItemWatcher(tko_owner, { workItemId: tko_item.id, memberId: tko_member.memberId, correlationId: tko_owner.correlationId });
    await work.addWorkItemWatcher(tko_member, { workItemId: tko_item.id, memberId: null, correlationId: tko_member.correlationId });
    const tko_details = await work.itemDetails(tko_owner, tko_item.id);
    expect(tko_details.watchers.map(tko_watcher => tko_watcher.memberId)).toEqual(expect.arrayContaining([tko_member.memberId, tko_guest.memberId]));

    const tko_myWork = await work.myWork(tko_member, { due: "all" });
    expect(tko_myWork.find(tko_entry => tko_entry.workItemId === tko_item.id)?.isWatching).toBe(true);
    expect(tko_myWork.find(tko_entry => tko_entry.workItemId === tko_item.id)?.isOverdue).toBe(false);

    await work.removeWorkItemWatcher(tko_guest, { workItemId: tko_item.id, memberId: null, correlationId: tko_guest.correlationId });
    await expect(work.removeWorkItemWatcher(tko_guest, { workItemId: tko_item.id, memberId: null, correlationId: tko_guest.correlationId })).rejects.toThrow("WORK_WATCHER_NOT_FOUND");
    expect((await work.workItemWatchers(tko_owner, tko_item.id)).map(tko_watcher => tko_watcher.memberId)).toEqual(expect.arrayContaining([tko_member.memberId]));
    expect((await work.workItemWatchers(tko_owner, tko_item.id)).map(tko_watcher => tko_watcher.memberId)).not.toContain(tko_guest.memberId);

    const tko_eventTypes = (await tko_platformStore.listOutbox()).map(tko_entry => tko_entry.eventType);
    expect(tko_eventTypes).toEqual(expect.arrayContaining(["work.work_item_watcher_added.v1", "work.work_item_watcher_removed.v1"]));
    expect((await tko_platformStore.listAuditLogs()).some(tko_entry => tko_entry.action === "work.work_item.watcher_added")).toBe(true);
    await expect(work.workItemWatchers(tko_owner, "00000000-0000-0000-0000-000000000001")).rejects.toThrow("WORK_ITEM_NOT_FOUND");
  });

  it("manages project labels, applies multi-value sets and filters the board", async () => {
    const tko_owner = await tko_actor();
    const tko_guest = await tko_guestActor();
    const tko_project = await tko_projectFixture(tko_owner, "internal", "LB2");
    const tko_first = await work.createWorkLabel(tko_owner, { projectId: tko_project.id, name: "infra", colorToken: "blue", correlationId: "test:labels" });
    const tko_second = await work.createWorkLabel(tko_owner, { projectId: tko_project.id, name: "support", colorToken: "green", correlationId: "test:labels" });

    await expect(work.createWorkLabel(tko_guest, { projectId: tko_project.id, name: "Nope", colorToken: "red", correlationId: tko_guest.correlationId })).rejects.toThrow("TASKO_AUTHORIZATION_DENIED:capability_missing");
    await expect(work.createWorkLabel(tko_owner, { projectId: tko_project.id, name: "INFRA", colorToken: "red", correlationId: "test:labels" })).rejects.toThrow("WORK_LABEL_NAME_TAKEN");
    expect((await work.projectLabels(tko_owner, tko_project.id)).map(tko_label => tko_label.name)).toEqual(["infra", "support"]);

    const tko_item = await work.createWorkItem({ actor: tko_owner, projectId: tko_project.id, title: "Labelled work", correlationId: "test:labels" });
    const tko_otherItem = await work.createWorkItem({ actor: tko_owner, projectId: tko_project.id, title: "Unlabelled work", correlationId: "test:labels" });
    await work.setWorkItemLabels(tko_owner, { workItemId: tko_item.id, labelIds: [tko_first.id, tko_second.id], correlationId: "test:labels" });
    await expect(work.setWorkItemLabels(tko_guest, { workItemId: tko_item.id, labelIds: [], correlationId: tko_guest.correlationId })).rejects.toThrow("TASKO_AUTHORIZATION_DENIED:capability_missing");

    const tko_details = await work.itemDetails(tko_owner, tko_item.id);
    expect(tko_details.labels.map(tko_label => tko_label.id).sort()).toEqual([tko_first.id, tko_second.id].sort());
    expect(tko_details.item.labelIds).toEqual(expect.arrayContaining([tko_first.id, tko_second.id]));

    const tko_filteredBoard = await work.board(tko_owner, tko_project.id, { labelIds: [tko_first.id] });
    expect(tko_filteredBoard.items.map(tko_entry => tko_entry.id)).toEqual([tko_item.id]);
    const tko_unfilteredBoard = await work.board(tko_owner, tko_project.id);
    expect(tko_unfilteredBoard.items).toHaveLength(2);

    const tko_updated = await work.updateWorkLabel(tko_owner, { projectId: tko_project.id, labelId: tko_first.id, name: "Infra v2", colorToken: "purple", correlationId: "test:labels" });
    expect(tko_updated).toMatchObject({ name: "Infra v2", colorToken: "purple" });
    await work.deleteWorkLabel(tko_owner, { projectId: tko_project.id, labelId: tko_second.id, correlationId: "test:labels" });
    expect((await work.itemDetails(tko_owner, tko_item.id)).labels.map(tko_label => tko_label.id)).toEqual([tko_first.id]);

    const tko_eventTypes = (await tko_platformStore.listOutbox()).map(tko_entry => tko_entry.eventType);
    expect(tko_eventTypes).toEqual(expect.arrayContaining(["work.label_created.v1", "work.label_updated.v1", "work.label_deleted.v1", "work.work_item_labels_set.v1"]));
  });

  it("records manual time logs with totals and owner-scoped deletion", async () => {
    const tko_owner = await tko_actor();
    const tko_member = await tko_actor("demo-member:tasko-demo");
    const tko_guest = await tko_guestActor();
    const tko_project = await tko_projectFixture(tko_owner, "internal", "TM3");
    const tko_item = await work.createWorkItem({ actor: tko_owner, projectId: tko_project.id, title: "Timed work", correlationId: "test:time" });

    await work.addWorkTimeLog(tko_owner, { workItemId: tko_item.id, minutes: 60, note: "Discovery", correlationId: "test:time" });
    await work.addWorkTimeLog(tko_owner, { workItemId: tko_item.id, minutes: 90, correlationId: "test:time" });
    const tko_memberLog = await work.addWorkTimeLog(tko_member, { workItemId: tko_item.id, minutes: 30, correlationId: tko_member.correlationId });

    await expect(work.addWorkTimeLog(tko_guest, { workItemId: tko_item.id, minutes: 15, correlationId: tko_guest.correlationId })).rejects.toThrow("TASKO_AUTHORIZATION_DENIED:capability_missing");
    await expect(work.addWorkTimeLog(tko_owner, { workItemId: tko_item.id, minutes: 0, correlationId: "test:time" })).rejects.toThrow("WORK_TIME_LOG_INVALID");

    const tko_details = await work.itemDetails(tko_owner, tko_item.id);
    expect(tko_details.timeLogTotalMinutes).toBe(180);
    expect(tko_details.timeLogs).toHaveLength(3);

    await work.deleteWorkTimeLog(tko_member, { workItemId: tko_item.id, timeLogId: tko_memberLog.id, correlationId: tko_member.correlationId });
    const tko_ownerLog = (await work.workItemTimeLogs(tko_owner, tko_item.id)).logs[0];
    await expect(work.deleteWorkTimeLog(tko_member, { workItemId: tko_item.id, timeLogId: tko_ownerLog.id, correlationId: tko_member.correlationId })).rejects.toThrow("TASKO_AUTHORIZATION_DENIED:time_log_owner_required");
    await work.deleteWorkTimeLog(tko_owner, { workItemId: tko_item.id, timeLogId: tko_ownerLog.id, correlationId: tko_owner.correlationId });
    expect((await work.workItemTimeLogs(tko_owner, tko_item.id)).totalMinutes).toBe(90);

    const tko_eventTypes = (await tko_platformStore.listOutbox()).map(tko_entry => tko_entry.eventType);
    expect(tko_eventTypes).toEqual(expect.arrayContaining(["work.time_logged.v1", "work.time_log_deleted.v1"]));
  });

  it("enforces persisted workflow transitions on top of the allow-all baseline", async () => {
    const tko_owner = await tko_actor();
    const tko_member = await tko_actor("demo-member:tasko-demo");
    const tko_project = await tko_projectFixture(tko_owner, "internal", "TR4");
    const tko_board = await work.board(tko_owner, tko_project.id);
    const [tko_todo, tko_inProgress, tko_done] = tko_board.statuses;
    if (!tko_todo || !tko_inProgress || !tko_done) throw new Error("TEST_STATUSES_MISSING");
    const tko_item = await work.createWorkItem({ actor: tko_owner, projectId: tko_project.id, title: "Transitioning", correlationId: "test:transitions" });
    const tko_other = await work.createWorkItem({ actor: tko_owner, projectId: tko_project.id, title: "Baseline move", correlationId: "test:transitions" });

    const tko_transitions = (await work.workflowTransitions(tko_owner, tko_project.id)).transitions;
    expect(tko_transitions).toHaveLength(6);
    expect(tko_transitions.every(tko_row => tko_row.allowed)).toBe(true);

    await work.setWorkflowTransitionAllowed(tko_owner, { projectId: tko_project.id, fromStatusId: tko_todo.id, toStatusId: tko_done.id, allowed: false, correlationId: "test:transitions" });
    await expect(work.transitionWorkItem({ actor: tko_owner, workItemId: tko_item.id, targetStatusId: tko_done.id, expectedVersion: tko_item.version, correlationId: "test:transitions" })).rejects.toThrow("WORK_ITEM_TRANSITION_NOT_ALLOWED");
    const tko_moved = await work.transitionWorkItem({ actor: tko_owner, workItemId: tko_other.id, targetStatusId: tko_inProgress.id, expectedVersion: tko_other.version, correlationId: "test:transitions" });
    expect(tko_moved.statusId).toBe(tko_inProgress.id);

    await expect(work.setWorkflowTransitionAllowed(tko_member, { projectId: tko_project.id, fromStatusId: tko_todo.id, toStatusId: tko_done.id, allowed: true, correlationId: tko_member.correlationId })).rejects.toThrow("TASKO_AUTHORIZATION_DENIED:capability_missing");
    await expect(work.setWorkflowTransitionAllowed(tko_owner, { projectId: tko_project.id, fromStatusId: tko_todo.id, toStatusId: "00000000-0000-0000-0000-000000000001", allowed: true, correlationId: "test:transitions" })).rejects.toThrow("WORK_STATUS_NOT_FOUND");

    await work.setWorkflowTransitionAllowed(tko_owner, { projectId: tko_project.id, fromStatusId: tko_todo.id, toStatusId: tko_done.id, allowed: true, correlationId: "test:transitions" });
    const tko_reallowed = await work.transitionWorkItem({ actor: tko_owner, workItemId: tko_item.id, targetStatusId: tko_done.id, expectedVersion: tko_item.version, correlationId: "test:transitions" });
    expect(tko_reallowed.statusId).toBe(tko_done.id);
    expect((await tko_platformStore.listOutbox()).some(tko_entry => tko_entry.eventType === "work.workflow_transition_updated.v1")).toBe(true);
  });

  it("manages custom work types and validates type changes against the project", async () => {
    const tko_owner = await tko_actor();
    const tko_guest = await tko_guestActor();
    const tko_project = await tko_projectFixture(tko_owner, "guest_shared", "TY5");
    const tko_item = await work.createWorkItem({ actor: tko_owner, projectId: tko_project.id, title: "Typeable", correlationId: "test:types" });

    const tko_customType = await work.createWorkType(tko_owner, { projectId: tko_project.id, name: "Spike", category: "story", icon: "compass", correlationId: "test:types" });
    expect(tko_customType).toMatchObject({ name: "Spike", category: "story", projectId: tko_project.id });
    await expect(work.createWorkType(tko_owner, { projectId: tko_project.id, name: "spike", category: "task", correlationId: "test:types" })).rejects.toThrow("WORK_TYPE_NAME_TAKEN");
    await expect(work.createWorkType(tko_guest, { projectId: tko_project.id, name: "Nope", category: "task", correlationId: tko_guest.correlationId })).rejects.toThrow("TASKO_AUTHORIZATION_DENIED:capability_missing");
    await work.updateWorkType(tko_owner, { projectId: tko_project.id, workTypeId: tko_customType.id, name: "Spike v2", correlationId: "test:types" });

    const tko_typed = await work.setWorkItemType(tko_owner, { workItemId: tko_item.id, workTypeId: tko_customType.id, correlationId: "test:types" });
    expect(tko_typed.workTypeId).toBe(tko_customType.id);
    expect((await tko_workStore.listHistory(tko_owner.tenantId, tko_item.id)).at(-1)?.field).toBe("work_type_id");

    const tko_otherProject = await tko_projectFixture(tko_owner, "internal", "TY5B");
    const tko_otherType = (await work.workTypes(tko_owner, tko_otherProject.id)).find(tko_type => tko_type.category === "bug");
    if (!tko_otherType) throw new Error("TEST_OTHER_TYPE_MISSING");
    await expect(work.setWorkItemType(tko_owner, { workItemId: tko_item.id, workTypeId: tko_otherType.id, correlationId: "test:types" })).rejects.toThrow("WORK_TYPE_NOT_FOUND");

    const tko_eventTypes = (await tko_platformStore.listOutbox()).map(tko_entry => tko_entry.eventType);
    expect(tko_eventTypes).toEqual(expect.arrayContaining(["work.work_type_created.v1", "work.work_type_updated.v1", "work.work_item_type_changed.v1"]));
  });

  it("duplicates items with copied metadata and moves items across projects within the tenant", async () => {
    const tko_owner = await tko_actor();
    const tko_guest = await tko_guestActor();
    const tko_projectA = await tko_projectFixture(tko_owner, "guest_shared", "AC6", "scrum");
    const tko_label = await work.createWorkLabel(tko_owner, { projectId: tko_projectA.id, name: "carry", colorToken: "amber", correlationId: "test:actions" });
    const tko_source = await work.createWorkItem({ actor: tko_owner, projectId: tko_projectA.id, title: "Original", description: "Source context", priority: "high", assigneeMemberIds: [tko_owner.memberId], dueAt: new Date("2026-10-30T12:00:00.000Z"), estimateMinutes: 120, correlationId: "test:actions" });
    await work.setWorkItemLabels(tko_owner, { workItemId: tko_source.id, labelIds: [tko_label.id], correlationId: "test:actions" });
    const tko_board = await work.board(tko_owner, tko_projectA.id);
    const tko_inProgress = tko_board.statuses.find(tko_status => tko_status.category === "in_progress");
    if (!tko_inProgress) throw new Error("TEST_STATUS_MISSING");
    await work.transitionWorkItem({ actor: tko_owner, workItemId: tko_source.id, targetStatusId: tko_inProgress.id, expectedVersion: tko_source.version, correlationId: "test:actions" });

    await expect(work.duplicateWorkItem(tko_guest, { workItemId: tko_source.id, correlationId: tko_guest.correlationId })).rejects.toThrow("TASKO_AUTHORIZATION_DENIED:capability_missing");
    const tko_copy = await work.duplicateWorkItem(tko_owner, { workItemId: tko_source.id, correlationId: "test:actions" });
    const tko_boardAfterCopy = await work.board(tko_owner, tko_projectA.id);
    expect(tko_copy.title).toBe("Original [Copy]");
    expect(tko_copy.statusId).toBe(tko_boardAfterCopy.statuses.find(tko_status => tko_status.category === "todo")?.id);
    expect(tko_copy.sequenceNo).toBe(tko_source.sequenceNo + 1);
    expect(tko_copy.assigneeMemberIds).toEqual([tko_owner.memberId]);
    expect(tko_copy.labelIds).toEqual([tko_label.id]);
    expect(tko_copy.estimateMinutes).toBe(120);
    expect((await tko_workStore.listHistory(tko_owner.tenantId, tko_copy.id)).map(tko_entry => tko_entry.field)).toEqual(["created"]);

    const tko_projectB = await tko_projectFixture(tko_owner, "internal", "AC7");
    const tko_sprint = await work.createSprint({ actor: tko_owner, projectId: tko_projectA.id, name: "Sprint before move", correlationId: "test:actions" });
    await work.addItemsToSprint(tko_owner, { sprintId: tko_sprint.id, workItemIds: [tko_source.id], correlationId: "test:actions" });
    const tko_sibling = await work.createWorkItem({ actor: tko_owner, projectId: tko_projectA.id, title: "Related", correlationId: "test:actions" });
    await work.addDependency(tko_owner, { sourceWorkItemId: tko_source.id, targetWorkItemId: tko_sibling.id, relationType: "blocks", correlationId: "test:actions" });

    await expect(work.moveWorkItemToProject(tko_guest, { workItemId: tko_source.id, targetProjectId: tko_projectB.id, correlationId: tko_guest.correlationId })).rejects.toThrow("TASKO_AUTHORIZATION_DENIED:capability_missing");
    const tko_moved = await work.moveWorkItemToProject(tko_owner, { workItemId: tko_source.id, targetProjectId: tko_projectB.id, correlationId: "test:actions" });
    expect(tko_moved.projectId).toBe(tko_projectB.id);
    expect(tko_moved.sequenceNo).toBe(1);
    expect(tko_moved.sprintId).toBeNull();
    expect(tko_moved.statusId).toBe((await work.board(tko_owner, tko_projectB.id)).statuses.find(tko_status => tko_status.category === "todo")?.id);
    expect((await work.itemDetails(tko_owner, tko_moved.id)).dependencies).toEqual(expect.arrayContaining([expect.objectContaining({ sourceWorkItemId: tko_moved.id, relationType: "blocks" })]));
    await expect(work.moveWorkItemToProject(tko_owner, { workItemId: tko_moved.id, targetProjectId: tko_projectB.id, correlationId: "test:actions" })).rejects.toThrow("WORK_ITEM_MOVE_PROJECT_INVALID");

    const tko_eventTypes = (await tko_platformStore.listOutbox()).map(tko_entry => tko_entry.eventType);
    expect(tko_eventTypes).toEqual(expect.arrayContaining(["work.work_item_duplicated.v1", "work.work_item_moved_project.v1"]));
    expect((await tko_platformStore.listAuditLogs()).some(tko_entry => tko_entry.action === "work.work_item.moved_project")).toBe(true);
  });

  it("shares and deletes saved views with ownership and manage rules", async () => {
    const tko_owner = await tko_actor();
    const tko_member = await tko_actor("demo-member:tasko-demo");
    const tko_project = await tko_projectFixture(tko_owner, "internal", "VW8");

    const tko_workspaceView = await work.saveView(tko_owner, { projectId: tko_project.id, name: "Urgent board", renderer: "board", visibility: "workspace", filter: { kind: "tasko.work.filter.v1", kanbanFilter: "high_priority", grouping: "priority", labelIds: [] }, layout: {}, correlationId: "test:views" });
    const tko_privateView = await work.saveView(tko_member, { projectId: tko_project.id, name: "My backlog", renderer: "list", visibility: "private", filter: { kind: "tasko.work.filter.v1", kanbanFilter: "assigned", grouping: "none", labelIds: [] }, layout: {}, correlationId: tko_member.correlationId });

    const tko_ownerViews = await work.savedViews(tko_owner, tko_project.id);
    expect(tko_ownerViews.map(tko_view => tko_view.id)).toEqual(expect.arrayContaining([tko_workspaceView.id]));
    expect(tko_ownerViews.map(tko_view => tko_view.id)).not.toContain(tko_privateView.id);
    const tko_memberViews = await work.savedViews(tko_member, tko_project.id);
    expect(tko_memberViews.map(tko_view => tko_view.id)).toEqual(expect.arrayContaining([tko_workspaceView.id, tko_privateView.id]));

    await expect(work.deleteSavedView(tko_member, { projectId: tko_project.id, viewId: tko_workspaceView.id, correlationId: tko_member.correlationId })).rejects.toThrow("TASKO_AUTHORIZATION_DENIED:capability_missing");
    await work.deleteSavedView(tko_member, { projectId: tko_project.id, viewId: tko_privateView.id, correlationId: tko_member.correlationId });
    await work.deleteSavedView(tko_owner, { projectId: tko_project.id, viewId: tko_workspaceView.id, correlationId: tko_owner.correlationId });
    expect(await work.savedViews(tko_owner, tko_project.id)).toEqual([]);

    const tko_eventTypes = (await tko_platformStore.listOutbox()).map(tko_entry => tko_entry.eventType);
    expect(tko_eventTypes).toEqual(expect.arrayContaining(["work.saved_view_created.v1", "work.saved_view_deleted.v1"]));
  });
});
