import type {
  CreateCommentInput,
  CreateProjectInput,
  CreateSprintInput,
  CreateWorkItemInput,
  MoveWorkItemInput,
  TransitionWorkItemInput,
  UpdateWorkItemInput,
  WorkCustomFieldType,
  WorkItem,
  WorkProject,
} from "../../../packages/contracts/src/work";
import type { Capability, PlatformActor, TenantResource } from "../../../packages/contracts/src/platform";
import { getWorkStore } from "../../../packages/database/src/work-store";
import { requireCapability } from "../../permissions/src/authorization";

function tko_workResource(tko_actor: PlatformActor, tko_resource: Omit<TenantResource, "tenantId">): TenantResource {
  return { ...tko_resource, tenantId: tko_actor.tenantId };
}

function tko_require(tko_actor: PlatformActor, tko_capability: Capability, tko_resource: Omit<TenantResource, "tenantId">): void {
  requireCapability(tko_actor, tko_capability, tko_workResource(tko_actor, tko_resource));
}

async function tko_projectFor(tko_actor: PlatformActor, tko_projectId: string): Promise<WorkProject> {
  const tko_project = await getWorkStore().getProject(tko_actor.tenantId, tko_projectId);
  if (!tko_project || tko_project.archivedAt) throw new Error("WORK_PROJECT_NOT_FOUND");
  return tko_project;
}

async function tko_itemFor(tko_actor: PlatformActor, tko_workItemId: string): Promise<WorkItem> {
  const tko_item = await getWorkStore().getWorkItem(tko_actor.tenantId, tko_workItemId);
  if (!tko_item || tko_item.archivedAt) throw new Error("WORK_ITEM_NOT_FOUND");
  return tko_item;
}

export async function createSpace(tko_actor: PlatformActor, tko_input: { name: string; slug: string; visibility: "internal" | "private" | "guest_shared"; correlationId: string }) {
  tko_require(tko_actor, "work.space.manage", { type: "space", id: "new-space", visibility: tko_input.visibility });
  return getWorkStore().createSpace(tko_actor, tko_input);
}

export async function createProject(tko_input: CreateProjectInput) {
  const tko_spaces = await getWorkStore().listSpaces(tko_input.actor.tenantId);
  const tko_space = tko_spaces.find(tko_entry => tko_entry.id === tko_input.spaceId);
  if (!tko_space) throw new Error("WORK_SPACE_NOT_FOUND");
  tko_require(tko_input.actor, "work.project.manage", tko_space);
  return getWorkStore().createProject(tko_input);
}

export async function board(tko_actor: PlatformActor, tko_projectId: string) {
  const tko_project = await tko_projectFor(tko_actor, tko_projectId);
  tko_require(tko_actor, "work.project.read", tko_project);
  return {
    project: tko_project,
    statuses: await getWorkStore().listStatuses(tko_actor.tenantId, tko_project.workflowId),
    items: await getWorkStore().listWorkItems(tko_actor.tenantId, tko_project.id),
    sprints: await getWorkStore().listSprints(tko_actor.tenantId, tko_project.id),
    views: await getWorkStore().listViews(tko_actor.tenantId, tko_project.id, tko_actor.memberId),
  };
}

export async function itemDetails(tko_actor: PlatformActor, tko_workItemId: string) {
  const tko_item = await tko_itemFor(tko_actor, tko_workItemId);
  tko_require(tko_actor, "work.item.read", tko_item);
  return { item: tko_item, comments: await getWorkStore().listComments(tko_actor.tenantId, tko_item.id), dependencies: await getWorkStore().listDependencies(tko_actor.tenantId, tko_item.id), history: await getWorkStore().listHistory(tko_actor.tenantId, tko_item.id), customValues: await getWorkStore().listCustomFieldValues(tko_actor.tenantId, tko_item.id) };
}

export async function customFields(tko_actor: PlatformActor, tko_projectId: string) {
  const tko_project = await tko_projectFor(tko_actor, tko_projectId);
  tko_require(tko_actor, "work.project.read", tko_project);
  return getWorkStore().listCustomFields(tko_actor.tenantId, tko_project.id);
}

export async function createCustomField(tko_actor: PlatformActor, tko_input: { projectId: string; name: string; fieldType: WorkCustomFieldType; config?: Record<string, unknown>; correlationId: string }) {
  const tko_project = await tko_projectFor(tko_actor, tko_input.projectId);
  tko_require(tko_actor, "work.custom_field.manage", tko_project);
  return getWorkStore().createCustomField(tko_actor, tko_input);
}

export async function setCustomFieldValue(tko_actor: PlatformActor, tko_input: { workItemId: string; fieldId: string; value: unknown; correlationId: string }) {
  const tko_item = await tko_itemFor(tko_actor, tko_input.workItemId);
  tko_require(tko_actor, "work.item.update", tko_item);
  return getWorkStore().setCustomFieldValue(tko_actor, tko_input);
}

export async function saveView(tko_actor: PlatformActor, tko_input: { projectId: string; name: string; renderer: "list" | "board" | "calendar" | "timeline"; visibility: "private" | "workspace"; filter: Record<string, unknown>; layout: Record<string, unknown>; correlationId: string }) {
  const tko_project = await tko_projectFor(tko_actor, tko_input.projectId);
  tko_require(tko_actor, "work.view.manage", tko_project);
  return getWorkStore().saveView(tko_actor, tko_input);
}

export async function createWorkItem(tko_input: CreateWorkItemInput) {
  const tko_project = await tko_projectFor(tko_input.actor, tko_input.projectId);
  tko_require(tko_input.actor, "work.item.create", tko_project);
  return getWorkStore().createWorkItem(tko_input);
}

export async function transitionWorkItem(tko_input: TransitionWorkItemInput) {
  const tko_item = await tko_itemFor(tko_input.actor, tko_input.workItemId);
  tko_require(tko_input.actor, "work.item.transition", tko_item);
  return getWorkStore().transitionWorkItem(tko_input);
}

export async function moveWorkItem(tko_input: MoveWorkItemInput) {
  const tko_item = await tko_itemFor(tko_input.actor, tko_input.workItemId);
  tko_require(tko_input.actor, "work.item.transition", tko_item);
  return getWorkStore().moveWorkItem(tko_input);
}

export async function updateWorkItem(tko_input: UpdateWorkItemInput) {
  const tko_item = await tko_itemFor(tko_input.actor, tko_input.workItemId);
  tko_require(tko_input.actor, "work.item.update", tko_item);
  return getWorkStore().updateWorkItem(tko_input);
}

export async function createComment(tko_input: CreateCommentInput) {
  const tko_item = await tko_itemFor(tko_input.actor, tko_input.workItemId);
  tko_require(tko_input.actor, "work.comment.create", tko_item);
  return getWorkStore().createComment(tko_input);
}

export async function addDependency(tko_actor: PlatformActor, tko_input: { sourceWorkItemId: string; targetWorkItemId: string; relationType: "blocks" | "blocked_by" | "relates_to" | "duplicates" | "duplicated_by"; correlationId: string }) {
  const tko_source = await tko_itemFor(tko_actor, tko_input.sourceWorkItemId);
  const tko_target = await tko_itemFor(tko_actor, tko_input.targetWorkItemId);
  tko_require(tko_actor, "work.item.update", tko_source);
  tko_require(tko_actor, "work.item.read", tko_target);
  return getWorkStore().addDependency(tko_actor, tko_input);
}

export async function removeDependency(tko_actor: PlatformActor, tko_input: { workItemId: string; relationId: string; correlationId: string }) {
  const tko_item = await tko_itemFor(tko_actor, tko_input.workItemId);
  tko_require(tko_actor, "work.item.update", tko_item);
  return getWorkStore().removeDependency(tko_actor, tko_input);
}

export async function createSprint(tko_input: CreateSprintInput) {
  const tko_project = await tko_projectFor(tko_input.actor, tko_input.projectId);
  tko_require(tko_input.actor, "work.sprint.manage", tko_project);
  return getWorkStore().createSprint(tko_input);
}

export async function addItemsToSprint(tko_actor: PlatformActor, tko_input: { sprintId: string; workItemIds: string[]; correlationId: string }) {
  tko_require(tko_actor, "work.sprint.manage", { type: "sprint", id: tko_input.sprintId, visibility: "internal" });
  return getWorkStore().addItemsToSprint(tko_actor, tko_input);
}

export async function completeSprint(tko_actor: PlatformActor, tko_input: import("../../../packages/contracts/src/work").CompleteSprintInput) {
  tko_require(tko_actor, "work.sprint.manage", { type: "sprint", id: tko_input.sprintId, visibility: "internal" });
  if (tko_input.incompleteDisposition === "next_sprint" && !tko_input.nextSprintId) throw new Error("WORK_SPRINT_NEXT_REQUIRED");
  return getWorkStore().completeSprint(tko_actor, tko_input);
}

export async function seedWorkDemo(tko_actor: PlatformActor) {
  tko_require(tko_actor, "work.project.manage", { type: "project", id: "seed-work-demo", visibility: "internal" });
  return getWorkStore().seedDemoWork(tko_actor);
}
