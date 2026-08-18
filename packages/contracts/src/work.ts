import type { PlatformActor, TenantResource } from "./platform";

export const tko_builtinWorkTypeCategories = ["epic", "story", "task", "bug", "request", "milestone"] as const;
export type WorkTypeCategory = (typeof tko_builtinWorkTypeCategories)[number];
export type ProjectMethodology = "kanban" | "scrum" | "simple";
export type WorkPriority = "none" | "low" | "medium" | "high" | "urgent";
export type WorkflowStatusCategory = "todo" | "in_progress" | "done";
export type WorkItemRelationType = "blocks" | "blocked_by" | "relates_to" | "duplicates" | "duplicated_by";
export type SprintState = "planned" | "active" | "completed";
export type SavedViewRenderer = "list" | "board" | "calendar" | "timeline";
export const tko_customFieldTypes = ["text", "long_text", "number", "boolean", "date", "datetime", "single_select", "multi_select", "user", "url", "email"] as const;
export type WorkCustomFieldType = (typeof tko_customFieldTypes)[number];

export interface WorkSpace extends TenantResource {
  type: "space";
  name: string;
  slug: string;
  archivedAt: Date | null;
}

export interface WorkProject extends TenantResource {
  type: "project";
  spaceId: string;
  key: string;
  name: string;
  description: string;
  ownerMemberId: string;
  visibility: "internal" | "private" | "guest_shared";
  methodology: ProjectMethodology;
  workflowId: string;
  sequenceCounter: number;
  archivedAt: Date | null;
}

export interface WorkflowStatus extends TenantResource {
  type: "workflow_status";
  workflowId: string;
  name: string;
  category: WorkflowStatusCategory;
  colorToken: string;
  sortOrder: number;
}

export interface WorkType extends TenantResource {
  type: "work_type";
  projectId: string | null;
  name: string;
  category: WorkTypeCategory;
  icon: string;
}

export interface WorkItem extends TenantResource {
  type: "work_item";
  projectId: string;
  sequenceNo: number;
  key: string;
  workTypeId: string;
  parentId: string | null;
  workflowId: string;
  statusId: string;
  title: string;
  description: string;
  priority: WorkPriority;
  reporterMemberId: string;
  assigneeMemberIds: string[];
  startAt: Date | null;
  dueAt: Date | null;
  estimateMinutes: number | null;
  rank: string;
  sprintId: string | null;
  version: number;
  completedAt: Date | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface WorkComment extends TenantResource {
  type: "work_comment";
  workItemId: string;
  authorMemberId: string;
  body: string;
  createdAt: Date;
  editedAt: Date | null;
  deletedAt: Date | null;
}

export interface WorkSprint extends TenantResource {
  type: "sprint";
  projectId: string;
  name: string;
  goal: string;
  state: SprintState;
  startAt: Date | null;
  endAt: Date | null;
}

export interface WorkCustomFieldDefinition extends TenantResource {
  type: "custom_field";
  projectId: string;
  name: string;
  fieldType: WorkCustomFieldType;
  config: Record<string, unknown>;
  createdAt: Date;
}

export interface WorkCustomFieldValue extends TenantResource {
  type: "custom_field_value";
  fieldId: string;
  workItemId: string;
  value: unknown;
}

export interface WorkHistoryEntry extends TenantResource {
  type: "work_history";
  workItemId: string;
  actorMemberId: string;
  field: string;
  before: unknown;
  after: unknown;
  createdAt: Date;
}

export interface CreateProjectInput {
  actor: PlatformActor;
  spaceId: string;
  name: string;
  key: string;
  description?: string;
  methodology: ProjectMethodology;
  visibility: WorkProject["visibility"];
  correlationId: string;
}

export interface CreateWorkItemInput {
  actor: PlatformActor;
  projectId: string;
  workTypeId?: string;
  parentId?: string | null;
  title: string;
  description?: string;
  priority?: WorkPriority;
  assigneeMemberIds?: string[];
  startAt?: Date | null;
  dueAt?: Date | null;
  estimateMinutes?: number | null;
  rank?: string;
  correlationId: string;
}

export interface TransitionWorkItemInput {
  actor: PlatformActor;
  workItemId: string;
  targetStatusId: string;
  expectedVersion: number;
  correlationId: string;
}

export interface CreateCommentInput {
  actor: PlatformActor;
  workItemId: string;
  body: string;
  correlationId: string;
}

export interface CreateSprintInput {
  actor: PlatformActor;
  projectId: string;
  name: string;
  goal?: string;
  startAt?: Date | null;
  endAt?: Date | null;
  correlationId: string;
}
