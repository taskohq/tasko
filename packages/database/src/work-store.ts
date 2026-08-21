import type {
  ArchiveWorkItemInput,
  CreateProjectInvitationInput,
  CreateCommentInput,
  CompleteSprintInput,
  CreateProjectInput,
  ReorderWorkflowStatusInput,
  CreateSprintInput,
  CreateWorkItemInput,
  MoveWorkItemInput,
  ProjectMember,
  ProjectMemberRole,
  ProjectInvitation,
  ProjectInvitationIssue,
  ResendProjectInvitationInput,
  RevokeProjectInvitationInput,
  RemoveProjectMemberInput,
  UpdateProjectVisibilityInput,
  UpdateWorkItemInput,
  UpsertProjectMemberInput,
  ProjectMethodology,
  TransitionWorkItemInput,
  ToggleWorkCommentReactionInput,
  WorkComment,
  WorkCommentAttachment,
  WorkCommentReaction,
  WorkChecklistItem,
  WorkAttachment,
  WorkCustomFieldDefinition,
  WorkCustomFieldType,
  WorkCustomFieldValue,
  WorkHistoryEntry,
  WorkItem,
  WorkItemRelation,
  WorkItemRelationType,
  WorkProject,
  WorkSpace,
  WorkSprint,
  WorkType,
  WorkflowStatus,
} from "../../contracts/src/work";
import type { PlatformActor } from "../../contracts/src/platform";
import { getPlatformStore } from "./platform-store";
import { tko_config } from "../../config/src/tasko-config";
import { PostgresWorkStore } from "./postgres-work-store";

export interface WorkBoardData {
  project: WorkProject;
  statuses: WorkflowStatus[];
  items: WorkItem[];
}

export interface WorkSavedView {
  id: string;
  tenantId: string;
  ownerMemberId: string;
  projectId: string;
  name: string;
  renderer: "list" | "board" | "calendar" | "timeline";
  visibility: "private" | "workspace";
  filter: Record<string, unknown>;
  layout: Record<string, unknown>;
}

export interface WorkStore {
  createSpace(tko_actor: PlatformActor, tko_input: { name: string; slug: string; visibility: WorkSpace["visibility"]; correlationId: string }): Promise<WorkSpace>;
  listSpaces(tko_tenantId: string): Promise<WorkSpace[]>;
  createProject(tko_input: CreateProjectInput): Promise<WorkProject>;
  listProjects(tko_tenantId: string): Promise<WorkProject[]>;
  getProject(tko_tenantId: string, tko_projectId: string): Promise<WorkProject | null>;
  listProjectMembers(tko_tenantId: string, tko_projectId: string): Promise<ProjectMember[]>;
  updateProjectVisibility(tko_input: UpdateProjectVisibilityInput): Promise<WorkProject>;
  upsertProjectMember(tko_input: UpsertProjectMemberInput): Promise<ProjectMember>;
  removeProjectMember(tko_input: RemoveProjectMemberInput): Promise<void>;
  listProjectInvitations(tko_tenantId: string, tko_projectId: string): Promise<ProjectInvitation[]>;
  createProjectInvitation(tko_input: CreateProjectInvitationInput): Promise<ProjectInvitationIssue>;
  resendProjectInvitation(tko_input: ResendProjectInvitationInput): Promise<ProjectInvitationIssue>;
  redeemProjectInvitation(tko_input: { actor: PlatformActor; token: string; recipientEmail: string | null; correlationId: string }): Promise<ProjectMember>;
  revokeProjectInvitation(tko_input: RevokeProjectInvitationInput): Promise<void>;
  listStatuses(tko_tenantId: string, tko_workflowId: string): Promise<WorkflowStatus[]>;
  createStatus(tko_actor: PlatformActor, tko_input: { projectId: string; name: string; category: WorkflowStatus["category"]; colorToken: string; description?: string; correlationId: string }): Promise<WorkflowStatus>;
  updateStatus(tko_actor: PlatformActor, tko_input: { projectId: string; statusId: string; name?: string; category?: WorkflowStatus["category"]; colorToken?: string; description?: string; correlationId: string }): Promise<WorkflowStatus>;
  reorderStatus(tko_input: ReorderWorkflowStatusInput): Promise<WorkflowStatus[]>;
  listWorkTypes(tko_tenantId: string, tko_projectId: string): Promise<WorkType[]>;
  createCustomField(tko_actor: PlatformActor, tko_input: { projectId: string; name: string; fieldType: WorkCustomFieldType; config?: Record<string, unknown>; correlationId: string }): Promise<WorkCustomFieldDefinition>;
  listCustomFields(tko_tenantId: string, tko_projectId: string): Promise<WorkCustomFieldDefinition[]>;
  setCustomFieldValue(tko_actor: PlatformActor, tko_input: { workItemId: string; fieldId: string; value: unknown; correlationId: string }): Promise<WorkCustomFieldValue>;
  listCustomFieldValues(tko_tenantId: string, tko_workItemId: string): Promise<WorkCustomFieldValue[]>;
  createWorkItem(tko_input: CreateWorkItemInput): Promise<WorkItem>;
  listWorkItems(tko_tenantId: string, tko_projectId: string, tko_options?: { includeArchived?: boolean }): Promise<WorkItem[]>;
  getWorkItem(tko_tenantId: string, tko_workItemId: string): Promise<WorkItem | null>;
  transitionWorkItem(tko_input: TransitionWorkItemInput): Promise<WorkItem>;
  moveWorkItem(tko_input: MoveWorkItemInput): Promise<WorkItem>;
  updateWorkItem(tko_input: UpdateWorkItemInput): Promise<WorkItem>;
  archiveWorkItem(tko_input: ArchiveWorkItemInput): Promise<WorkItem>;
  createComment(tko_input: CreateCommentInput): Promise<WorkComment>;
  listComments(tko_tenantId: string, tko_workItemId: string): Promise<WorkComment[]>;
  toggleCommentReaction(tko_input: ToggleWorkCommentReactionInput): Promise<WorkComment>;
  createCommentAttachment(tko_actor: PlatformActor, tko_input: Omit<WorkCommentAttachment, "id" | "tenantId" | "type" | "uploadedByMemberId" | "createdAt"> & { correlationId: string }): Promise<WorkCommentAttachment>;
  listChecklistItems(tko_tenantId: string, tko_workItemId: string): Promise<WorkChecklistItem[]>;
  createChecklistItem(tko_actor: PlatformActor, tko_input: { workItemId: string; body: string; correlationId: string }): Promise<WorkChecklistItem>;
  toggleChecklistItem(tko_actor: PlatformActor, tko_input: { workItemId: string; checklistItemId: string; completed: boolean; correlationId: string }): Promise<WorkChecklistItem>;
  createAttachment(tko_actor: PlatformActor, tko_input: Omit<WorkAttachment, "id" | "tenantId" | "type" | "uploadedByMemberId" | "createdAt"> & { correlationId: string }): Promise<WorkAttachment>;
  listAttachments(tko_tenantId: string, tko_workItemId: string): Promise<WorkAttachment[]>;
  removeAttachment(tko_actor: PlatformActor, tko_input: { workItemId: string; attachmentId: string; correlationId: string }): Promise<void>;
  addDependency(tko_actor: PlatformActor, tko_input: { sourceWorkItemId: string; targetWorkItemId: string; relationType: WorkItemRelationType; correlationId: string }): Promise<void>;
  listDependencies(tko_tenantId: string, tko_workItemId: string): Promise<WorkItemRelation[]>;
  removeDependency(tko_actor: PlatformActor, tko_input: { workItemId: string; relationId: string; correlationId: string }): Promise<void>;
  createSprint(tko_input: CreateSprintInput): Promise<WorkSprint>;
  startSprint(tko_input: { actor: PlatformActor; projectId: string; sprintId: string; correlationId: string }): Promise<WorkSprint>;
  addItemsToSprint(tko_actor: PlatformActor, tko_input: { sprintId: string; workItemIds: string[]; correlationId: string }): Promise<void>;
  completeSprint(tko_actor: PlatformActor, tko_input: CompleteSprintInput): Promise<WorkSprint>;
  listSprints(tko_tenantId: string, tko_projectId: string): Promise<WorkSprint[]>;
  saveView(tko_actor: PlatformActor, tko_input: Omit<WorkSavedView, "id" | "tenantId" | "ownerMemberId"> & { correlationId: string }): Promise<WorkSavedView>;
  listViews(tko_tenantId: string, tko_projectId: string, tko_memberId: string): Promise<WorkSavedView[]>;
  listHistory(tko_tenantId: string, tko_workItemId: string): Promise<WorkHistoryEntry[]>;
  seedDemoWork(tko_actor: PlatformActor): Promise<WorkBoardData>;
}

const tko_defaultStatuses: Array<Pick<WorkflowStatus, "name" | "category" | "colorToken" | "sortOrder">> = [
  { name: "To do", category: "todo", colorToken: "status.todo", sortOrder: 100 },
  { name: "In progress", category: "in_progress", colorToken: "status.progress", sortOrder: 200 },
  { name: "Done", category: "done", colorToken: "status.done", sortOrder: 300 },
];

const tko_builtinTypes: Array<Pick<WorkType, "name" | "category" | "icon">> = [
  { name: "Epic", category: "epic", icon: "layers" },
  { name: "Story", category: "story", icon: "book-open" },
  { name: "Task", category: "task", icon: "check-square" },
  { name: "Bug", category: "bug", icon: "bug" },
  { name: "Request", category: "request", icon: "inbox" },
  { name: "Milestone", category: "milestone", icon: "flag" },
];

function tko_clone<T>(tko_value: T): T {
  return structuredClone(tko_value);
}

function tko_slugify(tko_value: string): string {
  return tko_value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "") || "space";
}

function tko_projectKey(tko_value: string): string {
  const tko_key = tko_value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (tko_key.length < 2 || tko_key.length > 10) throw new Error("WORK_PROJECT_KEY_INVALID");
  return tko_key;
}

function tko_now(): Date {
  return new Date();
}

async function tko_invitationTokenHash(tko_token: string): Promise<string> {
  const tko_digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(tko_token));
  return Buffer.from(tko_digest).toString("hex");
}

export class MemoryWorkStore implements WorkStore {
  private readonly tko_spaces = new Map<string, WorkSpace>();
  private readonly tko_projects = new Map<string, WorkProject>();
  private readonly tko_projectMembers = new Map<string, ProjectMember>();
  private readonly tko_projectInvitations = new Map<string, ProjectInvitation & { tokenHash: string }>();
  private readonly tko_statuses = new Map<string, WorkflowStatus>();
  private readonly tko_workTypes = new Map<string, WorkType>();
  private readonly tko_items = new Map<string, WorkItem>();
  private readonly tko_comments = new Map<string, WorkComment>();
  private readonly tko_commentReactions = new Map<string, WorkCommentReaction>();
  private readonly tko_commentAttachments = new Map<string, WorkCommentAttachment>();
  private readonly tko_checklistItems = new Map<string, WorkChecklistItem>();
  private readonly tko_attachments = new Map<string, WorkAttachment>();
  private readonly tko_sprints = new Map<string, WorkSprint>();
  private readonly tko_sprintItems = new Map<string, Set<string>>();
  private readonly tko_views = new Map<string, WorkSavedView>();
  private readonly tko_customFields = new Map<string, WorkCustomFieldDefinition>();
  private readonly tko_customFieldValues = new Map<string, WorkCustomFieldValue>();
  private readonly tko_history: WorkHistoryEntry[] = [];
  private readonly tko_relations = new Map<string, WorkItemRelation>();

  async createSpace(tko_actor: PlatformActor, tko_input: { name: string; slug: string; visibility: WorkSpace["visibility"]; correlationId: string }): Promise<WorkSpace> {
    const tko_existing = Array.from(this.tko_spaces.values()).find(
      tko_space => tko_space.tenantId === tko_actor.tenantId && tko_space.slug === tko_input.slug,
    );
    if (tko_existing) return tko_clone(tko_existing);
    const tko_space: WorkSpace = {
      id: crypto.randomUUID(), tenantId: tko_actor.tenantId, type: "space", name: tko_input.name,
      slug: tko_slugify(tko_input.slug), visibility: tko_input.visibility, archivedAt: null,
    };
    this.tko_spaces.set(tko_space.id, tko_space);
    await this.tko_emit(tko_actor, "work.space_created.v1", "work.space", { spaceId: tko_space.id, name: tko_space.name }, "work.space.created", "space", tko_space.id, tko_input.correlationId);
    return tko_clone(tko_space);
  }

  async listSpaces(tko_tenantId: string): Promise<WorkSpace[]> {
    return Array.from(this.tko_spaces.values()).filter(tko_space => tko_space.tenantId === tko_tenantId && !tko_space.archivedAt).map(tko_clone);
  }

  async createProject(tko_input: CreateProjectInput): Promise<WorkProject> {
    const tko_space = this.tko_spaces.get(tko_input.spaceId);
    if (!tko_space || tko_space.tenantId !== tko_input.actor.tenantId) throw new Error("WORK_SPACE_NOT_FOUND");
    const tko_key = tko_projectKey(tko_input.key);
    if (Array.from(this.tko_projects.values()).some(tko_project => tko_project.tenantId === tko_input.actor.tenantId && tko_project.key === tko_key)) throw new Error("WORK_PROJECT_KEY_TAKEN");
    const tko_workflowId = crypto.randomUUID();
    const tko_projectId = crypto.randomUUID();
    for (const tko_status of tko_defaultStatuses) {
      const tko_record: WorkflowStatus = { id: crypto.randomUUID(), tenantId: tko_input.actor.tenantId, type: "workflow_status", workflowId: tko_workflowId, description: "", ...tko_status };
      this.tko_statuses.set(tko_record.id, tko_record);
    }
    for (const tko_type of tko_builtinTypes) {
      const tko_record: WorkType = { id: crypto.randomUUID(), tenantId: tko_input.actor.tenantId, type: "work_type", projectId: tko_projectId, ...tko_type };
      this.tko_workTypes.set(tko_record.id, tko_record);
    }
    const tko_project: WorkProject = {
      id: tko_projectId, tenantId: tko_input.actor.tenantId, type: "project", spaceId: tko_space.id,
      key: tko_key, name: tko_input.name.trim(), description: tko_input.description?.trim() ?? "",
      ownerMemberId: tko_input.actor.memberId, visibility: tko_input.visibility, methodology: tko_input.methodology,
      explicitMemberIds: [tko_input.actor.memberId], projectMemberRoles: { [tko_input.actor.memberId]: "editor" },
      workflowId: tko_workflowId, sequenceCounter: 0, archivedAt: null,
    };
    this.tko_projects.set(tko_project.id, tko_project);
    const tko_ownerMembership: ProjectMember = {
      id: `${tko_project.id}:${tko_input.actor.memberId}`, tenantId: tko_project.tenantId, type: "project_member",
      projectId: tko_project.id, memberId: tko_input.actor.memberId, projectRole: "editor",
      addedByMemberId: tko_input.actor.memberId, createdAt: tko_now(),
    };
    this.tko_projectMembers.set(tko_ownerMembership.id, tko_ownerMembership);
    await this.tko_emit(tko_input.actor, "work.project_created.v1", "work.project", { projectId: tko_project.id, key: tko_project.key, methodology: tko_project.methodology }, "work.project.created", "project", tko_project.id, tko_input.correlationId);
    return tko_clone(tko_project);
  }

  async listProjects(tko_tenantId: string): Promise<WorkProject[]> {
    return Array.from(this.tko_projects.values()).filter(tko_project => tko_project.tenantId === tko_tenantId && !tko_project.archivedAt).map(tko_clone);
  }

  async getProject(tko_tenantId: string, tko_projectId: string): Promise<WorkProject | null> {
    const tko_project = this.tko_projects.get(tko_projectId);
    return tko_project?.tenantId === tko_tenantId ? tko_clone(tko_project) : null;
  }

  async listProjectMembers(tko_tenantId: string, tko_projectId: string): Promise<ProjectMember[]> {
    return Array.from(this.tko_projectMembers.values())
      .filter(tko_member => tko_member.tenantId === tko_tenantId && tko_member.projectId === tko_projectId)
      .sort((tko_left, tko_right) => tko_left.createdAt.getTime() - tko_right.createdAt.getTime())
      .map(tko_clone);
  }

  async updateProjectVisibility(tko_input: UpdateProjectVisibilityInput): Promise<WorkProject> {
    const tko_project = this.tko_projects.get(tko_input.projectId);
    if (!tko_project || tko_project.tenantId !== tko_input.actor.tenantId || tko_project.archivedAt) throw new Error("WORK_PROJECT_NOT_FOUND");
    const tko_before = tko_project.visibility;
    tko_project.visibility = tko_input.visibility;
    this.tko_projects.set(tko_project.id, tko_project);
    await this.tko_emit(tko_input.actor, "work.project_visibility_updated.v1", "work.project", { projectId: tko_project.id, before: tko_before, after: tko_project.visibility }, "work.project.visibility_updated", "project", tko_project.id, tko_input.correlationId);
    return tko_clone(tko_project);
  }

  async upsertProjectMember(tko_input: UpsertProjectMemberInput): Promise<ProjectMember> {
    const tko_project = this.tko_projects.get(tko_input.projectId);
    if (!tko_project || tko_project.tenantId !== tko_input.actor.tenantId || tko_project.archivedAt) throw new Error("WORK_PROJECT_NOT_FOUND");
    const tko_id = `${tko_project.id}:${tko_input.memberId}`;
    const tko_existing = this.tko_projectMembers.get(tko_id);
    const tko_member: ProjectMember = {
      id: tko_id, tenantId: tko_project.tenantId, type: "project_member", projectId: tko_project.id,
      memberId: tko_input.memberId, projectRole: tko_input.projectRole,
      addedByMemberId: tko_existing?.addedByMemberId ?? tko_input.actor.memberId,
      createdAt: tko_existing?.createdAt ?? tko_now(),
    };
    this.tko_projectMembers.set(tko_id, tko_member);
    tko_project.explicitMemberIds = Array.from(new Set([...tko_project.explicitMemberIds, tko_member.memberId]));
    tko_project.projectMemberRoles[tko_member.memberId] = tko_member.projectRole;
    this.tko_projects.set(tko_project.id, tko_project);
    await this.tko_emit(tko_input.actor, "work.project_member_upserted.v1", "work.project", { projectId: tko_project.id, memberId: tko_member.memberId, beforeRole: tko_existing?.projectRole ?? null, projectRole: tko_member.projectRole }, "work.project.member_upserted", "project", tko_project.id, tko_input.correlationId);
    return tko_clone(tko_member);
  }

  async removeProjectMember(tko_input: RemoveProjectMemberInput): Promise<void> {
    const tko_project = this.tko_projects.get(tko_input.projectId);
    if (!tko_project || tko_project.tenantId !== tko_input.actor.tenantId || tko_project.archivedAt) throw new Error("WORK_PROJECT_NOT_FOUND");
    if (tko_project.ownerMemberId === tko_input.memberId) throw new Error("WORK_PROJECT_OWNER_MEMBER_REQUIRED");
    const tko_id = `${tko_project.id}:${tko_input.memberId}`;
    const tko_existing = this.tko_projectMembers.get(tko_id);
    if (!tko_existing) throw new Error("WORK_PROJECT_MEMBER_NOT_FOUND");
    this.tko_projectMembers.delete(tko_id);
    tko_project.explicitMemberIds = tko_project.explicitMemberIds.filter(tko_memberId => tko_memberId !== tko_input.memberId);
    delete tko_project.projectMemberRoles[tko_input.memberId];
    this.tko_projects.set(tko_project.id, tko_project);
    await this.tko_emit(tko_input.actor, "work.project_member_removed.v1", "work.project", { projectId: tko_project.id, memberId: tko_input.memberId, projectRole: tko_existing.projectRole }, "work.project.member_removed", "project", tko_project.id, tko_input.correlationId);
  }

  async listProjectInvitations(tko_tenantId: string, tko_projectId: string): Promise<ProjectInvitation[]> {
    return Array.from(this.tko_projectInvitations.values())
      .filter(tko_invitation => tko_invitation.tenantId === tko_tenantId && tko_invitation.projectId === tko_projectId)
      .sort((tko_left, tko_right) => tko_right.createdAt.getTime() - tko_left.createdAt.getTime())
      .map(({ tokenHash: _tko_tokenHash, ...tko_invitation }) => tko_clone(tko_invitation));
  }

  async createProjectInvitation(tko_input: CreateProjectInvitationInput): Promise<ProjectInvitationIssue> {
    const tko_project = this.tko_projects.get(tko_input.projectId);
    if (!tko_project || tko_project.tenantId !== tko_input.actor.tenantId || tko_project.archivedAt) throw new Error("WORK_PROJECT_NOT_FOUND");
    if (tko_input.expiresAt.getTime() <= Date.now()) throw new Error("WORK_PROJECT_INVITATION_EXPIRY_INVALID");
    const tko_token = crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", "");
    const tko_invitation: ProjectInvitation & { tokenHash: string } = {
      id: crypto.randomUUID(), tenantId: tko_input.actor.tenantId, type: "project_invitation", projectId: tko_project.id,
      inviteeEmail: tko_input.inviteeEmail?.trim().toLocaleLowerCase() || null, projectRole: tko_input.projectRole,
      createdByMemberId: tko_input.actor.memberId, expiresAt: tko_input.expiresAt, redeemedAt: null, redeemedByMemberId: null,
      revokedAt: null, createdAt: tko_now(), tokenHash: await tko_invitationTokenHash(tko_token),
    };
    this.tko_projectInvitations.set(tko_invitation.id, tko_invitation);
    await this.tko_emit(tko_input.actor, "work.project_invitation_created.v1", "work.project", { projectId: tko_project.id, invitationId: tko_invitation.id, inviteeEmail: tko_invitation.inviteeEmail, projectRole: tko_invitation.projectRole, expiresAt: tko_invitation.expiresAt }, "work.project.invitation_created", "project", tko_project.id, tko_input.correlationId);
    const { tokenHash: _tko_tokenHash, ...tko_safe } = tko_invitation;
    return { invitation: tko_clone(tko_safe), token: tko_token };
  }

  async resendProjectInvitation(tko_input: ResendProjectInvitationInput): Promise<ProjectInvitationIssue> {
    const tko_previous = this.tko_projectInvitations.get(tko_input.invitationId);
    if (!tko_previous || tko_previous.tenantId !== tko_input.actor.tenantId || tko_previous.projectId !== tko_input.projectId) throw new Error("WORK_PROJECT_INVITATION_NOT_FOUND");
    if (tko_previous.redeemedAt || tko_previous.revokedAt) throw new Error("WORK_PROJECT_INVITATION_NOT_RESENDABLE");
    if (tko_input.expiresAt.getTime() <= Date.now()) throw new Error("WORK_PROJECT_INVITATION_EXPIRY_INVALID");
    tko_previous.revokedAt = tko_now();
    this.tko_projectInvitations.set(tko_previous.id, tko_previous);
    const tko_token = crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", "");
    const tko_invitation: ProjectInvitation & { tokenHash: string } = {
      id: crypto.randomUUID(), tenantId: tko_input.actor.tenantId, type: "project_invitation", projectId: tko_previous.projectId,
      inviteeEmail: tko_previous.inviteeEmail, projectRole: tko_previous.projectRole, createdByMemberId: tko_input.actor.memberId,
      expiresAt: tko_input.expiresAt, redeemedAt: null, redeemedByMemberId: null, revokedAt: null, createdAt: tko_now(),
      tokenHash: await tko_invitationTokenHash(tko_token),
    };
    this.tko_projectInvitations.set(tko_invitation.id, tko_invitation);
    await this.tko_emit(tko_input.actor, "work.project_invitation_resent.v1", "work.project", { projectId: tko_invitation.projectId, previousInvitationId: tko_previous.id, invitationId: tko_invitation.id, inviteeEmail: tko_invitation.inviteeEmail, projectRole: tko_invitation.projectRole, expiresAt: tko_invitation.expiresAt }, "work.project.invitation_resent", "project", tko_invitation.projectId, tko_input.correlationId);
    const { tokenHash: _tko_tokenHash, ...tko_safe } = tko_invitation;
    return { invitation: tko_clone(tko_safe), token: tko_token };
  }

  async redeemProjectInvitation(tko_input: { actor: PlatformActor; token: string; recipientEmail: string | null; correlationId: string }): Promise<ProjectMember> {
    const tko_tokenHash = await tko_invitationTokenHash(tko_input.token);
    const tko_invitation = Array.from(this.tko_projectInvitations.values()).find(tko_entry => tko_entry.tenantId === tko_input.actor.tenantId && tko_entry.tokenHash === tko_tokenHash);
    if (!tko_invitation) throw new Error("WORK_PROJECT_INVITATION_INVALID");
    if (tko_invitation.revokedAt) throw new Error("WORK_PROJECT_INVITATION_REVOKED");
    if (tko_invitation.redeemedAt) throw new Error("WORK_PROJECT_INVITATION_REDEEMED");
    if (tko_invitation.expiresAt.getTime() <= Date.now()) throw new Error("WORK_PROJECT_INVITATION_EXPIRED");
    if (tko_invitation.inviteeEmail && tko_invitation.inviteeEmail !== tko_input.recipientEmail?.trim().toLocaleLowerCase()) throw new Error("WORK_PROJECT_INVITATION_EMAIL_MISMATCH");
    tko_invitation.redeemedAt = tko_now();
    tko_invitation.redeemedByMemberId = tko_input.actor.memberId;
    this.tko_projectInvitations.set(tko_invitation.id, tko_invitation);
    const tko_member = await this.upsertProjectMember({ actor: tko_input.actor, projectId: tko_invitation.projectId, memberId: tko_input.actor.memberId, projectRole: tko_invitation.projectRole, correlationId: tko_input.correlationId });
    await this.tko_emit(tko_input.actor, "work.project_invitation_redeemed.v1", "work.project", { projectId: tko_invitation.projectId, invitationId: tko_invitation.id, memberId: tko_member.memberId, projectRole: tko_member.projectRole }, "work.project.invitation_redeemed", "project", tko_invitation.projectId, tko_input.correlationId);
    return tko_member;
  }

  async revokeProjectInvitation(tko_input: RevokeProjectInvitationInput): Promise<void> {
    const tko_invitation = this.tko_projectInvitations.get(tko_input.invitationId);
    if (!tko_invitation || tko_invitation.tenantId !== tko_input.actor.tenantId || tko_invitation.projectId !== tko_input.projectId) throw new Error("WORK_PROJECT_INVITATION_NOT_FOUND");
    if (tko_invitation.redeemedAt || tko_invitation.revokedAt) throw new Error("WORK_PROJECT_INVITATION_NOT_REVOCABLE");
    tko_invitation.revokedAt = tko_now();
    this.tko_projectInvitations.set(tko_invitation.id, tko_invitation);
    await this.tko_emit(tko_input.actor, "work.project_invitation_revoked.v1", "work.project", { projectId: tko_invitation.projectId, invitationId: tko_invitation.id }, "work.project.invitation_revoked", "project", tko_invitation.projectId, tko_input.correlationId);
  }

  async listStatuses(tko_tenantId: string, tko_workflowId: string): Promise<WorkflowStatus[]> {
    return Array.from(this.tko_statuses.values()).filter(tko_status => tko_status.tenantId === tko_tenantId && tko_status.workflowId === tko_workflowId).sort((tko_left, tko_right) => tko_left.sortOrder - tko_right.sortOrder).map(tko_clone);
  }

  async createStatus(tko_actor: PlatformActor, tko_input: { projectId: string; name: string; category: WorkflowStatus["category"]; colorToken: string; description?: string; correlationId: string }): Promise<WorkflowStatus> {
    const tko_project = await this.getProject(tko_actor.tenantId, tko_input.projectId);
    if (!tko_project) throw new Error("WORK_PROJECT_NOT_FOUND");
    const tko_existing = await this.listStatuses(tko_actor.tenantId, tko_project.workflowId);
    const tko_name = tko_input.name.trim();
    if (!tko_name) throw new Error("WORK_STATUS_NAME_INVALID");
    if (tko_existing.some(tko_status => tko_status.name.toLocaleLowerCase() === tko_name.toLocaleLowerCase())) throw new Error("WORK_STATUS_NAME_TAKEN");
    const tko_status: WorkflowStatus = { id: crypto.randomUUID(), tenantId: tko_actor.tenantId, type: "workflow_status", workflowId: tko_project.workflowId, name: tko_name, category: tko_input.category, colorToken: tko_input.colorToken, description: tko_input.description?.trim() ?? "", sortOrder: (tko_existing.at(-1)?.sortOrder ?? 0) + 100 };
    this.tko_statuses.set(tko_status.id, tko_status);
    await this.tko_emit(tko_actor, "work.workflow_status_created.v1", "work.project", { projectId: tko_project.id, statusId: tko_status.id, name: tko_status.name }, "work.workflow_status.created", "workflow_status", tko_status.id, tko_input.correlationId);
    return tko_clone(tko_status);
  }

  async updateStatus(tko_actor: PlatformActor, tko_input: { projectId: string; statusId: string; name?: string; category?: WorkflowStatus["category"]; colorToken?: string; description?: string; correlationId: string }): Promise<WorkflowStatus> {
    const tko_project = await this.getProject(tko_actor.tenantId, tko_input.projectId);
    const tko_status = this.tko_statuses.get(tko_input.statusId);
    if (!tko_project || !tko_status || tko_status.tenantId !== tko_actor.tenantId || tko_status.workflowId !== tko_project.workflowId) throw new Error("WORK_STATUS_NOT_FOUND");
    const tko_before = tko_clone(tko_status);
    if (tko_input.name !== undefined) tko_status.name = tko_input.name.trim();
    if (tko_input.category !== undefined) tko_status.category = tko_input.category;
    if (tko_input.colorToken !== undefined) tko_status.colorToken = tko_input.colorToken;
    if (tko_input.description !== undefined) tko_status.description = tko_input.description.trim();
    this.tko_statuses.set(tko_status.id, tko_status);
    await this.tko_emit(tko_actor, "work.workflow_status_updated.v1", "work.project", { projectId: tko_project.id, statusId: tko_status.id, before: tko_before, after: tko_status }, "work.workflow_status.updated", "workflow_status", tko_status.id, tko_input.correlationId);
    return tko_clone(tko_status);
  }

  async reorderStatus(tko_input: ReorderWorkflowStatusInput): Promise<WorkflowStatus[]> {
    const tko_project = await this.getProject(tko_input.actor.tenantId, tko_input.projectId);
    if (!tko_project) throw new Error("WORK_PROJECT_NOT_FOUND");
    const tko_current = await this.listStatuses(tko_input.actor.tenantId, tko_project.workflowId);
    const tko_moved = tko_current.find(tko_status => tko_status.id === tko_input.statusId);
    if (!tko_moved) throw new Error("WORK_STATUS_NOT_FOUND");
    if (tko_input.beforeStatusId === tko_moved.id) throw new Error("WORK_STATUS_REORDER_INVALID");
    const tko_remaining = tko_current.filter(tko_status => tko_status.id !== tko_moved.id);
    const tko_index = tko_input.beforeStatusId === undefined || tko_input.beforeStatusId === null
      ? tko_remaining.length
      : tko_remaining.findIndex(tko_status => tko_status.id === tko_input.beforeStatusId);
    if (tko_index < 0) throw new Error("WORK_STATUS_REORDER_TARGET_NOT_FOUND");
    const tko_ordered = [...tko_remaining.slice(0, tko_index), tko_moved, ...tko_remaining.slice(tko_index)].map((tko_status, tko_index) => ({ ...tko_status, sortOrder: (tko_index + 1) * 100 }));
    for (const tko_status of tko_ordered) this.tko_statuses.set(tko_status.id, tko_status);
    await this.tko_emit(tko_input.actor, "work.workflow_status_reordered.v1", "work.project", { projectId: tko_project.id, statusId: tko_moved.id, beforeStatusId: tko_input.beforeStatusId ?? null, orderedStatusIds: tko_ordered.map(tko_status => tko_status.id) }, "work.workflow_status.reordered", "workflow_status", tko_moved.id, tko_input.correlationId);
    return tko_ordered.map(tko_clone);
  }

  async listWorkTypes(tko_tenantId: string, tko_projectId: string): Promise<WorkType[]> {
    return Array.from(this.tko_workTypes.values()).filter(tko_type => tko_type.tenantId === tko_tenantId && (tko_type.projectId === null || tko_type.projectId === tko_projectId)).map(tko_clone);
  }

  async createCustomField(tko_actor: PlatformActor, tko_input: { projectId: string; name: string; fieldType: WorkCustomFieldType; config?: Record<string, unknown>; correlationId: string }): Promise<WorkCustomFieldDefinition> {
    const tko_project = await this.getProject(tko_actor.tenantId, tko_input.projectId);
    if (!tko_project) throw new Error("WORK_PROJECT_NOT_FOUND");
    const tko_field: WorkCustomFieldDefinition = { id: crypto.randomUUID(), tenantId: tko_actor.tenantId, type: "custom_field", projectId: tko_project.id, name: tko_input.name.trim(), fieldType: tko_input.fieldType, config: tko_clone(tko_input.config ?? {}), createdAt: tko_now() };
    this.tko_customFields.set(tko_field.id, tko_field);
    await this.tko_emit(tko_actor, "work.custom_field_created.v1", "work.project", { projectId: tko_project.id, fieldId: tko_field.id, fieldType: tko_field.fieldType }, "work.custom_field.created", "custom_field", tko_field.id, tko_input.correlationId);
    return tko_clone(tko_field);
  }

  async listCustomFields(tko_tenantId: string, tko_projectId: string): Promise<WorkCustomFieldDefinition[]> {
    return Array.from(this.tko_customFields.values()).filter(tko_field => tko_field.tenantId === tko_tenantId && tko_field.projectId === tko_projectId).map(tko_clone);
  }

  async setCustomFieldValue(tko_actor: PlatformActor, tko_input: { workItemId: string; fieldId: string; value: unknown; correlationId: string }): Promise<WorkCustomFieldValue> {
    const tko_item = await this.getWorkItem(tko_actor.tenantId, tko_input.workItemId);
    const tko_field = this.tko_customFields.get(tko_input.fieldId);
    if (!tko_item || !tko_field || tko_field.tenantId !== tko_actor.tenantId || tko_field.projectId !== tko_item.projectId) throw new Error("WORK_CUSTOM_FIELD_NOT_FOUND");
    const tko_key = `${tko_field.id}:${tko_item.id}`;
    const tko_before = this.tko_customFieldValues.get(tko_key)?.value ?? null;
    const tko_value: WorkCustomFieldValue = { id: tko_key, tenantId: tko_actor.tenantId, type: "custom_field_value", fieldId: tko_field.id, workItemId: tko_item.id, value: tko_clone(tko_input.value) };
    this.tko_customFieldValues.set(tko_key, tko_value);
    await this.tko_historyEntry(tko_actor, tko_item, `custom:${tko_field.id}`, tko_before, tko_value.value);
    await this.tko_emit(tko_actor, "work.custom_field_value_set.v1", "work.item", { workItemId: tko_item.id, fieldId: tko_field.id }, "work.custom_field.value_set", "work_item", tko_item.id, tko_input.correlationId);
    return tko_clone(tko_value);
  }

  async listCustomFieldValues(tko_tenantId: string, tko_workItemId: string): Promise<WorkCustomFieldValue[]> {
    return Array.from(this.tko_customFieldValues.values()).filter(tko_value => tko_value.tenantId === tko_tenantId && tko_value.workItemId === tko_workItemId).map(tko_clone);
  }

  async createWorkItem(tko_input: CreateWorkItemInput): Promise<WorkItem> {
    const tko_project = await this.getProject(tko_input.actor.tenantId, tko_input.projectId);
    if (!tko_project || tko_project.archivedAt) throw new Error("WORK_PROJECT_NOT_FOUND");
    const tko_statuses = await this.listStatuses(tko_input.actor.tenantId, tko_project.workflowId);
    const tko_workTypes = await this.listWorkTypes(tko_input.actor.tenantId, tko_project.id);
    const tko_type = tko_input.workTypeId ? tko_workTypes.find(tko_entry => tko_entry.id === tko_input.workTypeId) : tko_workTypes.find(tko_entry => tko_entry.category === "task");
    if (!tko_type) throw new Error("WORK_TYPE_NOT_FOUND");
    const tko_initialStatus = tko_statuses.find(tko_status => tko_status.category === "todo");
    if (!tko_initialStatus) throw new Error("WORKFLOW_INITIAL_STATUS_MISSING");
    if (tko_input.parentId) {
      const tko_parent = await this.getWorkItem(tko_input.actor.tenantId, tko_input.parentId);
      if (!tko_parent || tko_parent.projectId !== tko_project.id) throw new Error("WORK_PARENT_INVALID");
    }
    tko_project.sequenceCounter += 1;
    this.tko_projects.set(tko_project.id, tko_project);
    const tko_record: WorkItem = {
      id: crypto.randomUUID(), tenantId: tko_input.actor.tenantId, type: "work_item", projectId: tko_project.id,
      sequenceNo: tko_project.sequenceCounter, key: `${tko_project.key}-${tko_project.sequenceCounter}`,
      workTypeId: tko_type.id, parentId: tko_input.parentId ?? null, workflowId: tko_project.workflowId,
      statusId: tko_initialStatus.id, title: tko_input.title.trim(), description: tko_input.description?.trim() ?? "",
      priority: tko_input.priority ?? "none", reporterMemberId: tko_input.actor.memberId,
      assigneeMemberIds: Array.from(new Set(tko_input.assigneeMemberIds ?? [])), startAt: tko_input.startAt ?? null,
      dueAt: tko_input.dueAt ?? null, estimateMinutes: tko_input.estimateMinutes ?? null, rank: tko_input.rank ?? "m",
      sprintId: null, version: 1, completedAt: null, archivedAt: null, createdAt: tko_now(), updatedAt: tko_now(),
    };
    this.tko_items.set(tko_record.id, tko_record);
    for (const [tko_index, tko_body] of Array.from((tko_input.checklistItems ?? []).map(tko_value => tko_value.trim()).filter(Boolean).entries())) {
      const tko_checklist: WorkChecklistItem = { id: crypto.randomUUID(), tenantId: tko_record.tenantId, type: "work_checklist_item", workItemId: tko_record.id, body: tko_body, completedAt: null, completedByMemberId: null, sortOrder: (tko_index + 1) * 100, createdByMemberId: tko_input.actor.memberId, createdAt: tko_now() };
      this.tko_checklistItems.set(tko_checklist.id, tko_checklist);
    }
    await this.tko_historyEntry(tko_input.actor, tko_record, "created", null, { key: tko_record.key, title: tko_record.title });
    await this.tko_emit(tko_input.actor, "work.work_item_created.v1", "work.item", { workItemId: tko_record.id, key: tko_record.key, projectId: tko_record.projectId }, "work.work_item.created", "work_item", tko_record.id, tko_input.correlationId);
    return tko_clone(tko_record);
  }

  async listWorkItems(tko_tenantId: string, tko_projectId: string, tko_options: { includeArchived?: boolean } = {}): Promise<WorkItem[]> {
    return Array.from(this.tko_items.values())
      .filter(tko_item => tko_item.tenantId === tko_tenantId && tko_item.projectId === tko_projectId && (tko_options.includeArchived || !tko_item.archivedAt))
      .sort((tko_left, tko_right) => tko_left.rank.localeCompare(tko_right.rank) || tko_left.sequenceNo - tko_right.sequenceNo)
      .map(tko_clone);
  }

  async getWorkItem(tko_tenantId: string, tko_workItemId: string): Promise<WorkItem | null> {
    const tko_item = this.tko_items.get(tko_workItemId);
    return tko_item?.tenantId === tko_tenantId ? tko_clone(tko_item) : null;
  }

  async transitionWorkItem(tko_input: TransitionWorkItemInput): Promise<WorkItem> {
    const tko_item = await this.getWorkItem(tko_input.actor.tenantId, tko_input.workItemId);
    if (!tko_item) throw new Error("WORK_ITEM_NOT_FOUND");
    if (tko_item.version !== tko_input.expectedVersion) throw new Error("WORK_ITEM_VERSION_CONFLICT");
    const tko_status = this.tko_statuses.get(tko_input.targetStatusId);
    if (!tko_status || tko_status.tenantId !== tko_item.tenantId || tko_status.workflowId !== tko_item.workflowId) throw new Error("WORK_ITEM_TRANSITION_NOT_ALLOWED");
    const tko_before = tko_item.statusId;
    tko_item.statusId = tko_status.id;
    tko_item.version += 1;
    tko_item.updatedAt = tko_now();
    tko_item.completedAt = tko_status.category === "done" ? tko_now() : null;
    this.tko_items.set(tko_item.id, tko_item);
    await this.tko_historyEntry(tko_input.actor, tko_item, "status_id", tko_before, tko_status.id);
    await this.tko_emit(tko_input.actor, "work.work_item_status_changed.v1", "work.item", { workItemId: tko_item.id, key: tko_item.key, beforeStatusId: tko_before, afterStatusId: tko_status.id, version: tko_item.version }, "work.work_item.status_changed", "work_item", tko_item.id, tko_input.correlationId);
    return tko_clone(tko_item);
  }

  async moveWorkItem(tko_input: MoveWorkItemInput): Promise<WorkItem> {
    const tko_item = await this.getWorkItem(tko_input.actor.tenantId, tko_input.workItemId);
    if (!tko_item) throw new Error("WORK_ITEM_NOT_FOUND");
    if (tko_item.version !== tko_input.expectedVersion) throw new Error("WORK_ITEM_VERSION_CONFLICT");
    const tko_status = this.tko_statuses.get(tko_input.targetStatusId);
    if (!tko_status || tko_status.tenantId !== tko_item.tenantId || tko_status.workflowId !== tko_item.workflowId) throw new Error("WORK_ITEM_TRANSITION_NOT_ALLOWED");
    const tko_before = { statusId: tko_item.statusId, rank: tko_item.rank };
    const tko_siblings = Array.from(this.tko_items.values())
      .filter(tko_candidate => tko_candidate.tenantId === tko_item.tenantId && tko_candidate.statusId === tko_status.id && tko_candidate.id !== tko_item.id)
      .sort((tko_left, tko_right) => tko_left.rank.localeCompare(tko_right.rank) || tko_left.sequenceNo - tko_right.sequenceNo);
    const tko_targetIndex = tko_input.beforeWorkItemId ? tko_siblings.findIndex(tko_candidate => tko_candidate.id === tko_input.beforeWorkItemId) : tko_siblings.length;
    if (tko_targetIndex < 0) throw new Error("WORK_ITEM_MOVE_TARGET_INVALID");
    const tko_reordered = [...tko_siblings.slice(0, tko_targetIndex), tko_item, ...tko_siblings.slice(tko_targetIndex)];
    tko_reordered.forEach((tko_candidate, tko_index) => {
      tko_candidate.rank = String((tko_index + 1) * 1000).padStart(12, "0");
      this.tko_items.set(tko_candidate.id, tko_candidate);
    });
    tko_item.statusId = tko_status.id;
    tko_item.version += 1;
    tko_item.updatedAt = tko_now();
    tko_item.completedAt = tko_status.category === "done" ? tko_now() : null;
    this.tko_items.set(tko_item.id, tko_item);
    await this.tko_historyEntry(tko_input.actor, tko_item, "kanban_position", tko_before, { statusId: tko_item.statusId, rank: tko_item.rank });
    await this.tko_emit(tko_input.actor, "work.work_item_moved.v1", "work.item", { workItemId: tko_item.id, key: tko_item.key, before: tko_before, after: { statusId: tko_item.statusId, rank: tko_item.rank }, beforeWorkItemId: tko_input.beforeWorkItemId ?? null, version: tko_item.version }, "work.work_item.moved", "work_item", tko_item.id, tko_input.correlationId);
    return tko_clone(tko_item);
  }

  async updateWorkItem(tko_input: UpdateWorkItemInput): Promise<WorkItem> {
    const tko_item = await this.getWorkItem(tko_input.actor.tenantId, tko_input.workItemId);
    if (!tko_item) throw new Error("WORK_ITEM_NOT_FOUND");
    if (tko_item.version !== tko_input.expectedVersion) throw new Error("WORK_ITEM_VERSION_CONFLICT");
    const tko_before = {
      title: tko_item.title, description: tko_item.description, priority: tko_item.priority,
      assigneeMemberIds: tko_item.assigneeMemberIds, startAt: tko_item.startAt,
      dueAt: tko_item.dueAt, estimateMinutes: tko_item.estimateMinutes,
    };
    if (tko_input.title !== undefined) tko_item.title = tko_input.title.trim();
    if (tko_input.description !== undefined) tko_item.description = tko_input.description.trim();
    if (tko_input.priority !== undefined) tko_item.priority = tko_input.priority;
    if (tko_input.assigneeMemberIds !== undefined) tko_item.assigneeMemberIds = Array.from(new Set(tko_input.assigneeMemberIds));
    if (tko_input.startAt !== undefined) tko_item.startAt = tko_input.startAt;
    if (tko_input.dueAt !== undefined) tko_item.dueAt = tko_input.dueAt;
    if (tko_input.estimateMinutes !== undefined) tko_item.estimateMinutes = tko_input.estimateMinutes;
    tko_item.version += 1;
    tko_item.updatedAt = tko_now();
    this.tko_items.set(tko_item.id, tko_item);
    const tko_after = {
      title: tko_item.title, description: tko_item.description, priority: tko_item.priority,
      assigneeMemberIds: tko_item.assigneeMemberIds, startAt: tko_item.startAt,
      dueAt: tko_item.dueAt, estimateMinutes: tko_item.estimateMinutes,
    };
    await this.tko_historyEntry(tko_input.actor, tko_item, "fields", tko_before, tko_after);
    await this.tko_emit(tko_input.actor, "work.work_item_updated.v1", "work.item", { workItemId: tko_item.id, key: tko_item.key, before: tko_before, after: tko_after, version: tko_item.version }, "work.work_item.updated", "work_item", tko_item.id, tko_input.correlationId);
    return tko_clone(tko_item);
  }

  async archiveWorkItem(tko_input: ArchiveWorkItemInput): Promise<WorkItem> {
    const tko_item = await this.getWorkItem(tko_input.actor.tenantId, tko_input.workItemId);
    if (!tko_item || tko_item.archivedAt) throw new Error("WORK_ITEM_NOT_FOUND");
    if (tko_item.version !== tko_input.expectedVersion) throw new Error("WORK_ITEM_VERSION_CONFLICT");
    const tko_archivedAt = tko_now();
    tko_item.archivedAt = tko_archivedAt;
    tko_item.updatedAt = tko_archivedAt;
    tko_item.version += 1;
    this.tko_items.set(tko_item.id, tko_item);
    await this.tko_historyEntry(tko_input.actor, tko_item, "archived", false, true);
    await this.tko_emit(tko_input.actor, "work.work_item_archived.v1", "work.item", { workItemId: tko_item.id, key: tko_item.key, projectId: tko_item.projectId, archivedAt: tko_archivedAt, version: tko_item.version }, "work.work_item.archived", "work_item", tko_item.id, tko_input.correlationId);
    return tko_clone(tko_item);
  }

  async createComment(tko_input: CreateCommentInput): Promise<WorkComment> {
    const tko_item = await this.getWorkItem(tko_input.actor.tenantId, tko_input.workItemId);
    if (!tko_item) throw new Error("WORK_ITEM_NOT_FOUND");
    const tko_comment: WorkComment = { id: crypto.randomUUID(), tenantId: tko_item.tenantId, type: "work_comment", workItemId: tko_item.id, authorMemberId: tko_input.actor.memberId, body: tko_input.body.trim(), reactions: [], attachments: [], createdAt: tko_now(), editedAt: null, deletedAt: null };
    this.tko_comments.set(tko_comment.id, tko_comment);
    await this.tko_emit(tko_input.actor, "work.comment_created.v1", "work.item", { workItemId: tko_item.id, commentId: tko_comment.id, mentionMemberIds: Array.from(new Set(tko_input.mentionMemberIds ?? [])).filter(tko_memberId => tko_memberId !== tko_input.actor.memberId) }, "work.comment.created", "work_comment", tko_comment.id, tko_input.correlationId);
    return tko_clone(tko_comment);
  }

  async listComments(tko_tenantId: string, tko_workItemId: string): Promise<WorkComment[]> {
    return Array.from(this.tko_comments.values())
      .filter(tko_comment => tko_comment.tenantId === tko_tenantId && tko_comment.workItemId === tko_workItemId && !tko_comment.deletedAt)
      .sort((tko_left, tko_right) => tko_left.createdAt.getTime() - tko_right.createdAt.getTime())
      .map(tko_comment => ({ ...tko_comment, reactions: Array.from(this.tko_commentReactions.values()).filter(tko_reaction => tko_reaction.commentId === tko_comment.id).map(tko_clone), attachments: Array.from(this.tko_commentAttachments.values()).filter(tko_attachment => tko_attachment.commentId === tko_comment.id).map(tko_clone) }))
      .map(tko_clone);
  }

  async toggleCommentReaction(tko_input: ToggleWorkCommentReactionInput): Promise<WorkComment> {
    const tko_comment = this.tko_comments.get(tko_input.commentId);
    if (!tko_comment || tko_comment.tenantId !== tko_input.actor.tenantId || tko_comment.workItemId !== tko_input.workItemId || tko_comment.deletedAt) throw new Error("WORK_COMMENT_NOT_FOUND");
    const tko_key = `${tko_comment.id}:${tko_input.actor.memberId}:${tko_input.emoji}`;
    const tko_existing = this.tko_commentReactions.get(tko_key);
    if (tko_existing) {
      this.tko_commentReactions.delete(tko_key);
      await this.tko_emit(tko_input.actor, "work.comment_reaction_removed.v1", "work.item", { workItemId: tko_comment.workItemId, commentId: tko_comment.id, emoji: tko_input.emoji }, "work.comment.reaction_removed", "work_comment", tko_comment.id, tko_input.correlationId);
    } else {
      this.tko_commentReactions.set(tko_key, { id: tko_key, tenantId: tko_comment.tenantId, type: "work_comment_reaction", commentId: tko_comment.id, memberId: tko_input.actor.memberId, emoji: tko_input.emoji, createdAt: tko_now() });
      await this.tko_emit(tko_input.actor, "work.comment_reaction_added.v1", "work.item", { workItemId: tko_comment.workItemId, commentId: tko_comment.id, emoji: tko_input.emoji, recipientMemberId: tko_comment.authorMemberId === tko_input.actor.memberId ? null : tko_comment.authorMemberId }, "work.comment.reaction_added", "work_comment", tko_comment.id, tko_input.correlationId);
    }
    return (await this.listComments(tko_input.actor.tenantId, tko_comment.workItemId)).find(tko_entry => tko_entry.id === tko_comment.id)!;
  }

  async createCommentAttachment(tko_actor: PlatformActor, tko_input: Omit<WorkCommentAttachment, "id" | "tenantId" | "type" | "uploadedByMemberId" | "createdAt"> & { correlationId: string }): Promise<WorkCommentAttachment> {
    const tko_comment = this.tko_comments.get(tko_input.commentId);
    if (!tko_comment || tko_comment.tenantId !== tko_actor.tenantId || tko_comment.deletedAt) throw new Error("WORK_COMMENT_NOT_FOUND");
    const tko_attachment: WorkCommentAttachment = { id: crypto.randomUUID(), tenantId: tko_actor.tenantId, type: "work_comment_attachment", commentId: tko_comment.id, objectKey: tko_input.objectKey, filename: tko_input.filename, contentType: tko_input.contentType, byteSize: tko_input.byteSize, uploadedByMemberId: tko_actor.memberId, createdAt: tko_now() };
    this.tko_commentAttachments.set(tko_attachment.id, tko_attachment);
    await this.tko_emit(tko_actor, "work.comment_attachment_created.v1", "work.item", { workItemId: tko_comment.workItemId, commentId: tko_comment.id, attachmentId: tko_attachment.id }, "work.comment.attachment_created", "work_comment", tko_comment.id, tko_input.correlationId);
    return tko_clone(tko_attachment);
  }

  async listChecklistItems(tko_tenantId: string, tko_workItemId: string): Promise<WorkChecklistItem[]> { return Array.from(this.tko_checklistItems.values()).filter(tko_item => tko_item.tenantId === tko_tenantId && tko_item.workItemId === tko_workItemId).sort((tko_left, tko_right) => tko_left.sortOrder - tko_right.sortOrder).map(tko_clone); }
  async createChecklistItem(tko_actor: PlatformActor, tko_input: { workItemId: string; body: string; correlationId: string }): Promise<WorkChecklistItem> { const tko_workItem = await this.getWorkItem(tko_actor.tenantId, tko_input.workItemId); if (!tko_workItem) throw new Error("WORK_ITEM_NOT_FOUND"); const tko_existing = await this.listChecklistItems(tko_actor.tenantId, tko_workItem.id); const tko_item: WorkChecklistItem = { id: crypto.randomUUID(), tenantId: tko_actor.tenantId, type: "work_checklist_item", workItemId: tko_workItem.id, body: tko_input.body.trim(), completedAt: null, completedByMemberId: null, sortOrder: (tko_existing.at(-1)?.sortOrder ?? 0) + 100, createdByMemberId: tko_actor.memberId, createdAt: tko_now() }; this.tko_checklistItems.set(tko_item.id, tko_item); await this.tko_emit(tko_actor, "work.checklist_item_created.v1", "work.item", { workItemId: tko_workItem.id, checklistItemId: tko_item.id }, "work.checklist_item.created", "work_checklist_item", tko_item.id, tko_input.correlationId); return tko_clone(tko_item); }
  async toggleChecklistItem(tko_actor: PlatformActor, tko_input: { workItemId: string; checklistItemId: string; completed: boolean; correlationId: string }): Promise<WorkChecklistItem> { const tko_item = this.tko_checklistItems.get(tko_input.checklistItemId); if (!tko_item || tko_item.tenantId !== tko_actor.tenantId || tko_item.workItemId !== tko_input.workItemId) throw new Error("WORK_CHECKLIST_ITEM_NOT_FOUND"); tko_item.completedAt = tko_input.completed ? tko_now() : null; tko_item.completedByMemberId = tko_input.completed ? tko_actor.memberId : null; this.tko_checklistItems.set(tko_item.id, tko_item); await this.tko_emit(tko_actor, "work.checklist_item_toggled.v1", "work.item", { workItemId: tko_item.workItemId, checklistItemId: tko_item.id, completed: tko_input.completed }, "work.checklist_item.toggled", "work_checklist_item", tko_item.id, tko_input.correlationId); return tko_clone(tko_item); }
  async createAttachment(tko_actor: PlatformActor, tko_input: Omit<WorkAttachment, "id" | "tenantId" | "type" | "uploadedByMemberId" | "createdAt"> & { correlationId: string }): Promise<WorkAttachment> { const tko_workItem = await this.getWorkItem(tko_actor.tenantId, tko_input.workItemId); if (!tko_workItem) throw new Error("WORK_ITEM_NOT_FOUND"); const tko_attachment: WorkAttachment = { id: crypto.randomUUID(), tenantId: tko_actor.tenantId, type: "work_attachment", workItemId: tko_workItem.id, objectKey: tko_input.objectKey, filename: tko_input.filename, contentType: tko_input.contentType, byteSize: tko_input.byteSize, uploadedByMemberId: tko_actor.memberId, createdAt: tko_now() }; this.tko_attachments.set(tko_attachment.id, tko_attachment); await this.tko_emit(tko_actor, "work.attachment_created.v1", "work.item", { workItemId: tko_attachment.workItemId, attachmentId: tko_attachment.id }, "work.attachment.created", "work_attachment", tko_attachment.id, tko_input.correlationId); return tko_clone(tko_attachment); }
  async listAttachments(tko_tenantId: string, tko_workItemId: string): Promise<WorkAttachment[]> { return Array.from(this.tko_attachments.values()).filter(tko_attachment => tko_attachment.tenantId === tko_tenantId && tko_attachment.workItemId === tko_workItemId).map(tko_clone); }
  async removeAttachment(tko_actor: PlatformActor, tko_input: { workItemId: string; attachmentId: string; correlationId: string }): Promise<void> { const tko_attachment = this.tko_attachments.get(tko_input.attachmentId); if (!tko_attachment || tko_attachment.tenantId !== tko_actor.tenantId || tko_attachment.workItemId !== tko_input.workItemId) throw new Error("WORK_ATTACHMENT_NOT_FOUND"); this.tko_attachments.delete(tko_attachment.id); await this.tko_emit(tko_actor, "work.attachment_removed.v1", "work.item", { workItemId: tko_attachment.workItemId, attachmentId: tko_attachment.id, filename: tko_attachment.filename }, "work.attachment.removed", "work_attachment", tko_attachment.id, tko_input.correlationId); }

  private tko_hasBlockingPath(tko_tenantId: string, tko_fromWorkItemId: string, tko_targetWorkItemId: string): boolean {
    const tko_pending = [tko_fromWorkItemId];
    const tko_seen = new Set<string>();
    while (tko_pending.length > 0) {
      const tko_current = tko_pending.shift();
      if (!tko_current || tko_seen.has(tko_current)) continue;
      if (tko_current === tko_targetWorkItemId) return true;
      tko_seen.add(tko_current);
      for (const tko_relation of Array.from(this.tko_relations.values())) {
        if (tko_relation.tenantId !== tko_tenantId || (tko_relation.relationType !== "blocks" && tko_relation.relationType !== "blocked_by")) continue;
        const [tko_from, tko_to] = tko_relation.relationType === "blocks"
          ? [tko_relation.sourceWorkItemId, tko_relation.targetWorkItemId]
          : [tko_relation.targetWorkItemId, tko_relation.sourceWorkItemId];
        if (tko_from === tko_current) tko_pending.push(tko_to);
      }
    }
    return false;
  }

  async addDependency(tko_actor: PlatformActor, tko_input: { sourceWorkItemId: string; targetWorkItemId: string; relationType: WorkItemRelationType; correlationId: string }): Promise<void> {
    const [tko_source, tko_target] = await Promise.all([this.getWorkItem(tko_actor.tenantId, tko_input.sourceWorkItemId), this.getWorkItem(tko_actor.tenantId, tko_input.targetWorkItemId)]);
    if (!tko_source || !tko_target || tko_source.id === tko_target.id) throw new Error("WORK_RELATION_INVALID");
    const tko_key = `${tko_source.id}:${tko_target.id}:${tko_input.relationType}`;
    if (Array.from(this.tko_relations.values()).some(tko_relation => tko_relation.sourceWorkItemId === tko_source.id && tko_relation.targetWorkItemId === tko_target.id && tko_relation.relationType === tko_input.relationType)) return;
    if (tko_input.relationType === "blocks" || tko_input.relationType === "blocked_by") {
      const [tko_from, tko_to] = tko_input.relationType === "blocks" ? [tko_source.id, tko_target.id] : [tko_target.id, tko_source.id];
      if (this.tko_hasBlockingPath(tko_actor.tenantId, tko_to, tko_from)) throw new Error("WORK_RELATION_CYCLE");
    }
    const tko_relation: WorkItemRelation = { id: crypto.randomUUID(), tenantId: tko_actor.tenantId, type: "work_item_relation", sourceWorkItemId: tko_source.id, targetWorkItemId: tko_target.id, relationType: tko_input.relationType, createdByMemberId: tko_actor.memberId, createdAt: tko_now() };
    this.tko_relations.set(tko_relation.id, tko_relation);
    await this.tko_emit(tko_actor, "work.work_item_relation_created.v1", "work.item", { sourceWorkItemId: tko_source.id, targetWorkItemId: tko_target.id, relationType: tko_input.relationType, relationId: tko_relation.id }, "work.work_item.relation_created", "work_item_relation", tko_relation.id, tko_input.correlationId);
  }

  async listDependencies(tko_tenantId: string, tko_workItemId: string): Promise<WorkItemRelation[]> {
    return Array.from(this.tko_relations.values()).filter(tko_relation => tko_relation.tenantId === tko_tenantId && (tko_relation.sourceWorkItemId === tko_workItemId || tko_relation.targetWorkItemId === tko_workItemId)).sort((tko_left, tko_right) => tko_left.createdAt.getTime() - tko_right.createdAt.getTime()).map(tko_clone);
  }

  async removeDependency(tko_actor: PlatformActor, tko_input: { workItemId: string; relationId: string; correlationId: string }): Promise<void> {
    const tko_relation = this.tko_relations.get(tko_input.relationId);
    if (!tko_relation || tko_relation.tenantId !== tko_actor.tenantId || (tko_relation.sourceWorkItemId !== tko_input.workItemId && tko_relation.targetWorkItemId !== tko_input.workItemId)) throw new Error("WORK_RELATION_NOT_FOUND");
    this.tko_relations.delete(tko_relation.id);
    await this.tko_emit(tko_actor, "work.work_item_relation_removed.v1", "work.item", { workItemId: tko_input.workItemId, relationId: tko_relation.id, sourceWorkItemId: tko_relation.sourceWorkItemId, targetWorkItemId: tko_relation.targetWorkItemId, relationType: tko_relation.relationType }, "work.work_item.relation_removed", "work_item_relation", tko_relation.id, tko_input.correlationId);
  }

  async createSprint(tko_input: CreateSprintInput): Promise<WorkSprint> {
    const tko_project = await this.getProject(tko_input.actor.tenantId, tko_input.projectId);
    if (!tko_project || tko_project.methodology !== "scrum") throw new Error("WORK_SPRINT_PROJECT_INVALID");
    const tko_sprint: WorkSprint = { id: crypto.randomUUID(), tenantId: tko_project.tenantId, type: "sprint", projectId: tko_project.id, name: tko_input.name.trim(), goal: tko_input.goal?.trim() ?? "", state: "planned", startAt: tko_input.startAt ?? null, endAt: tko_input.endAt ?? null };
    this.tko_sprints.set(tko_sprint.id, tko_sprint);
    this.tko_sprintItems.set(tko_sprint.id, new Set());
    await this.tko_emit(tko_input.actor, "work.sprint_created.v1", "work.sprint", { sprintId: tko_sprint.id, projectId: tko_sprint.projectId }, "work.sprint.created", "sprint", tko_sprint.id, tko_input.correlationId);
    return tko_clone(tko_sprint);
  }

  async startSprint(tko_input: { actor: PlatformActor; projectId: string; sprintId: string; correlationId: string }): Promise<WorkSprint> {
    const tko_sprint = this.tko_sprints.get(tko_input.sprintId);
    if (!tko_sprint || tko_sprint.tenantId !== tko_input.actor.tenantId || tko_sprint.projectId !== tko_input.projectId || tko_sprint.state !== "planned") throw new Error("WORK_SPRINT_NOT_FOUND");
    if (Array.from(this.tko_sprints.values()).some(tko_entry => tko_entry.tenantId === tko_input.actor.tenantId && tko_entry.projectId === tko_sprint.projectId && tko_entry.id !== tko_sprint.id && tko_entry.state === "active")) throw new Error("WORK_SPRINT_ACTIVE_EXISTS");
    tko_sprint.state = "active";
    tko_sprint.startAt ??= tko_now();
    this.tko_sprints.set(tko_sprint.id, tko_sprint);
    await this.tko_emit(tko_input.actor, "work.sprint_started.v1", "work.sprint", { sprintId: tko_sprint.id, projectId: tko_sprint.projectId }, "work.sprint.started", "sprint", tko_sprint.id, tko_input.correlationId);
    return tko_clone(tko_sprint);
  }

  async addItemsToSprint(tko_actor: PlatformActor, tko_input: { sprintId: string; workItemIds: string[]; correlationId: string }): Promise<void> {
    const tko_sprint = this.tko_sprints.get(tko_input.sprintId);
    if (!tko_sprint || tko_sprint.tenantId !== tko_actor.tenantId || tko_sprint.state === "completed") throw new Error("WORK_SPRINT_NOT_FOUND");
    const tko_items = await Promise.all(tko_input.workItemIds.map(tko_workItemId => this.getWorkItem(tko_actor.tenantId, tko_workItemId)));
    if (tko_items.some(tko_item => !tko_item || tko_item.projectId !== tko_sprint.projectId)) throw new Error("WORK_SPRINT_ITEM_INVALID");
    const tko_members = this.tko_sprintItems.get(tko_sprint.id) ?? new Set<string>();
    for (const tko_item of tko_items) {
      if (!tko_item) continue;
      tko_members.add(tko_item.id);
      tko_item.sprintId = tko_sprint.id;
      tko_item.updatedAt = tko_now();
      this.tko_items.set(tko_item.id, tko_item);
    }
    this.tko_sprintItems.set(tko_sprint.id, tko_members);
    await this.tko_emit(tko_actor, "work.sprint_items_added.v1", "work.sprint", { sprintId: tko_sprint.id, workItemIds: Array.from(tko_members) }, "work.sprint.items_added", "sprint", tko_sprint.id, tko_input.correlationId);
  }

  async completeSprint(tko_actor: PlatformActor, tko_input: CompleteSprintInput): Promise<WorkSprint> {
    const tko_sprint = this.tko_sprints.get(tko_input.sprintId);
    if (!tko_sprint || tko_sprint.tenantId !== tko_actor.tenantId || tko_sprint.state === "completed") throw new Error("WORK_SPRINT_NOT_FOUND");
    const tko_nextSprint = tko_input.incompleteDisposition === "next_sprint"
      ? this.tko_sprints.get(tko_input.nextSprintId ?? "")
      : null;
    if (tko_input.incompleteDisposition === "next_sprint" && (!tko_nextSprint || tko_nextSprint.tenantId !== tko_actor.tenantId || tko_nextSprint.projectId !== tko_sprint.projectId || tko_nextSprint.id === tko_sprint.id || tko_nextSprint.state === "completed")) {
      throw new Error("WORK_SPRINT_NEXT_INVALID");
    }
    const tko_statuses = await this.listStatuses(tko_actor.tenantId, (await this.getProject(tko_actor.tenantId, tko_sprint.projectId))?.workflowId ?? "");
    const tko_doneStatusIds = new Set(tko_statuses.filter(tko_status => tko_status.category === "done").map(tko_status => tko_status.id));
    const tko_itemIds = this.tko_sprintItems.get(tko_sprint.id) ?? new Set<string>();
    const tko_nextItems = tko_nextSprint ? (this.tko_sprintItems.get(tko_nextSprint.id) ?? new Set<string>()) : null;
    for (const tko_workItemId of Array.from(tko_itemIds)) {
      const tko_item = this.tko_items.get(tko_workItemId);
      if (!tko_item || tko_doneStatusIds.has(tko_item.statusId)) continue;
      if (tko_input.incompleteDisposition === "backlog") tko_item.sprintId = null;
      if (tko_nextSprint && tko_nextItems) {
        tko_item.sprintId = tko_nextSprint.id;
        tko_itemIds.delete(tko_item.id);
        tko_nextItems.add(tko_item.id);
      }
      tko_item.updatedAt = tko_now();
      this.tko_items.set(tko_item.id, tko_item);
    }
    if (tko_nextSprint && tko_nextItems) this.tko_sprintItems.set(tko_nextSprint.id, tko_nextItems);
    tko_sprint.state = "completed";
    this.tko_sprints.set(tko_sprint.id, tko_sprint);
    await this.tko_emit(tko_actor, "work.sprint_completed.v1", "work.sprint", { sprintId: tko_sprint.id, incompleteDisposition: tko_input.incompleteDisposition, nextSprintId: tko_nextSprint?.id ?? null }, "work.sprint.completed", "sprint", tko_sprint.id, tko_input.correlationId);
    return tko_clone(tko_sprint);
  }

  async listSprints(tko_tenantId: string, tko_projectId: string): Promise<WorkSprint[]> {
    return Array.from(this.tko_sprints.values()).filter(tko_sprint => tko_sprint.tenantId === tko_tenantId && tko_sprint.projectId === tko_projectId).map(tko_clone);
  }

  async saveView(tko_actor: PlatformActor, tko_input: Omit<WorkSavedView, "id" | "tenantId" | "ownerMemberId"> & { correlationId: string }): Promise<WorkSavedView> {
    const tko_view: WorkSavedView = { ...tko_input, id: crypto.randomUUID(), tenantId: tko_actor.tenantId, ownerMemberId: tko_actor.memberId };
    this.tko_views.set(tko_view.id, tko_view);
    await this.tko_emit(tko_actor, "work.saved_view_created.v1", "work.view", { viewId: tko_view.id, projectId: tko_view.projectId, renderer: tko_view.renderer }, "work.saved_view.created", "saved_view", tko_view.id, tko_input.correlationId);
    return tko_clone(tko_view);
  }

  async listViews(tko_tenantId: string, tko_projectId: string, tko_memberId: string): Promise<WorkSavedView[]> {
    return Array.from(this.tko_views.values()).filter(tko_view => tko_view.tenantId === tko_tenantId && tko_view.projectId === tko_projectId && (tko_view.visibility === "workspace" || tko_view.ownerMemberId === tko_memberId)).map(tko_clone);
  }

  async listHistory(tko_tenantId: string, tko_workItemId: string): Promise<WorkHistoryEntry[]> {
    return this.tko_history.filter(tko_entry => tko_entry.tenantId === tko_tenantId && tko_entry.workItemId === tko_workItemId).map(tko_clone);
  }

  async seedDemoWork(tko_actor: PlatformActor): Promise<WorkBoardData> {
    const tko_existing = (await this.listProjects(tko_actor.tenantId))[0];
    if (tko_existing) return this.tko_board(tko_actor.tenantId, tko_existing.id);
    const tko_space = await this.createSpace(tko_actor, { name: "Product", slug: "product", visibility: "internal", correlationId: tko_actor.correlationId });
    const tko_project = await this.createProject({ actor: tko_actor, spaceId: tko_space.id, name: "Tasko Work Alpha", key: "TASKO", description: "M1 pilot workspace", methodology: "scrum", visibility: "internal", correlationId: tko_actor.correlationId });
    const tko_items = await Promise.all([
      this.createWorkItem({ actor: tko_actor, projectId: tko_project.id, title: "Define sprint objective", priority: "high", estimateMinutes: 120, correlationId: tko_actor.correlationId }),
      this.createWorkItem({ actor: tko_actor, projectId: tko_project.id, title: "Ship project board", priority: "urgent", estimateMinutes: 480, correlationId: tko_actor.correlationId }),
      this.createWorkItem({ actor: tko_actor, projectId: tko_project.id, title: "Confirm tenant isolation tests", priority: "high", estimateMinutes: 180, correlationId: tko_actor.correlationId }),
    ]);
    const tko_statuses = await this.listStatuses(tko_actor.tenantId, tko_project.workflowId);
    await this.transitionWorkItem({ actor: tko_actor, workItemId: tko_items[1].id, targetStatusId: tko_statuses[1].id, expectedVersion: tko_items[1].version, correlationId: tko_actor.correlationId });
    await this.transitionWorkItem({ actor: tko_actor, workItemId: tko_items[2].id, targetStatusId: tko_statuses[2].id, expectedVersion: tko_items[2].version, correlationId: tko_actor.correlationId });
    const tko_sprint = await this.createSprint({ actor: tko_actor, projectId: tko_project.id, name: "Sprint 1", goal: "Establish the Work Alpha operating loop", correlationId: tko_actor.correlationId });
    await this.addItemsToSprint(tko_actor, { sprintId: tko_sprint.id, workItemIds: tko_items.map(tko_item => tko_item.id), correlationId: tko_actor.correlationId });
    return this.tko_board(tko_actor.tenantId, tko_project.id);
  }

  private async tko_board(tko_tenantId: string, tko_projectId: string): Promise<WorkBoardData> {
    const tko_project = await this.getProject(tko_tenantId, tko_projectId);
    if (!tko_project) throw new Error("WORK_PROJECT_NOT_FOUND");
    return { project: tko_project, statuses: await this.listStatuses(tko_tenantId, tko_project.workflowId), items: await this.listWorkItems(tko_tenantId, tko_projectId) };
  }

  private async tko_historyEntry(tko_actor: PlatformActor, tko_item: WorkItem, tko_field: string, tko_before: unknown, tko_after: unknown): Promise<void> {
    this.tko_history.push({ id: crypto.randomUUID(), tenantId: tko_item.tenantId, type: "work_history", workItemId: tko_item.id, actorMemberId: tko_actor.memberId, field: tko_field, before: tko_before, after: tko_after, createdAt: tko_now() });
  }

  private async tko_emit(tko_actor: PlatformActor, tko_eventType: string, tko_topic: string, tko_payload: Record<string, unknown>, tko_action: string, tko_resourceType: string, tko_resourceId: string, tko_correlationId: string): Promise<void> {
    await getPlatformStore().writeDurableMutation({ actor: tko_actor, tenantId: tko_actor.tenantId, eventType: tko_eventType, topic: tko_topic, payload: tko_payload, auditAction: tko_action, resourceType: tko_resourceType, resourceId: tko_resourceId, correlationId: tko_correlationId, auditMetadata: tko_payload });
  }
}

let tko_workStore: WorkStore | null = null;

export function getWorkStore(): WorkStore {
  if (!tko_workStore) tko_workStore = tko_config.postgresUrl ? new PostgresWorkStore(tko_config.postgresUrl) : new MemoryWorkStore();
  return tko_workStore;
}

export function setWorkStoreForTests(tko_store: WorkStore | null): void {
  tko_workStore = tko_store;
}
