import type { PlatformActor } from "../../contracts/src/platform";
import type {
  InboxItemKind,
  WorkspaceAutomationExecution,
  WorkspaceAutomationRule,
  WorkspaceDocument,
  WorkspaceDocumentLink,
  WorkspaceEntityLink,
  WorkspaceEntityType,
  WorkspaceForm,
  WorkspaceFormSubmission,
  WorkspaceSearchDocument,
} from "../../contracts/src/workspace";
import { tko_config } from "../../config/src/tasko-config";
import { getPlatformStore } from "./platform-store";
import { PostgresWorkspaceStore } from "./postgres-workspace-store";

export interface WorkspaceStore {
  upsertSearchDocument(tko_actor: PlatformActor, tko_document: Omit<WorkspaceSearchDocument, "id" | "type" | "tenantId" | "updatedAt"> & { correlationId: string }): Promise<WorkspaceSearchDocument>;
  searchDocuments(tko_tenantId: string, tko_query: string, tko_kind?: WorkspaceSearchDocument["kind"]): Promise<WorkspaceSearchDocument[]>;
  createInboxItem(tko_actor: PlatformActor, tko_input: Omit<WorkspaceInboxWrite, "actor">): Promise<WorkspaceInboxItemResult>;
  listInbox(tko_tenantId: string, tko_memberId: string, tko_options?: { includeArchived?: boolean }): Promise<WorkspaceInboxItemResult[]>;
  setInboxState(tko_actor: PlatformActor, tko_input: { inboxItemId: string; state: "read" | "unread" | "archived"; correlationId: string }): Promise<WorkspaceInboxItemResult>;
  createEntityLink(tko_actor: PlatformActor, tko_input: Omit<WorkspaceEntityLink, "id" | "tenantId" | "type" | "createdAt"> & { correlationId: string }): Promise<WorkspaceEntityLink>;
  listEntityLinks(tko_tenantId: string, tko_entityType: WorkspaceEntityType, tko_entityId: string): Promise<WorkspaceEntityLink[]>;
  createDocument(tko_actor: PlatformActor, tko_input: Omit<WorkspaceDocument, "id" | "tenantId" | "type" | "ownerMemberId" | "createdAt" | "updatedAt"> & { correlationId: string }): Promise<WorkspaceDocument>;
  listDocuments(tko_tenantId: string): Promise<WorkspaceDocument[]>;
  getDocument(tko_tenantId: string, tko_documentId: string): Promise<WorkspaceDocument | null>;
  linkDocument(tko_actor: PlatformActor, tko_input: { documentId: string; entityType: WorkspaceEntityType; entityId: string; correlationId: string }): Promise<WorkspaceDocumentLink>;
  listDocumentLinks(tko_tenantId: string, tko_documentId: string): Promise<WorkspaceDocumentLink[]>;
  listDocumentLinksForEntity(tko_tenantId: string, tko_entityType: WorkspaceEntityType, tko_entityId: string): Promise<WorkspaceDocumentLink[]>;
  createForm(tko_actor: PlatformActor, tko_input: Omit<WorkspaceForm, "id" | "tenantId" | "type" | "ownerMemberId" | "createdAt" | "updatedAt" | "status" | "accessMode"> & { correlationId: string }): Promise<WorkspaceForm>;
  listForms(tko_tenantId: string): Promise<WorkspaceForm[]>;
  getForm(tko_tenantId: string, tko_formId: string): Promise<WorkspaceForm | null>;
  activateForm(tko_actor: PlatformActor, tko_input: { formId: string; correlationId: string }): Promise<WorkspaceForm>;
  getFormSubmission(tko_tenantId: string, tko_formId: string, tko_idempotencyKey: string): Promise<WorkspaceFormSubmission | null>;
  recordFormSubmission(tko_actor: PlatformActor, tko_input: Omit<WorkspaceFormSubmission, "id" | "tenantId" | "type" | "submittedByMemberId" | "createdAt"> & { correlationId: string }): Promise<WorkspaceFormSubmission>;
  createAutomationRule(tko_actor: PlatformActor, tko_input: Omit<WorkspaceAutomationRule, "id" | "tenantId" | "type" | "ownerMemberId" | "version" | "createdAt" | "updatedAt"> & { correlationId: string }): Promise<WorkspaceAutomationRule>;
  listAutomationRules(tko_tenantId: string, tko_triggerType?: WorkspaceAutomationRule["triggerType"]): Promise<WorkspaceAutomationRule[]>;
  listAutomationExecutions(tko_tenantId: string, tko_ruleId: string): Promise<WorkspaceAutomationExecution[]>;
  getAutomationExecution(tko_tenantId: string, tko_ruleId: string, tko_sourceEventId: string, tko_ruleVersion: number): Promise<WorkspaceAutomationExecution | null>;
  recordAutomationExecution(tko_actor: PlatformActor, tko_input: Omit<WorkspaceAutomationExecution, "id" | "tenantId" | "type" | "createdAt" | "completedAt"> & { correlationId: string }): Promise<WorkspaceAutomationExecution>;
}

export type WorkspaceInboxItemResult = import("../../contracts/src/workspace").WorkspaceInboxItem;
type WorkspaceInboxWrite = Omit<WorkspaceInboxItemResult, "id" | "tenantId" | "type" | "createdAt" | "readAt" | "archivedAt"> & { correlationId: string };

function tko_clone<T>(tko_value: T): T { return structuredClone(tko_value); }
function tko_now(): Date { return new Date(); }
function tko_searchKey(tko_tenantId: string, tko_entityType: string, tko_entityId: string): string { return `${tko_tenantId}:${tko_entityType}:${tko_entityId}`; }

export class MemoryWorkspaceStore implements WorkspaceStore {
  private readonly tko_searchDocuments = new Map<string, WorkspaceSearchDocument>();
  private readonly tko_inboxItems = new Map<string, WorkspaceInboxItemResult>();
  private readonly tko_entityLinks = new Map<string, WorkspaceEntityLink>();
  private readonly tko_documents = new Map<string, WorkspaceDocument>();
  private readonly tko_documentLinks = new Map<string, WorkspaceDocumentLink>();
  private readonly tko_forms = new Map<string, WorkspaceForm>();
  private readonly tko_submissions = new Map<string, WorkspaceFormSubmission>();
  private readonly tko_rules = new Map<string, WorkspaceAutomationRule>();
  private readonly tko_executions = new Map<string, WorkspaceAutomationExecution>();

  async upsertSearchDocument(tko_actor: PlatformActor, tko_input: Omit<WorkspaceSearchDocument, "id" | "type" | "tenantId" | "updatedAt"> & { correlationId: string }): Promise<WorkspaceSearchDocument> {
    const tko_key = tko_searchKey(tko_actor.tenantId, tko_input.entityType, tko_input.entityId);
    const { correlationId: _tko_correlationId, ...tko_recordInput } = tko_input;
    const tko_record: WorkspaceSearchDocument = { ...tko_clone(tko_recordInput), id: tko_key, tenantId: tko_actor.tenantId, type: "workspace_search_document", updatedAt: tko_now() };
    this.tko_searchDocuments.set(tko_key, tko_record);
    await this.tko_emit(tko_actor, "workspace.search_indexed.v1", "workspace.search", { entityType: tko_record.entityType, entityId: tko_record.entityId }, "workspace.search.indexed", "workspace_search_document", tko_record.id, tko_input.correlationId);
    return tko_clone(tko_record);
  }

  async searchDocuments(tko_tenantId: string, tko_query: string, tko_kind?: WorkspaceSearchDocument["kind"]): Promise<WorkspaceSearchDocument[]> {
    const tko_normalized = tko_query.trim().toLocaleLowerCase();
    if (!tko_normalized) return [];
    return Array.from(this.tko_searchDocuments.values())
      .filter(tko_record => tko_record.tenantId === tko_tenantId && (!tko_kind || tko_record.kind === tko_kind) && `${tko_record.title} ${tko_record.bodyText}`.toLocaleLowerCase().includes(tko_normalized))
      .sort((tko_left, tko_right) => tko_right.updatedAt.getTime() - tko_left.updatedAt.getTime())
      .map(tko_clone);
  }

  async createInboxItem(tko_actor: PlatformActor, tko_input: Omit<WorkspaceInboxWrite, "actor">): Promise<WorkspaceInboxItemResult> {
    const tko_existing = Array.from(this.tko_inboxItems.values()).find(tko_item => tko_item.tenantId === tko_actor.tenantId && tko_item.memberId === tko_input.memberId && tko_item.sourceEventId === tko_input.sourceEventId && tko_item.kind === tko_input.kind);
    if (tko_existing) return tko_clone(tko_existing);
    const { correlationId: _tko_correlationId, ...tko_inboxInput } = tko_input;
    const tko_item: WorkspaceInboxItemResult = { ...tko_clone(tko_inboxInput), id: crypto.randomUUID(), tenantId: tko_actor.tenantId, type: "workspace_inbox_item", readAt: null, archivedAt: null, createdAt: tko_now() };
    this.tko_inboxItems.set(tko_item.id, tko_item);
    await this.tko_emit(tko_actor, "workspace.inbox_item_created.v1", "workspace.inbox", { inboxItemId: tko_item.id, memberId: tko_item.memberId, entityType: tko_item.entityType, entityId: tko_item.entityId }, "workspace.inbox.item_created", "workspace_inbox_item", tko_item.id, tko_input.correlationId);
    return tko_clone(tko_item);
  }

  async listInbox(tko_tenantId: string, tko_memberId: string, tko_options: { includeArchived?: boolean } = {}): Promise<WorkspaceInboxItemResult[]> {
    return Array.from(this.tko_inboxItems.values()).filter(tko_item => tko_item.tenantId === tko_tenantId && tko_item.memberId === tko_memberId && (tko_options.includeArchived || !tko_item.archivedAt)).sort((tko_left, tko_right) => tko_right.createdAt.getTime() - tko_left.createdAt.getTime()).map(tko_clone);
  }

  async setInboxState(tko_actor: PlatformActor, tko_input: { inboxItemId: string; state: "read" | "unread" | "archived"; correlationId: string }): Promise<WorkspaceInboxItemResult> {
    const tko_item = this.tko_inboxItems.get(tko_input.inboxItemId);
    if (!tko_item || tko_item.tenantId !== tko_actor.tenantId || tko_item.memberId !== tko_actor.memberId) throw new Error("WORKSPACE_INBOX_ITEM_NOT_FOUND");
    tko_item.readAt = tko_input.state === "read" ? tko_now() : tko_input.state === "unread" ? null : tko_item.readAt;
    tko_item.archivedAt = tko_input.state === "archived" ? tko_now() : null;
    this.tko_inboxItems.set(tko_item.id, tko_item);
    await this.tko_emit(tko_actor, "workspace.inbox_item_state_changed.v1", "workspace.inbox", { inboxItemId: tko_item.id, state: tko_input.state }, "workspace.inbox.state_changed", "workspace_inbox_item", tko_item.id, tko_input.correlationId);
    return tko_clone(tko_item);
  }

  async createEntityLink(tko_actor: PlatformActor, tko_input: Omit<WorkspaceEntityLink, "id" | "tenantId" | "type" | "createdAt"> & { correlationId: string }): Promise<WorkspaceEntityLink> {
    const tko_existing = Array.from(this.tko_entityLinks.values()).find(tko_link => tko_link.tenantId === tko_actor.tenantId && tko_link.sourceType === tko_input.sourceType && tko_link.sourceId === tko_input.sourceId && tko_link.targetType === tko_input.targetType && tko_link.targetId === tko_input.targetId && tko_link.relationType === tko_input.relationType);
    if (tko_existing) return tko_clone(tko_existing);
    const { correlationId: _tko_correlationId, ...tko_linkInput } = tko_input;
    const tko_link: WorkspaceEntityLink = { ...tko_clone(tko_linkInput), id: crypto.randomUUID(), tenantId: tko_actor.tenantId, type: "workspace_entity_link", createdAt: tko_now() };
    this.tko_entityLinks.set(tko_link.id, tko_link);
    await this.tko_emit(tko_actor, "workspace.entity_linked.v1", "workspace.link", { sourceType: tko_link.sourceType, sourceId: tko_link.sourceId, targetType: tko_link.targetType, targetId: tko_link.targetId }, "workspace.entity.linked", "workspace_entity_link", tko_link.id, tko_input.correlationId);
    return tko_clone(tko_link);
  }

  async listEntityLinks(tko_tenantId: string, tko_entityType: WorkspaceEntityType, tko_entityId: string): Promise<WorkspaceEntityLink[]> {
    return Array.from(this.tko_entityLinks.values()).filter(tko_link => tko_link.tenantId === tko_tenantId && ((tko_link.sourceType === tko_entityType && tko_link.sourceId === tko_entityId) || (tko_link.targetType === tko_entityType && tko_link.targetId === tko_entityId))).map(tko_clone);
  }

  async createDocument(tko_actor: PlatformActor, tko_input: Omit<WorkspaceDocument, "id" | "tenantId" | "type" | "ownerMemberId" | "createdAt" | "updatedAt"> & { correlationId: string }): Promise<WorkspaceDocument> {
    const { correlationId: _tko_correlationId, ...tko_documentInput } = tko_input;
    const tko_document: WorkspaceDocument = { ...tko_clone(tko_documentInput), id: crypto.randomUUID(), tenantId: tko_actor.tenantId, type: "workspace_document", ownerMemberId: tko_actor.memberId, createdAt: tko_now(), updatedAt: tko_now() };
    this.tko_documents.set(tko_document.id, tko_document);
    await this.tko_emit(tko_actor, "workspace.document_created.v1", "workspace.document", { documentId: tko_document.id, title: tko_document.title }, "workspace.document.created", "workspace_document", tko_document.id, tko_input.correlationId);
    return tko_clone(tko_document);
  }

  async listDocuments(tko_tenantId: string): Promise<WorkspaceDocument[]> { return Array.from(this.tko_documents.values()).filter(tko_document => tko_document.tenantId === tko_tenantId).sort((tko_left, tko_right) => tko_right.updatedAt.getTime() - tko_left.updatedAt.getTime()).map(tko_clone); }
  async getDocument(tko_tenantId: string, tko_documentId: string): Promise<WorkspaceDocument | null> { const tko_document = this.tko_documents.get(tko_documentId); return tko_document?.tenantId === tko_tenantId ? tko_clone(tko_document) : null; }

  async linkDocument(tko_actor: PlatformActor, tko_input: { documentId: string; entityType: WorkspaceEntityType; entityId: string; correlationId: string }): Promise<WorkspaceDocumentLink> {
    if (!await this.getDocument(tko_actor.tenantId, tko_input.documentId)) throw new Error("WORKSPACE_DOCUMENT_NOT_FOUND");
    const tko_existing = Array.from(this.tko_documentLinks.values()).find(tko_link => tko_link.tenantId === tko_actor.tenantId && tko_link.documentId === tko_input.documentId && tko_link.entityType === tko_input.entityType && tko_link.entityId === tko_input.entityId);
    if (tko_existing) return tko_clone(tko_existing);
    const tko_link: WorkspaceDocumentLink = { id: crypto.randomUUID(), tenantId: tko_actor.tenantId, type: "workspace_document_link", documentId: tko_input.documentId, entityType: tko_input.entityType, entityId: tko_input.entityId, createdAt: tko_now() };
    this.tko_documentLinks.set(tko_link.id, tko_link);
    await this.tko_emit(tko_actor, "workspace.document_linked.v1", "workspace.document", { documentId: tko_link.documentId, entityType: tko_link.entityType, entityId: tko_link.entityId }, "workspace.document.linked", "workspace_document_link", tko_link.id, tko_input.correlationId);
    return tko_clone(tko_link);
  }

  async listDocumentLinks(tko_tenantId: string, tko_documentId: string): Promise<WorkspaceDocumentLink[]> { return Array.from(this.tko_documentLinks.values()).filter(tko_link => tko_link.tenantId === tko_tenantId && tko_link.documentId === tko_documentId).map(tko_clone); }
  async listDocumentLinksForEntity(tko_tenantId: string, tko_entityType: WorkspaceEntityType, tko_entityId: string): Promise<WorkspaceDocumentLink[]> { return Array.from(this.tko_documentLinks.values()).filter(tko_link => tko_link.tenantId === tko_tenantId && tko_link.entityType === tko_entityType && tko_link.entityId === tko_entityId).map(tko_clone); }

  async createForm(tko_actor: PlatformActor, tko_input: Omit<WorkspaceForm, "id" | "tenantId" | "type" | "ownerMemberId" | "createdAt" | "updatedAt" | "status" | "accessMode"> & { correlationId: string }): Promise<WorkspaceForm> {
    const { correlationId: _tko_correlationId, ...tko_formInput } = tko_input;
    const tko_form: WorkspaceForm = { ...tko_clone(tko_formInput), id: crypto.randomUUID(), tenantId: tko_actor.tenantId, type: "workspace_form", status: "draft", accessMode: "internal", ownerMemberId: tko_actor.memberId, createdAt: tko_now(), updatedAt: tko_now() };
    this.tko_forms.set(tko_form.id, tko_form);
    await this.tko_emit(tko_actor, "workspace.form_created.v1", "workspace.form", { formId: tko_form.id, targetType: tko_form.targetType }, "workspace.form.created", "workspace_form", tko_form.id, tko_input.correlationId);
    return tko_clone(tko_form);
  }

  async listForms(tko_tenantId: string): Promise<WorkspaceForm[]> { return Array.from(this.tko_forms.values()).filter(tko_form => tko_form.tenantId === tko_tenantId).sort((tko_left, tko_right) => tko_right.updatedAt.getTime() - tko_left.updatedAt.getTime()).map(tko_clone); }
  async getForm(tko_tenantId: string, tko_formId: string): Promise<WorkspaceForm | null> { const tko_form = this.tko_forms.get(tko_formId); return tko_form?.tenantId === tko_tenantId ? tko_clone(tko_form) : null; }
  async activateForm(tko_actor: PlatformActor, tko_input: { formId: string; correlationId: string }): Promise<WorkspaceForm> { const tko_form = this.tko_forms.get(tko_input.formId); if (!tko_form || tko_form.tenantId !== tko_actor.tenantId) throw new Error("WORKSPACE_FORM_NOT_FOUND"); tko_form.status = "active"; tko_form.updatedAt = tko_now(); this.tko_forms.set(tko_form.id, tko_form); await this.tko_emit(tko_actor, "workspace.form_activated.v1", "workspace.form", { formId: tko_form.id }, "workspace.form.activated", "workspace_form", tko_form.id, tko_input.correlationId); return tko_clone(tko_form); }

  async getFormSubmission(tko_tenantId: string, tko_formId: string, tko_idempotencyKey: string): Promise<WorkspaceFormSubmission | null> { return tko_clone(this.tko_submissions.get(`${tko_tenantId}:${tko_formId}:${tko_idempotencyKey}`) ?? null); }

  async recordFormSubmission(tko_actor: PlatformActor, tko_input: Omit<WorkspaceFormSubmission, "id" | "tenantId" | "type" | "submittedByMemberId" | "createdAt"> & { correlationId: string }): Promise<WorkspaceFormSubmission> {
    const tko_key = `${tko_actor.tenantId}:${tko_input.formId}:${tko_input.idempotencyKey}`;
    const tko_existing = this.tko_submissions.get(tko_key); if (tko_existing) return tko_clone(tko_existing);
    const { correlationId: _tko_correlationId, ...tko_submissionInput } = tko_input;
    const tko_submission: WorkspaceFormSubmission = { ...tko_clone(tko_submissionInput), id: crypto.randomUUID(), tenantId: tko_actor.tenantId, type: "workspace_form_submission", submittedByMemberId: tko_actor.memberId, createdAt: tko_now() };
    this.tko_submissions.set(tko_key, tko_submission);
    await this.tko_emit(tko_actor, "workspace.form_submitted.v1", "workspace.form", { formId: tko_submission.formId, submissionId: tko_submission.id, submittedByMemberId: tko_submission.submittedByMemberId, targetEntityType: tko_submission.targetEntityType, targetEntityId: tko_submission.targetEntityId }, "workspace.form.submitted", "workspace_form_submission", tko_submission.id, tko_input.correlationId);
    return tko_clone(tko_submission);
  }

  async createAutomationRule(tko_actor: PlatformActor, tko_input: Omit<WorkspaceAutomationRule, "id" | "tenantId" | "type" | "ownerMemberId" | "version" | "createdAt" | "updatedAt"> & { correlationId: string }): Promise<WorkspaceAutomationRule> {
    const { correlationId: _tko_correlationId, ...tko_ruleInput } = tko_input;
    const tko_rule: WorkspaceAutomationRule = { ...tko_clone(tko_ruleInput), id: crypto.randomUUID(), tenantId: tko_actor.tenantId, type: "workspace_automation_rule", ownerMemberId: tko_actor.memberId, version: 1, createdAt: tko_now(), updatedAt: tko_now() };
    this.tko_rules.set(tko_rule.id, tko_rule);
    await this.tko_emit(tko_actor, "workspace.automation_rule_created.v1", "workspace.automation", { ruleId: tko_rule.id, triggerType: tko_rule.triggerType }, "workspace.automation.rule_created", "workspace_automation_rule", tko_rule.id, tko_input.correlationId);
    return tko_clone(tko_rule);
  }

  async listAutomationRules(tko_tenantId: string, tko_triggerType?: WorkspaceAutomationRule["triggerType"]): Promise<WorkspaceAutomationRule[]> { return Array.from(this.tko_rules.values()).filter(tko_rule => tko_rule.tenantId === tko_tenantId && tko_rule.status === "active" && (!tko_triggerType || tko_rule.triggerType === tko_triggerType)).map(tko_clone); }
  async listAutomationExecutions(tko_tenantId: string, tko_ruleId: string): Promise<WorkspaceAutomationExecution[]> { return Array.from(this.tko_executions.values()).filter(tko_execution => tko_execution.tenantId === tko_tenantId && tko_execution.ruleId === tko_ruleId).sort((tko_left, tko_right) => tko_right.createdAt.getTime() - tko_left.createdAt.getTime()).map(tko_clone); }
  async getAutomationExecution(tko_tenantId: string, tko_ruleId: string, tko_sourceEventId: string, tko_ruleVersion: number): Promise<WorkspaceAutomationExecution | null> { return tko_clone(this.tko_executions.get(`${tko_tenantId}:${tko_ruleId}:${tko_sourceEventId}:${tko_ruleVersion}`) ?? null); }
  async recordAutomationExecution(tko_actor: PlatformActor, tko_input: Omit<WorkspaceAutomationExecution, "id" | "tenantId" | "type" | "createdAt" | "completedAt"> & { correlationId: string }): Promise<WorkspaceAutomationExecution> {
    const tko_key = `${tko_actor.tenantId}:${tko_input.ruleId}:${tko_input.sourceEventId}:${tko_input.ruleVersion}`; const tko_existing = this.tko_executions.get(tko_key); if (tko_existing) return tko_clone(tko_existing);
    const { correlationId: _tko_correlationId, ...tko_executionInput } = tko_input;
    const tko_execution: WorkspaceAutomationExecution = { ...tko_clone(tko_executionInput), id: crypto.randomUUID(), tenantId: tko_actor.tenantId, type: "workspace_automation_execution", createdAt: tko_now(), completedAt: tko_input.status === "completed" || tko_input.status === "failed" || tko_input.status === "skipped" ? tko_now() : null };
    this.tko_executions.set(tko_key, tko_execution);
    await this.tko_emit(tko_actor, "workspace.automation_executed.v1", "workspace.automation", { executionId: tko_execution.id, ruleId: tko_execution.ruleId, status: tko_execution.status }, "workspace.automation.executed", "workspace_automation_execution", tko_execution.id, tko_input.correlationId);
    return tko_clone(tko_execution);
  }

  private async tko_emit(tko_actor: PlatformActor, tko_eventType: string, tko_topic: string, tko_payload: Record<string, unknown>, tko_action: string, tko_resourceType: string, tko_resourceId: string, tko_correlationId: string): Promise<void> {
    await getPlatformStore().writeDurableMutation({ actor: tko_actor, tenantId: tko_actor.tenantId, eventType: tko_eventType, topic: tko_topic, payload: tko_payload, auditAction: tko_action, resourceType: tko_resourceType, resourceId: tko_resourceId, correlationId: tko_correlationId });
  }
}

let tko_workspaceStore: WorkspaceStore | null = null;
export function getWorkspaceStore(): WorkspaceStore { if (!tko_workspaceStore) tko_workspaceStore = tko_config.postgresUrl ? new PostgresWorkspaceStore(tko_config.postgresUrl) : new MemoryWorkspaceStore(); return tko_workspaceStore; }
export function setWorkspaceStoreForTests(tko_store: WorkspaceStore | null): void { tko_workspaceStore = tko_store; }
