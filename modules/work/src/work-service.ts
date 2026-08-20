import type {
  ArchiveWorkItemInput,
  CreateCommentInput,
  CreateProjectInput,
  CreateSprintInput,
  ProjectOverview,
  ProjectSearchResult,
  CreateWorkItemInput,
  MoveWorkItemInput,
  TransitionWorkItemInput,
  UpdateWorkItemInput,
  WorkCustomFieldType,
  WorkItem,
  WorkProject,
  ReorderWorkflowStatusInput,
  WorkflowStatus,
} from "../../../packages/contracts/src/work";
import type { Capability, PlatformActor, TenantResource } from "../../../packages/contracts/src/platform";
import { getPlatformStore } from "../../../packages/database/src/platform-store";
import { getWorkStore } from "../../../packages/database/src/work-store";
import { getTenantAttachmentDownloadUrl, uploadTenantAttachment } from "../../attachments/src/attachment-storage";
import { can, requireCapability } from "../../permissions/src/authorization";

function tko_workResource(tko_actor: PlatformActor, tko_resource: Omit<TenantResource, "tenantId">): TenantResource {
  const tko_project = tko_resource as Partial<WorkProject>;
  return {
    ...tko_resource,
    tenantId: tko_actor.tenantId,
    projectMemberRole: tko_resource.projectMemberRole ?? tko_project.projectMemberRoles?.[tko_actor.memberId],
  };
}

function tko_require(tko_actor: PlatformActor, tko_capability: Capability, tko_resource: Omit<TenantResource, "tenantId">): void {
  requireCapability(tko_actor, tko_capability, tko_workResource(tko_actor, tko_resource));
}

async function tko_projectFor(tko_actor: PlatformActor, tko_projectId: string): Promise<WorkProject> {
  const tko_project = await getWorkStore().getProject(tko_actor.tenantId, tko_projectId);
  if (!tko_project || tko_project.archivedAt) throw new Error("WORK_PROJECT_NOT_FOUND");
  const tko_projectMembers = await getWorkStore().listProjectMembers(tko_actor.tenantId, tko_project.id);
  return {
    ...tko_project,
    projectMemberRoles: Object.fromEntries(tko_projectMembers.map(tko_member => [tko_member.memberId, tko_member.projectRole])),
  };
}

async function tko_itemFor(tko_actor: PlatformActor, tko_workItemId: string): Promise<WorkItem & Pick<TenantResource, "visibility" | "explicitMemberIds" | "projectMemberRole">> {
  const tko_item = await getWorkStore().getWorkItem(tko_actor.tenantId, tko_workItemId);
  if (!tko_item || tko_item.archivedAt) throw new Error("WORK_ITEM_NOT_FOUND");
  const tko_project = await tko_projectFor(tko_actor, tko_item.projectId);
  return {
    ...tko_item,
    visibility: tko_project.visibility,
    explicitMemberIds: Object.keys(tko_project.projectMemberRoles ?? {}),
    projectMemberRole: tko_project.projectMemberRoles?.[tko_actor.memberId],
  };
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

export async function projects(tko_actor: PlatformActor) {
  const tko_projects = await getWorkStore().listProjects(tko_actor.tenantId);
  return tko_projects.filter(tko_project => can(tko_actor, "work.project.read", tko_workResource(tko_actor, tko_project)).allowed);
}

export async function projectMembers(tko_actor: PlatformActor, tko_projectId: string) {
  const tko_project = await tko_projectFor(tko_actor, tko_projectId);
  tko_require(tko_actor, "work.project.read", tko_project);
  const [tko_tenantMembers, tko_projectMembers] = await Promise.all([
    getPlatformStore().listTenantMembers(tko_actor.tenantId),
    getWorkStore().listProjectMembers(tko_actor.tenantId, tko_project.id),
  ]);
  const tko_projectMemberByMemberId = new Map(tko_projectMembers.map(tko_member => [tko_member.memberId, tko_member]));
  return tko_tenantMembers
    .filter(tko_member => tko_member.status === "active")
    .map(tko_member => {
      const tko_assignment = tko_projectMemberByMemberId.get(tko_member.id);
      return {
        id: tko_member.id,
        displayName: tko_member.displayName,
        tenantRole: tko_member.role,
        projectRole: tko_assignment?.projectRole ?? null,
        isProjectMember: !!tko_assignment,
        isOwner: tko_member.id === tko_project.ownerMemberId,
      };
    });
}

export async function updateProjectVisibility(tko_actor: PlatformActor, tko_input: { projectId: string; visibility: WorkProject["visibility"]; correlationId: string }) {
  const tko_project = await tko_projectFor(tko_actor, tko_input.projectId);
  tko_require(tko_actor, "work.project.manage", tko_project);
  return getWorkStore().updateProjectVisibility({ actor: tko_actor, ...tko_input });
}

export async function upsertProjectMember(tko_actor: PlatformActor, tko_input: { projectId: string; memberId: string; projectRole: "viewer" | "editor"; correlationId: string }) {
  const tko_project = await tko_projectFor(tko_actor, tko_input.projectId);
  tko_require(tko_actor, "work.project.manage", tko_project);
  const tko_member = (await getPlatformStore().listTenantMembers(tko_actor.tenantId)).find(tko_entry => tko_entry.id === tko_input.memberId && tko_entry.status === "active");
  if (!tko_member) throw new Error("WORK_PROJECT_MEMBER_INVALID");
  if (tko_project.ownerMemberId === tko_input.memberId && tko_input.projectRole !== "editor") throw new Error("WORK_PROJECT_OWNER_EDITOR_REQUIRED");
  return getWorkStore().upsertProjectMember({ actor: tko_actor, ...tko_input });
}

export async function removeProjectMember(tko_actor: PlatformActor, tko_input: { projectId: string; memberId: string; correlationId: string }) {
  const tko_project = await tko_projectFor(tko_actor, tko_input.projectId);
  tko_require(tko_actor, "work.project.manage", tko_project);
  return getWorkStore().removeProjectMember({ actor: tko_actor, ...tko_input });
}

export async function board(tko_actor: PlatformActor, tko_projectId: string) {
  const tko_project = await tko_projectFor(tko_actor, tko_projectId);
  tko_require(tko_actor, "work.project.read", tko_project);
  const tko_items = await getWorkStore().listWorkItems(tko_actor.tenantId, tko_project.id);
  const tko_members = await getPlatformStore().listTenantMembers(tko_actor.tenantId);
  const tko_memberNameById = new Map(tko_members.map(tko_member => [tko_member.id, tko_member.displayName]));
  const tko_latestStatusChangeByWorkItemId: Record<string, { actorMemberId: string; actorDisplayName: string; changedAt: Date }> = {};

  await Promise.all(tko_items.map(async tko_item => {
    const tko_transition = (await getWorkStore().listHistory(tko_actor.tenantId, tko_item.id))
      .filter(tko_history => tko_history.field === "status_id")
      .sort((tko_left, tko_right) => tko_right.createdAt.getTime() - tko_left.createdAt.getTime())[0];
    if (!tko_transition) return;
    tko_latestStatusChangeByWorkItemId[tko_item.id] = {
      actorMemberId: tko_transition.actorMemberId,
      actorDisplayName: tko_memberNameById.get(tko_transition.actorMemberId) ?? "Former member",
      changedAt: tko_transition.createdAt,
    };
  }));

  return {
    project: tko_project,
    statuses: await getWorkStore().listStatuses(tko_actor.tenantId, tko_project.workflowId),
    items: tko_items,
    latestStatusChangeByWorkItemId: tko_latestStatusChangeByWorkItemId,
    sprints: await getWorkStore().listSprints(tko_actor.tenantId, tko_project.id),
    views: await getWorkStore().listViews(tko_actor.tenantId, tko_project.id, tko_actor.memberId),
  };
}

export async function overview(tko_actor: PlatformActor, tko_projectId: string): Promise<ProjectOverview> {
  const tko_data = await board(tko_actor, tko_projectId);
  const tko_doneStatusIds = new Set(tko_data.statuses.filter(tko_status => tko_status.category === "done").map(tko_status => tko_status.id));
  const tko_progressStatusIds = new Set(tko_data.statuses.filter(tko_status => tko_status.category === "in_progress").map(tko_status => tko_status.id));
  const tko_members = await getPlatformStore().listTenantMembers(tko_actor.tenantId);
  const tko_workload = new Map(tko_members.map(tko_member => [tko_member.id, { memberId: tko_member.id, displayName: tko_member.displayName, assignedItems: 0, estimatedMinutes: 0 }]));
  for (const tko_item of tko_data.items) for (const tko_memberId of tko_item.assigneeMemberIds) {
    const tko_entry = tko_workload.get(tko_memberId);
    if (tko_entry) { tko_entry.assignedItems += 1; tko_entry.estimatedMinutes += tko_item.estimateMinutes ?? 0; }
  }
  const tko_completedItems = tko_data.items.filter(tko_item => tko_doneStatusIds.has(tko_item.statusId)).length;
  return {
    projectId: tko_data.project.id,
    totalItems: tko_data.items.length,
    completedItems: tko_completedItems,
    inProgressItems: tko_data.items.filter(tko_item => tko_progressStatusIds.has(tko_item.statusId)).length,
    backlogItems: tko_data.items.filter(tko_item => !tko_item.sprintId).length,
    overdueItems: tko_data.items.filter(tko_item => !!tko_item.dueAt && tko_item.dueAt.getTime() < Date.now() && !tko_doneStatusIds.has(tko_item.statusId)).length,
    unestimatedItems: tko_data.items.filter(tko_item => tko_item.estimateMinutes === null).length,
    completionPercent: tko_data.items.length ? Math.round((tko_completedItems / tko_data.items.length) * 100) : 0,
    activeSprint: tko_data.sprints.find(tko_sprint => tko_sprint.state === "active") ?? null,
    plannedSprintCount: tko_data.sprints.filter(tko_sprint => tko_sprint.state === "planned").length,
    workload: Array.from(tko_workload.values()).filter(tko_entry => tko_entry.assignedItems > 0).sort((tko_left, tko_right) => tko_right.assignedItems - tko_left.assignedItems),
  };
}

export async function searchProject(tko_actor: PlatformActor, tko_input: { projectId: string; query: string; statusId?: string; sprintId?: string; assigneeMemberId?: string; limit?: number }): Promise<ProjectSearchResult[]> {
  const tko_data = await board(tko_actor, tko_input.projectId);
  const tko_query = tko_input.query.trim().toLocaleLowerCase();
  const tko_limit = Math.min(Math.max(tko_input.limit ?? 30, 1), 100);
  const tko_members = await getPlatformStore().listTenantMembers(tko_actor.tenantId);
  const tko_memberById = new Map(tko_members.map(tko_member => [tko_member.id, tko_member]));
  const tko_items = tko_data.items
    .filter(tko_item => (!tko_input.statusId || tko_item.statusId === tko_input.statusId) && (!tko_input.sprintId || tko_item.sprintId === tko_input.sprintId) && (!tko_input.assigneeMemberId || tko_item.assigneeMemberIds.includes(tko_input.assigneeMemberId)))
    .filter(tko_item => !tko_query || `${tko_item.key} ${tko_item.title} ${tko_item.description} ${tko_item.assigneeMemberIds.map(tko_memberId => tko_memberById.get(tko_memberId)?.displayName ?? "").join(" ")}`.toLocaleLowerCase().includes(tko_query))
    .map(tko_item => ({ kind: "work_item" as const, id: tko_item.id, title: tko_item.title, summary: tko_item.key, statusId: tko_item.statusId, sprintId: tko_item.sprintId, updatedAt: tko_item.updatedAt }));
  const tko_sprints = tko_data.sprints
    .filter(tko_sprint => !tko_query || `${tko_sprint.name} ${tko_sprint.goal}`.toLocaleLowerCase().includes(tko_query))
    .map(tko_sprint => ({ kind: "sprint" as const, id: tko_sprint.id, title: tko_sprint.name, summary: tko_sprint.goal || tko_sprint.state }));
  const tko_projectMemberIds = new Set(tko_data.items.flatMap(tko_item => tko_item.assigneeMemberIds));
  const tko_memberResults = tko_members
    .filter(tko_member => tko_projectMemberIds.has(tko_member.id) && (!tko_query || tko_member.displayName.toLocaleLowerCase().includes(tko_query)))
    .map(tko_member => ({ kind: "member" as const, id: tko_member.id, title: tko_member.displayName, summary: "Project assignee" }));
  const tko_fileResults = (await Promise.all(tko_data.items.map(async tko_item => (await getWorkStore().listAttachments(tko_actor.tenantId, tko_item.id)).map(tko_attachment => ({ kind: "file" as const, id: tko_attachment.id, workItemId: tko_item.id, title: tko_attachment.filename, summary: tko_item.key, updatedAt: tko_attachment.createdAt })))))
    .flat()
    .filter(tko_attachment => !tko_query || `${tko_attachment.title} ${tko_attachment.summary}`.toLocaleLowerCase().includes(tko_query));
  return [...tko_items, ...tko_sprints, ...tko_memberResults, ...tko_fileResults].slice(0, tko_limit);
}

/** Central project file library: attachment bytes remain in S3; only authorized metadata is projected here. */
export async function projectFiles(tko_actor: PlatformActor, tko_projectId: string) {
  const tko_data = await board(tko_actor, tko_projectId);
  const tko_files = (await Promise.all(tko_data.items.map(async tko_item =>
    (await getWorkStore().listAttachments(tko_actor.tenantId, tko_item.id)).map(tko_attachment => ({
      ...tko_attachment,
      workItemKey: tko_item.key,
      workItemTitle: tko_item.title,
    })),
  ))).flat();
  return tko_files.sort((tko_left, tko_right) => tko_right.createdAt.getTime() - tko_left.createdAt.getTime());
}

export async function itemDetails(tko_actor: PlatformActor, tko_workItemId: string) {
  const tko_item = await tko_itemFor(tko_actor, tko_workItemId);
  tko_require(tko_actor, "work.item.read", tko_item);
  return { item: tko_item, comments: await getWorkStore().listComments(tko_actor.tenantId, tko_item.id), dependencies: await getWorkStore().listDependencies(tko_actor.tenantId, tko_item.id), checklistItems: await getWorkStore().listChecklistItems(tko_actor.tenantId, tko_item.id), attachments: await getWorkStore().listAttachments(tko_actor.tenantId, tko_item.id), history: await getWorkStore().listHistory(tko_actor.tenantId, tko_item.id), customValues: await getWorkStore().listCustomFieldValues(tko_actor.tenantId, tko_item.id) };
}

export async function createWorkflowStatus(tko_actor: PlatformActor, tko_input: { projectId: string; name: string; category: WorkflowStatus["category"]; colorToken: string; description?: string; correlationId: string }) {
  const tko_project = await tko_projectFor(tko_actor, tko_input.projectId);
  tko_require(tko_actor, "work.project.manage", tko_project);
  return getWorkStore().createStatus(tko_actor, tko_input);
}

export async function updateWorkflowStatus(tko_actor: PlatformActor, tko_input: { projectId: string; statusId: string; name?: string; category?: WorkflowStatus["category"]; colorToken?: string; description?: string; correlationId: string }) {
  const tko_project = await tko_projectFor(tko_actor, tko_input.projectId);
  tko_require(tko_actor, "work.project.manage", tko_project);
  return getWorkStore().updateStatus(tko_actor, tko_input);
}

export async function reorderWorkflowStatus(tko_input: ReorderWorkflowStatusInput) {
  const tko_project = await tko_projectFor(tko_input.actor, tko_input.projectId);
  tko_require(tko_input.actor, "work.project.manage", tko_project);
  return getWorkStore().reorderStatus(tko_input);
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
  const tko_startAt = tko_input.startAt === undefined ? tko_item.startAt : tko_input.startAt;
  const tko_dueAt = tko_input.dueAt === undefined ? tko_item.dueAt : tko_input.dueAt;
  if (tko_startAt && tko_dueAt && tko_startAt.getTime() > tko_dueAt.getTime()) throw new Error("WORK_ITEM_DATE_RANGE_INVALID");
  return getWorkStore().updateWorkItem(tko_input);
}

/** Archive is the supported destructive action: it preserves tenant auditability and related history. */
export async function archiveWorkItem(tko_input: ArchiveWorkItemInput) {
  const tko_item = await getWorkStore().getWorkItem(tko_input.actor.tenantId, tko_input.workItemId);
  if (!tko_item || tko_item.archivedAt) throw new Error("WORK_ITEM_NOT_FOUND");
  tko_require(tko_input.actor, "work.item.archive", tko_item);
  return getWorkStore().archiveWorkItem(tko_input);
}

export async function createComment(tko_input: CreateCommentInput) {
  const tko_item = await tko_itemFor(tko_input.actor, tko_input.workItemId);
  tko_require(tko_input.actor, "work.comment.create", tko_item);
  return getWorkStore().createComment(tko_input);
}

export async function createChecklistItem(tko_actor: PlatformActor, tko_input: { workItemId: string; body: string; correlationId: string }) {
  const tko_item = await tko_itemFor(tko_actor, tko_input.workItemId);
  tko_require(tko_actor, "work.item.update", tko_item);
  return getWorkStore().createChecklistItem(tko_actor, tko_input);
}

export async function toggleChecklistItem(tko_actor: PlatformActor, tko_input: { workItemId: string; checklistItemId: string; completed: boolean; correlationId: string }) {
  const tko_item = await tko_itemFor(tko_actor, tko_input.workItemId);
  tko_require(tko_actor, "work.item.update", tko_item);
  return getWorkStore().toggleChecklistItem(tko_actor, tko_input);
}

export async function uploadWorkAttachment(tko_actor: PlatformActor, tko_input: { workItemId: string; filename: string; contentType: string; base64: string; correlationId: string }) {
  const tko_item = await tko_itemFor(tko_actor, tko_input.workItemId);
  tko_require(tko_actor, "work.item.update", tko_item);
  if (!/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i.test(tko_input.contentType)) throw new Error("WORK_ATTACHMENT_CONTENT_TYPE_INVALID");
  const tko_bytes = Buffer.from(tko_input.base64, "base64");
  if (!tko_bytes.byteLength || tko_bytes.byteLength > 10 * 1024 * 1024) throw new Error("WORK_ATTACHMENT_SIZE_INVALID");
  const tko_stored = await uploadTenantAttachment({ actor: tko_actor, filename: tko_input.filename, contentType: tko_input.contentType, bytes: tko_bytes });
  return getWorkStore().createAttachment(tko_actor, { workItemId: tko_item.id, objectKey: tko_stored.objectKey, filename: tko_stored.filename, contentType: tko_stored.contentType, byteSize: tko_bytes.byteLength, correlationId: tko_input.correlationId });
}

export async function attachmentDownloadUrl(tko_actor: PlatformActor, tko_input: { workItemId: string; attachmentId: string }) {
  const tko_item = await tko_itemFor(tko_actor, tko_input.workItemId);
  tko_require(tko_actor, "work.item.read", tko_item);
  const tko_attachment = (await getWorkStore().listAttachments(tko_actor.tenantId, tko_item.id)).find(tko_entry => tko_entry.id === tko_input.attachmentId);
  if (!tko_attachment) throw new Error("WORK_ATTACHMENT_NOT_FOUND");
  return { url: await getTenantAttachmentDownloadUrl(tko_actor, tko_attachment) };
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

export async function startSprint(tko_actor: PlatformActor, tko_input: { projectId: string; sprintId: string; correlationId: string }) {
  const tko_project = await tko_projectFor(tko_actor, tko_input.projectId);
  tko_require(tko_actor, "work.sprint.manage", tko_project);
  return getWorkStore().startSprint({ actor: tko_actor, ...tko_input });
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
