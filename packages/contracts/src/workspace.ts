import type { PlatformActor, TenantResource } from "./platform";

export type WorkspaceEntityType =
  | "work_item"
  | "project"
  | "channel"
  | "message"
  | "crm_lead"
  | "crm_company"
  | "crm_contact"
  | "crm_deal"
  | "document"
  | "form";

export type WorkspaceVisibility = "internal" | "private" | "guest_shared";
export type WorkspaceSearchKind = "work" | "chat" | "crm" | "doc";
export type InboxItemKind = "mention" | "assignment" | "comment" | "deal" | "form" | "automation" | "system";
export type FormTargetType = "work_item" | "crm_lead";
export type AutomationTriggerType = "crm.lead_created.v1" | "work.work_item_created.v1" | "workspace.form_submitted.v1";
export type AutomationActionType = "create_work_item" | "create_crm_activity";

export interface WorkspaceSearchDocument extends TenantResource {
  type: "workspace_search_document";
  entityType: WorkspaceEntityType;
  entityId: string;
  kind: WorkspaceSearchKind;
  title: string;
  bodyText: string;
  href: string;
  visibility: WorkspaceVisibility;
  explicitMemberIds: string[];
  updatedAt: Date;
}

export interface WorkspaceInboxItem extends TenantResource {
  type: "workspace_inbox_item";
  memberId: string;
  kind: InboxItemKind;
  entityType: WorkspaceEntityType;
  entityId: string;
  title: string;
  body: string;
  href: string;
  sourceEventId: string | null;
  readAt: Date | null;
  archivedAt: Date | null;
  createdAt: Date;
}

export interface WorkspaceEntityLink extends TenantResource {
  type: "workspace_entity_link";
  sourceType: WorkspaceEntityType;
  sourceId: string;
  targetType: WorkspaceEntityType;
  targetId: string;
  relationType: "context" | "reference" | "related" | "blocks";
  createdAt: Date;
}

export interface WorkspaceDocument extends TenantResource {
  type: "workspace_document";
  title: string;
  content: Record<string, unknown>;
  bodyText: string;
  ownerMemberId: string;
  visibility: WorkspaceVisibility;
  templateKey: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface WorkspaceDocumentLink extends TenantResource {
  type: "workspace_document_link";
  documentId: string;
  entityType: WorkspaceEntityType;
  entityId: string;
  createdAt: Date;
}

export interface WorkspaceFormField {
  id: string;
  label: string;
  fieldType: "text" | "textarea" | "email" | "number" | "select" | "date";
  required: boolean;
  options?: string[];
}

export interface WorkspaceForm extends TenantResource {
  type: "workspace_form";
  name: string;
  description: string;
  status: "draft" | "active" | "archived";
  accessMode: "internal";
  fields: WorkspaceFormField[];
  targetType: FormTargetType;
  targetConfig: Record<string, unknown>;
  ownerMemberId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface WorkspaceFormSubmission extends TenantResource {
  type: "workspace_form_submission";
  formId: string;
  submittedByMemberId: string;
  values: Record<string, unknown>;
  targetEntityType: WorkspaceEntityType;
  targetEntityId: string;
  idempotencyKey: string;
  createdAt: Date;
}

export interface WorkspaceAutomationAction {
  type: AutomationActionType;
  config: Record<string, unknown>;
}

export interface WorkspaceAutomationRule extends TenantResource {
  type: "workspace_automation_rule";
  name: string;
  status: "active" | "paused";
  triggerType: AutomationTriggerType;
  condition: Record<string, unknown>;
  actions: WorkspaceAutomationAction[];
  ownerMemberId: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface WorkspaceAutomationExecution extends TenantResource {
  type: "workspace_automation_execution";
  ruleId: string;
  ruleVersion: number;
  sourceEventId: string;
  status: "completed" | "failed" | "skipped";
  results: Record<string, unknown>;
  error: string | null;
  createdAt: Date;
  completedAt: Date | null;
}

export interface WorkspaceOverview {
  openWorkCount: number;
  dueSoonCount: number;
  unreadInboxCount: number;
  activeDealsCount: number;
  documentsCount: number;
  recentActivity: Array<{ id: string; kind: WorkspaceSearchKind | "inbox"; title: string; href: string; createdAt: Date }>;
}

export interface CreateWorkspaceDocumentInput {
  actor: PlatformActor;
  title: string;
  content?: Record<string, unknown>;
  bodyText?: string;
  visibility?: WorkspaceVisibility;
  templateKey?: string | null;
  correlationId: string;
}

export interface CreateWorkspaceFormInput {
  actor: PlatformActor;
  name: string;
  description?: string;
  fields: WorkspaceFormField[];
  targetType: FormTargetType;
  targetConfig: Record<string, unknown>;
  correlationId: string;
}
