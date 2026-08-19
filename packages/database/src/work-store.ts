import type {
  CreateCommentInput,
  CompleteSprintInput,
  CreateProjectInput,
  CreateSprintInput,
  CreateWorkItemInput,
  MoveWorkItemInput,
  UpdateWorkItemInput,
  ProjectMethodology,
  TransitionWorkItemInput,
  WorkComment,
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
  listStatuses(tko_tenantId: string, tko_workflowId: string): Promise<WorkflowStatus[]>;
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
  createComment(tko_input: CreateCommentInput): Promise<WorkComment>;
  listComments(tko_tenantId: string, tko_workItemId: string): Promise<WorkComment[]>;
  addDependency(tko_actor: PlatformActor, tko_input: { sourceWorkItemId: string; targetWorkItemId: string; relationType: WorkItemRelationType; correlationId: string }): Promise<void>;
  listDependencies(tko_tenantId: string, tko_workItemId: string): Promise<WorkItemRelation[]>;
  removeDependency(tko_actor: PlatformActor, tko_input: { workItemId: string; relationId: string; correlationId: string }): Promise<void>;
  createSprint(tko_input: CreateSprintInput): Promise<WorkSprint>;
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

export class MemoryWorkStore implements WorkStore {
  private readonly tko_spaces = new Map<string, WorkSpace>();
  private readonly tko_projects = new Map<string, WorkProject>();
  private readonly tko_statuses = new Map<string, WorkflowStatus>();
  private readonly tko_workTypes = new Map<string, WorkType>();
  private readonly tko_items = new Map<string, WorkItem>();
  private readonly tko_comments = new Map<string, WorkComment>();
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
      const tko_record: WorkflowStatus = { id: crypto.randomUUID(), tenantId: tko_input.actor.tenantId, type: "workflow_status", workflowId: tko_workflowId, ...tko_status };
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
      workflowId: tko_workflowId, sequenceCounter: 0, archivedAt: null,
    };
    this.tko_projects.set(tko_project.id, tko_project);
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

  async listStatuses(tko_tenantId: string, tko_workflowId: string): Promise<WorkflowStatus[]> {
    return Array.from(this.tko_statuses.values()).filter(tko_status => tko_status.tenantId === tko_tenantId && tko_status.workflowId === tko_workflowId).sort((tko_left, tko_right) => tko_left.sortOrder - tko_right.sortOrder).map(tko_clone);
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

  async createComment(tko_input: CreateCommentInput): Promise<WorkComment> {
    const tko_item = await this.getWorkItem(tko_input.actor.tenantId, tko_input.workItemId);
    if (!tko_item) throw new Error("WORK_ITEM_NOT_FOUND");
    const tko_comment: WorkComment = { id: crypto.randomUUID(), tenantId: tko_item.tenantId, type: "work_comment", workItemId: tko_item.id, authorMemberId: tko_input.actor.memberId, body: tko_input.body.trim(), createdAt: tko_now(), editedAt: null, deletedAt: null };
    this.tko_comments.set(tko_comment.id, tko_comment);
    await this.tko_emit(tko_input.actor, "work.comment_created.v1", "work.item", { workItemId: tko_item.id, commentId: tko_comment.id }, "work.comment.created", "work_comment", tko_comment.id, tko_input.correlationId);
    return tko_clone(tko_comment);
  }

  async listComments(tko_tenantId: string, tko_workItemId: string): Promise<WorkComment[]> {
    return Array.from(this.tko_comments.values()).filter(tko_comment => tko_comment.tenantId === tko_tenantId && tko_comment.workItemId === tko_workItemId && !tko_comment.deletedAt).sort((tko_left, tko_right) => tko_left.createdAt.getTime() - tko_right.createdAt.getTime()).map(tko_clone);
  }

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
