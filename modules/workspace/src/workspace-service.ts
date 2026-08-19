import type { Capability, PlatformActor, TenantResource } from "../../../packages/contracts/src/platform";
import type { CRMEntityType } from "../../../packages/contracts/src/crm";
import type { OutboxRecord } from "../../../packages/contracts/src/platform";
import type {
  AutomationTriggerType,
  WorkspaceAutomationAction,
  WorkspaceAutomationRule,
  WorkspaceEntityType,
  WorkspaceSearchDocument,
} from "../../../packages/contracts/src/workspace";
import { getChatStore } from "../../../packages/database/src/chat-store";
import { getCRMStore } from "../../../packages/database/src/crm-store";
import { getWorkStore } from "../../../packages/database/src/work-store";
import { getWorkspaceStore } from "../../../packages/database/src/workspace-store";
import { requireCapability } from "../../permissions/src/authorization";
import * as crmService from "../../crm/src/crm-service";
import * as workService from "../../work/src/work-service";

const tko_resource = (tko_actor: PlatformActor, tko_type: string, tko_id: string, tko_visibility: TenantResource["visibility"] = "internal"): TenantResource => ({ tenantId: tko_actor.tenantId, type: tko_type, id: tko_id, visibility: tko_visibility });
const tko_require = (tko_actor: PlatformActor, tko_capability: Capability, tko_type: string, tko_id: string, tko_visibility: TenantResource["visibility"] = "internal") => requireCapability(tko_actor, tko_capability, tko_resource(tko_actor, tko_type, tko_id, tko_visibility));

function tko_text(tko_value: unknown): string { return typeof tko_value === "string" ? tko_value.trim() : ""; }
function tko_stringArray(tko_value: unknown): string[] { return Array.isArray(tko_value) ? tko_value.filter((tko_item): tko_item is string => typeof tko_item === "string") : []; }

async function tko_requireEntityRead(tko_actor: PlatformActor, tko_entityType: WorkspaceEntityType, tko_entityId: string): Promise<void> {
  if (tko_entityType === "work_item") { const tko_item = await getWorkStore().getWorkItem(tko_actor.tenantId, tko_entityId); if (!tko_item) throw new Error("WORKSPACE_ENTITY_NOT_FOUND"); requireCapability(tko_actor, "work.item.read", tko_item); return; }
  if (tko_entityType === "project") { const tko_project = await getWorkStore().getProject(tko_actor.tenantId, tko_entityId); if (!tko_project) throw new Error("WORKSPACE_ENTITY_NOT_FOUND"); requireCapability(tko_actor, "work.project.read", tko_project); return; }
  if (tko_entityType === "channel") { const tko_channel = await getChatStore().getChannel(tko_actor.tenantId, tko_entityId); if (!tko_channel) throw new Error("WORKSPACE_ENTITY_NOT_FOUND"); requireCapability(tko_actor, "chat.channel.read", tko_channel); return; }
  if (tko_entityType === "message") { const tko_message = await getChatStore().getMessage(tko_actor.tenantId, tko_entityId); if (!tko_message) throw new Error("WORKSPACE_ENTITY_NOT_FOUND"); const tko_channel = await getChatStore().getChannel(tko_actor.tenantId, tko_message.channelId); if (!tko_channel) throw new Error("WORKSPACE_ENTITY_NOT_FOUND"); requireCapability(tko_actor, "chat.message.read", tko_channel); return; }
  if (tko_entityType === "document") { const tko_document = await getWorkspaceStore().getDocument(tko_actor.tenantId, tko_entityId); if (!tko_document) throw new Error("WORKSPACE_ENTITY_NOT_FOUND"); requireCapability(tko_actor, "workspace.document.read", tko_document); return; }
  if (tko_entityType === "form") { const tko_form = await getWorkspaceStore().getForm(tko_actor.tenantId, tko_entityId); if (!tko_form) throw new Error("WORKSPACE_ENTITY_NOT_FOUND"); tko_require(tko_actor, "workspace.form.read", "workspace_form", tko_form.id); return; }
  const tko_crmStore = getCRMStore();
  const tko_entity = tko_entityType === "crm_lead" ? await tko_crmStore.getLead(tko_actor.tenantId, tko_entityId)
    : tko_entityType === "crm_company" ? await tko_crmStore.getCompany(tko_actor.tenantId, tko_entityId)
      : tko_entityType === "crm_contact" ? (await tko_crmStore.listContacts(tko_actor.tenantId)).find(tko_contact => tko_contact.id === tko_entityId) ?? null
        : await tko_crmStore.getDeal(tko_actor.tenantId, tko_entityId);
  if (!tko_entity) throw new Error("WORKSPACE_ENTITY_NOT_FOUND");
  requireCapability(tko_actor, "crm.read", tko_entity);
}

async function tko_entityExists(tko_actor: PlatformActor, tko_entityType: WorkspaceEntityType, tko_entityId: string): Promise<void> { await tko_requireEntityRead(tko_actor, tko_entityType, tko_entityId); }

export async function search(tko_actor: PlatformActor, tko_input: { query: string; kind?: WorkspaceSearchDocument["kind"] }) {
  tko_require(tko_actor, "workspace.search", "workspace_search", "global");
  const tko_candidates = await getWorkspaceStore().searchDocuments(tko_actor.tenantId, tko_input.query, tko_input.kind);
  const tko_results: WorkspaceSearchDocument[] = [];
  for (const tko_candidate of tko_candidates) {
    try { await tko_requireEntityRead(tko_actor, tko_candidate.entityType, tko_candidate.entityId); tko_results.push(tko_candidate); } catch (tko_error) { if (!(tko_error instanceof Error) || !tko_error.message.startsWith("TASKO_AUTHORIZATION_DENIED")) throw tko_error; }
  }
  return tko_results;
}

export async function indexSearchDocument(tko_actor: PlatformActor, tko_input: Omit<WorkspaceSearchDocument, "id" | "type" | "tenantId" | "updatedAt"> & { correlationId: string }) {
  tko_require(tko_actor, "workspace.link.manage", "workspace_search_document", `${tko_input.entityType}:${tko_input.entityId}`);
  await tko_entityExists(tko_actor, tko_input.entityType, tko_input.entityId);
  return getWorkspaceStore().upsertSearchDocument(tko_actor, tko_input);
}

export async function inbox(tko_actor: PlatformActor, tko_options?: { includeArchived?: boolean }) { tko_require(tko_actor, "workspace.inbox.manage", "workspace_inbox", tko_actor.memberId); return getWorkspaceStore().listInbox(tko_actor.tenantId, tko_actor.memberId, tko_options); }
export async function setInboxState(tko_actor: PlatformActor, tko_input: { inboxItemId: string; state: "read" | "unread" | "archived"; correlationId: string }) { tko_require(tko_actor, "workspace.inbox.manage", "workspace_inbox", tko_input.inboxItemId); return getWorkspaceStore().setInboxState(tko_actor, tko_input); }
export async function createInboxItem(tko_actor: PlatformActor, tko_input: { memberId: string; kind: "mention" | "assignment" | "comment" | "deal" | "form" | "automation" | "system"; entityType: WorkspaceEntityType; entityId: string; title: string; body?: string; href: string; sourceEventId?: string | null; correlationId: string }) { tko_require(tko_actor, "workspace.inbox.manage", "workspace_inbox", tko_input.memberId); await tko_entityExists(tko_actor, tko_input.entityType, tko_input.entityId); return getWorkspaceStore().createInboxItem(tko_actor, { ...tko_input, body: tko_input.body ?? "", sourceEventId: tko_input.sourceEventId ?? null }); }

export async function createDocument(tko_actor: PlatformActor, tko_input: { title: string; bodyText?: string; content?: Record<string, unknown>; visibility?: "internal" | "private" | "guest_shared"; templateKey?: string | null; correlationId: string }) { tko_require(tko_actor, "workspace.document.manage", "workspace_document", "new", tko_input.visibility ?? "internal"); return getWorkspaceStore().createDocument(tko_actor, { title: tko_input.title, bodyText: tko_input.bodyText ?? "", content: tko_input.content ?? {}, visibility: tko_input.visibility ?? "internal", templateKey: tko_input.templateKey ?? null, correlationId: tko_input.correlationId }); }
export async function documents(tko_actor: PlatformActor) { tko_require(tko_actor, "workspace.document.read", "workspace_document", "list"); const tko_documents = await getWorkspaceStore().listDocuments(tko_actor.tenantId); return tko_documents.filter(tko_document => { try { requireCapability(tko_actor, "workspace.document.read", tko_document); return true; } catch { return false; } }); }
export async function linkDocument(tko_actor: PlatformActor, tko_input: { documentId: string; entityType: WorkspaceEntityType; entityId: string; correlationId: string }) { const tko_document = await getWorkspaceStore().getDocument(tko_actor.tenantId, tko_input.documentId); if (!tko_document) throw new Error("WORKSPACE_DOCUMENT_NOT_FOUND"); requireCapability(tko_actor, "workspace.document.manage", tko_document); await tko_entityExists(tko_actor, tko_input.entityType, tko_input.entityId); return getWorkspaceStore().linkDocument(tko_actor, tko_input); }
export async function entityLinks(tko_actor: PlatformActor, tko_entityType: WorkspaceEntityType, tko_entityId: string) { await tko_entityExists(tko_actor, tko_entityType, tko_entityId); return getWorkspaceStore().listEntityLinks(tko_actor.tenantId, tko_entityType, tko_entityId); }
export async function createEntityLink(tko_actor: PlatformActor, tko_input: { sourceType: WorkspaceEntityType; sourceId: string; targetType: WorkspaceEntityType; targetId: string; relationType: "context" | "reference" | "related" | "blocks"; correlationId: string }) { tko_require(tko_actor, "workspace.link.manage", "workspace_entity_link", `${tko_input.sourceId}:${tko_input.targetId}`); await tko_entityExists(tko_actor, tko_input.sourceType, tko_input.sourceId); await tko_entityExists(tko_actor, tko_input.targetType, tko_input.targetId); return getWorkspaceStore().createEntityLink(tko_actor, tko_input); }

export async function createForm(tko_actor: PlatformActor, tko_input: { name: string; description?: string; fields: import("../../../packages/contracts/src/workspace").WorkspaceFormField[]; targetType: "work_item" | "crm_lead"; targetConfig: Record<string, unknown>; correlationId: string }) { tko_require(tko_actor, "workspace.form.manage", "workspace_form", "new"); if (!tko_input.fields.length) throw new Error("WORKSPACE_FORM_FIELDS_REQUIRED"); return getWorkspaceStore().createForm(tko_actor, { name: tko_input.name, description: tko_input.description ?? "", fields: tko_input.fields, targetType: tko_input.targetType, targetConfig: tko_input.targetConfig, correlationId: tko_input.correlationId }); }
export async function forms(tko_actor: PlatformActor) { tko_require(tko_actor, "workspace.form.read", "workspace_form", "list"); return getWorkspaceStore().listForms(tko_actor.tenantId); }
export async function activateForm(tko_actor: PlatformActor, tko_input: { formId: string; correlationId: string }) { tko_require(tko_actor, "workspace.form.manage", "workspace_form", tko_input.formId); return getWorkspaceStore().activateForm(tko_actor, tko_input); }
export async function submitForm(tko_actor: PlatformActor, tko_input: { formId: string; values: Record<string, unknown>; idempotencyKey: string; correlationId: string }) {
  const tko_form = await getWorkspaceStore().getForm(tko_actor.tenantId, tko_input.formId); if (!tko_form) throw new Error("WORKSPACE_FORM_NOT_FOUND"); tko_require(tko_actor, "workspace.form.submit", "workspace_form", tko_form.id); if (tko_form.status !== "active") throw new Error("WORKSPACE_FORM_NOT_ACTIVE");
  for (const tko_field of tko_form.fields) if (tko_field.required && !tko_text(tko_input.values[tko_field.id])) throw new Error(`WORKSPACE_FORM_REQUIRED_FIELD:${tko_field.id}`);
  const tko_existing = await getWorkspaceStore().getFormSubmission(tko_actor.tenantId, tko_form.id, tko_input.idempotencyKey);
  if (tko_existing) return tko_existing;
  const tko_automationCorrelation = `tko_form:${tko_form.id}:${tko_input.idempotencyKey}`;
  if (tko_form.targetType === "work_item") {
    const tko_projectId = tko_text(tko_form.targetConfig.projectId); if (!tko_projectId) throw new Error("WORKSPACE_FORM_WORK_PROJECT_REQUIRED");
    const tko_item = await workService.createWorkItem({ actor: tko_actor, projectId: tko_projectId, title: tko_text(tko_input.values.title) || tko_form.name, description: tko_text(tko_input.values.description) || undefined, correlationId: tko_automationCorrelation });
    return getWorkspaceStore().recordFormSubmission(tko_actor, { formId: tko_form.id, values: tko_input.values, targetEntityType: "work_item", targetEntityId: tko_item.id, idempotencyKey: tko_input.idempotencyKey, correlationId: tko_input.correlationId });
  }
  const tko_lead = await crmService.createLead({ actor: tko_actor, firstName: tko_text(tko_input.values.firstName) || "Form", lastName: tko_text(tko_input.values.lastName) || "Submission", companyName: tko_text(tko_input.values.companyName) || undefined, email: tko_text(tko_input.values.email) || undefined, notes: tko_text(tko_input.values.notes) || undefined, source: `form:${tko_form.id}`, correlationId: tko_automationCorrelation });
  return getWorkspaceStore().recordFormSubmission(tko_actor, { formId: tko_form.id, values: tko_input.values, targetEntityType: "crm_lead", targetEntityId: tko_lead.id, idempotencyKey: tko_input.idempotencyKey, correlationId: tko_input.correlationId });
}

export async function createAutomationRule(tko_actor: PlatformActor, tko_input: { name: string; triggerType: AutomationTriggerType; condition?: Record<string, unknown>; actions: WorkspaceAutomationAction[]; correlationId: string }) { tko_require(tko_actor, "workspace.automation.manage", "workspace_automation_rule", "new"); if (!tko_input.actions.length) throw new Error("WORKSPACE_AUTOMATION_ACTION_REQUIRED"); return getWorkspaceStore().createAutomationRule(tko_actor, { name: tko_input.name, status: "active", triggerType: tko_input.triggerType, condition: tko_input.condition ?? {}, actions: tko_input.actions, correlationId: tko_input.correlationId }); }
export async function automationRules(tko_actor: PlatformActor) { tko_require(tko_actor, "workspace.automation.manage", "workspace_automation_rule", "list"); return getWorkspaceStore().listAutomationRules(tko_actor.tenantId); }
export async function automationExecutions(tko_actor: PlatformActor) {
  tko_require(tko_actor, "workspace.automation.manage", "workspace_automation_execution", "list");
  const tko_rules = await getWorkspaceStore().listAutomationRules(tko_actor.tenantId);
  return (await Promise.all(tko_rules.map(tko_rule => getWorkspaceStore().listAutomationExecutions(tko_actor.tenantId, tko_rule.id)))).flat().sort((tko_left, tko_right) => tko_right.createdAt.getTime() - tko_left.createdAt.getTime());
}

function tko_triggerFor(tko_eventType: string): AutomationTriggerType | null { return tko_eventType === "crm.lead_created.v1" || tko_eventType === "work.item_created.v1" || tko_eventType === "workspace.form_submitted.v1" ? tko_eventType : null; }
function tko_matchesCondition(tko_rule: WorkspaceAutomationRule, tko_record: OutboxRecord): boolean { const tko_field = tko_text(tko_rule.condition.field); if (!tko_field) return true; return tko_record.payload[tko_field] === tko_rule.condition.equals; }
function tko_template(tko_templateValue: unknown, tko_record: OutboxRecord): string { return tko_text(tko_templateValue).replace(/\{\{([^}]+)\}\}/g, (_tko_match, tko_field) => tko_text(tko_record.payload[tko_field])); }

export async function processAutomationEvent(tko_actor: PlatformActor, tko_record: OutboxRecord): Promise<void> {
  const tko_trigger = tko_triggerFor(tko_record.eventType); if (!tko_trigger || tko_record.correlationId.startsWith("tko_automation:")) return;
  const tko_rules = await getWorkspaceStore().listAutomationRules(tko_actor.tenantId, tko_trigger);
  for (const tko_rule of tko_rules) {
    const tko_previous = await getWorkspaceStore().getAutomationExecution(tko_actor.tenantId, tko_rule.id, tko_record.eventId, tko_rule.version); if (tko_previous?.status === "completed" || tko_previous?.status === "skipped") continue;
    if (!tko_matchesCondition(tko_rule, tko_record)) { await getWorkspaceStore().recordAutomationExecution(tko_actor, { ruleId: tko_rule.id, ruleVersion: tko_rule.version, sourceEventId: tko_record.eventId, status: "skipped", results: { reason: "condition_not_matched" }, error: null, correlationId: `tko_automation:${tko_record.eventId}` }); continue; }
    try {
      const tko_results: Record<string, unknown> = {};
      for (const tko_action of tko_rule.actions) {
        if (tko_action.type === "create_work_item") { const tko_projectId = tko_text(tko_action.config.projectId); if (!tko_projectId) throw new Error("WORKSPACE_AUTOMATION_PROJECT_REQUIRED"); const tko_item = await workService.createWorkItem({ actor: tko_actor, projectId: tko_projectId, title: tko_template(tko_action.config.title, tko_record) || `Automation: ${tko_rule.name}`, correlationId: `tko_automation:${tko_record.eventId}` }); tko_results.workItemId = tko_item.id; }
        if (tko_action.type === "create_crm_activity") { const tko_entityType = tko_text(tko_action.config.entityType) as CRMEntityType; const tko_entityId = tko_template(tko_action.config.entityId, tko_record); if (!(["lead", "company", "contact", "deal"] as string[]).includes(tko_entityType) || !tko_entityId) throw new Error("WORKSPACE_AUTOMATION_CRM_ACTIVITY_TARGET_REQUIRED"); const tko_activity = await crmService.addActivity(tko_actor, { entityType: tko_entityType, entityId: tko_entityId, activityType: "note", subject: tko_template(tko_action.config.subject, tko_record) || tko_rule.name, body: tko_template(tko_action.config.body, tko_record), correlationId: `tko_automation:${tko_record.eventId}` }); tko_results.crmActivityId = tko_activity.id; }
      }
      await getWorkspaceStore().recordAutomationExecution(tko_actor, { ruleId: tko_rule.id, ruleVersion: tko_rule.version, sourceEventId: tko_record.eventId, status: "completed", results: tko_results, error: null, correlationId: `tko_automation:${tko_record.eventId}` });
    } catch (tko_error) {
      const tko_errorMessage = tko_error instanceof Error ? tko_error.message : "WORKSPACE_AUTOMATION_UNKNOWN_ERROR";
      await getWorkspaceStore().recordAutomationExecution(tko_actor, { ruleId: tko_rule.id, ruleVersion: tko_rule.version, sourceEventId: tko_record.eventId, status: "failed", results: {}, error: tko_errorMessage, correlationId: `tko_automation:${tko_record.eventId}` });
      throw tko_error;
    }
  }
}

export async function overview(tko_actor: PlatformActor) {
  tko_require(tko_actor, "workspace.read", "workspace", "overview");
  const [tko_projects, tko_inboxItems, tko_documents, tko_pipelines, tko_leads] = await Promise.all([getWorkStore().listProjects(tko_actor.tenantId), inbox(tko_actor), documents(tko_actor), getCRMStore().listPipelines(tko_actor.tenantId), getCRMStore().listLeads(tko_actor.tenantId)]);
  const tko_workItems = (await Promise.all(tko_projects.map(tko_project => getWorkStore().listWorkItems(tko_actor.tenantId, tko_project.id)))).flat();
  const tko_boards = await Promise.all(tko_pipelines.map(tko_pipeline => getCRMStore().dealBoard(tko_actor.tenantId, tko_pipeline.id)));
  const tko_deals = tko_boards.flatMap(tko_board => tko_board.deals);
  const tko_recentActivity = [
    ...tko_workItems.map(tko_item => ({ id: tko_item.id, kind: "work" as const, title: tko_item.title, href: "/work", createdAt: tko_item.createdAt })),
    ...tko_documents.map(tko_document => ({ id: tko_document.id, kind: "document" as const, title: tko_document.title, href: "/docs", createdAt: tko_document.updatedAt })),
    ...tko_leads.map(tko_lead => ({ id: tko_lead.id, kind: "crm" as const, title: `${tko_lead.firstName} ${tko_lead.lastName}`.trim(), href: "/crm", createdAt: tko_lead.updatedAt })),
    ...tko_deals.map(tko_deal => ({ id: tko_deal.id, kind: "crm" as const, title: tko_deal.name, href: "/crm", createdAt: tko_deal.updatedAt })),
  ].sort((tko_left, tko_right) => tko_right.createdAt.getTime() - tko_left.createdAt.getTime()).slice(0, 8);
  const tko_hrefFor = (tko_entityType: WorkspaceEntityType) => tko_entityType === "work_item" || tko_entityType === "project" ? "/work" : tko_entityType === "channel" || tko_entityType === "message" ? "/chat" : tko_entityType === "document" ? "/docs" : tko_entityType === "form" ? "/forms" : "/crm";
  const tko_linkedObjects = (await Promise.all(tko_documents.map(async tko_document => (await getWorkspaceStore().listDocumentLinks(tko_actor.tenantId, tko_document.id)).map(tko_link => ({ tko_document, tko_link })))))
    .flat()
    .map(({ tko_document, tko_link }) => ({ documentId: tko_document.id, documentTitle: tko_document.title, entityType: tko_link.entityType, entityId: tko_link.entityId, href: tko_hrefFor(tko_link.entityType) }));
  const tko_authorizedLinks: typeof tko_linkedObjects = [];
  for (const tko_link of tko_linkedObjects) {
    try { await tko_requireEntityRead(tko_actor, tko_link.entityType, tko_link.entityId); tko_authorizedLinks.push(tko_link); } catch (tko_error) { if (!(tko_error instanceof Error) || !tko_error.message.startsWith("TASKO_AUTHORIZATION_DENIED")) throw tko_error; }
  }
  const tko_graphNodes = [
    ...tko_workItems.slice(0, 10).map(tko_item => ({ id: `work:${tko_item.id}`, label: tko_item.title, kind: "work" as const, href: "/work" })),
    ...tko_documents.filter(tko_document => tko_authorizedLinks.some(tko_link => tko_link.documentId === tko_document.id)).slice(0, 10).map(tko_document => ({ id: `document:${tko_document.id}`, label: tko_document.title, kind: "document" as const, href: "/docs" })),
  ];
  const tko_graphEdges = tko_authorizedLinks.filter(tko_link => tko_link.entityType === "work_item").map(tko_link => ({ id: `${tko_link.documentId}:${tko_link.entityId}`, sourceId: `document:${tko_link.documentId}`, targetId: `work:${tko_link.entityId}`, relation: "context" as const }));
  return { openWorkCount: tko_workItems.filter(tko_item => !tko_item.completedAt && !tko_item.archivedAt).length, dueSoonCount: tko_workItems.filter(tko_item => tko_item.dueAt && tko_item.dueAt.getTime() < Date.now() + 7 * 86_400_000 && !tko_item.completedAt).length, unreadInboxCount: tko_inboxItems.filter(tko_item => !tko_item.readAt).length, activeDealsCount: tko_deals.filter(tko_deal => !tko_deal.wonAt && !tko_deal.lostAt).length, documentsCount: tko_documents.length, recentActivity: tko_recentActivity, linkedObjects: tko_authorizedLinks, workGraph: { nodes: tko_graphNodes, edges: tko_graphEdges }, calendarItems: tko_workItems.filter(tko_item => tko_item.dueAt).sort((tko_left, tko_right) => (tko_left.dueAt?.getTime() ?? 0) - (tko_right.dueAt?.getTime() ?? 0)).slice(0, 12) };
}
