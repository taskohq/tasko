import type { Capability, PlatformActor, TenantResource } from "../../../packages/contracts/src/platform";
import type { CRMEntityType } from "../../../packages/contracts/src/crm";
import type { OutboxRecord } from "../../../packages/contracts/src/platform";
import type {
  AutomationTriggerType,
  WorkspaceAutomationAction,
  WorkspaceAutomationRule,
  WorkspaceDocument,
  WorkspaceEntityType,
  WorkspaceSearchDocument,
} from "../../../packages/contracts/src/workspace";
import { getChatStore } from "../../../packages/database/src/chat-store";
import { getCRMStore } from "../../../packages/database/src/crm-store";
import { getPlatformStore } from "../../../packages/database/src/platform-store";
import { getWorkStore } from "../../../packages/database/src/work-store";
import { getWorkspaceStore } from "../../../packages/database/src/workspace-store";
import { requireCapability } from "../../permissions/src/authorization";
import { getSaaSService } from "../../saas/src/saas-service";
import { storageGetSignedUrl, storagePut } from "../../../server/storage";
import * as crmService from "../../crm/src/crm-service";
import * as workService from "../../work/src/work-service";

const tko_resource = (tko_actor: PlatformActor, tko_type: string, tko_id: string, tko_visibility: TenantResource["visibility"] = "internal"): TenantResource => ({ tenantId: tko_actor.tenantId, type: tko_type, id: tko_id, visibility: tko_visibility });
const tko_require = (tko_actor: PlatformActor, tko_capability: Capability, tko_type: string, tko_id: string, tko_visibility: TenantResource["visibility"] = "internal") => requireCapability(tko_actor, tko_capability, tko_resource(tko_actor, tko_type, tko_id, tko_visibility));

function tko_text(tko_value: unknown): string { return typeof tko_value === "string" ? tko_value.trim() : ""; }
function tko_stringArray(tko_value: unknown): string[] { return Array.isArray(tko_value) ? tko_value.filter((tko_item): tko_item is string => typeof tko_item === "string") : []; }
const tko_documentFileTypes = new Set(["application/pdf", "text/plain", "text/markdown", "text/csv", "application/msword", "application/vnd.ms-excel", "application/vnd.ms-powerpoint", "application/vnd.oasis.opendocument.text", "application/vnd.oasis.opendocument.spreadsheet", "application/vnd.oasis.opendocument.presentation", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/vnd.openxmlformats-officedocument.presentationml.presentation"]);
const tko_documentFileMaxBytes = 15 * 1024 * 1024;
function tko_safeDocumentFilename(tko_filename: string): string { const tko_safe = tko_filename.trim().replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, ""); if (!tko_safe || tko_safe.length > 180) throw new Error("WORKSPACE_DOCUMENT_FILENAME_INVALID"); return tko_safe; }

async function tko_requireProjectDocumentAccess(tko_actor: PlatformActor, tko_projectId: string, tko_capability: "work.project.read" | "work.item.update") {
  const tko_project = await getWorkStore().getProject(tko_actor.tenantId, tko_projectId);
  if (!tko_project) throw new Error("WORKSPACE_DOCUMENT_PROJECT_NOT_FOUND");
  requireCapability(tko_actor, tko_capability, tko_project);
  return tko_project;
}

export async function tko_requireEntityRead(tko_actor: PlatformActor, tko_entityType: WorkspaceEntityType, tko_entityId: string): Promise<void> {
  if (tko_entityType === "work_item") { const tko_item = await getWorkStore().getWorkItem(tko_actor.tenantId, tko_entityId); if (!tko_item) throw new Error("WORKSPACE_ENTITY_NOT_FOUND"); const tko_project = await getWorkStore().getProject(tko_actor.tenantId, tko_item.projectId); if (!tko_project) throw new Error("WORKSPACE_ENTITY_NOT_FOUND"); requireCapability(tko_actor, "work.project.read", tko_project); requireCapability(tko_actor, "work.item.read", tko_item); return; }
  if (tko_entityType === "project") { const tko_project = await getWorkStore().getProject(tko_actor.tenantId, tko_entityId); if (!tko_project) throw new Error("WORKSPACE_ENTITY_NOT_FOUND"); requireCapability(tko_actor, "work.project.read", tko_project); return; }
  if (tko_entityType === "channel") { const tko_channel = await getChatStore().getChannel(tko_actor.tenantId, tko_entityId); if (!tko_channel) throw new Error("WORKSPACE_ENTITY_NOT_FOUND"); requireCapability(tko_actor, "chat.channel.read", tko_channel); return; }
  if (tko_entityType === "message") { const tko_message = await getChatStore().getMessage(tko_actor.tenantId, tko_entityId); if (!tko_message) throw new Error("WORKSPACE_ENTITY_NOT_FOUND"); const tko_channel = await getChatStore().getChannel(tko_actor.tenantId, tko_message.channelId); if (!tko_channel) throw new Error("WORKSPACE_ENTITY_NOT_FOUND"); requireCapability(tko_actor, "chat.message.read", tko_channel); return; }
  if (tko_entityType === "document") { const tko_document = await getWorkspaceStore().getDocument(tko_actor.tenantId, tko_entityId); if (!tko_document) throw new Error("WORKSPACE_ENTITY_NOT_FOUND"); requireCapability(tko_actor, "workspace.document.read", tko_document); if (tko_document.projectId) await tko_requireProjectDocumentAccess(tko_actor, tko_document.projectId, "work.project.read"); return; }
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

/** Trusted worker-only path: source resource was loaded tenant-scoped from a durable outbox event. User reads remain exact-authorized in `search`. */
export async function materializeSearchDocument(tko_actor: PlatformActor, tko_input: Omit<WorkspaceSearchDocument, "id" | "type" | "tenantId" | "updatedAt"> & { correlationId: string }) {
  tko_require(tko_actor, "workspace.link.manage", "workspace_search_document", `${tko_input.entityType}:${tko_input.entityId}`);
  return getWorkspaceStore().upsertSearchDocument(tko_actor, tko_input);
}

export async function inbox(tko_actor: PlatformActor, tko_options?: { includeArchived?: boolean }) { tko_require(tko_actor, "workspace.inbox.manage", "workspace_inbox", tko_actor.memberId); return getWorkspaceStore().listInbox(tko_actor.tenantId, tko_actor.memberId, tko_options); }
export async function setInboxState(tko_actor: PlatformActor, tko_input: { inboxItemId: string; state: "read" | "unread" | "archived"; correlationId: string }) { tko_require(tko_actor, "workspace.inbox.manage", "workspace_inbox", tko_input.inboxItemId); return getWorkspaceStore().setInboxState(tko_actor, tko_input); }
export async function createInboxItem(tko_actor: PlatformActor, tko_input: { memberId: string; kind: "mention" | "assignment" | "comment" | "deal" | "form" | "automation" | "system"; entityType: WorkspaceEntityType; entityId: string; title: string; body?: string; href: string; sourceEventId?: string | null; correlationId: string }) { tko_require(tko_actor, "workspace.inbox.manage", "workspace_inbox", tko_input.memberId); await tko_entityExists(tko_actor, tko_input.entityType, tko_input.entityId); return getWorkspaceStore().createInboxItem(tko_actor, { ...tko_input, body: tko_input.body ?? "", sourceEventId: tko_input.sourceEventId ?? null }); }

export async function createDocument(tko_actor: PlatformActor, tko_input: { title: string; bodyText?: string; content?: Record<string, unknown>; visibility?: "internal" | "private" | "guest_shared"; templateKey?: string | null; correlationId: string }) { tko_require(tko_actor, "workspace.document.manage", "workspace_document", "new", tko_input.visibility ?? "internal"); return getWorkspaceStore().createDocument(tko_actor, { title: tko_input.title, documentKind: "note", projectId: null, objectKey: null, filename: null, contentType: null, byteSize: null, bodyText: tko_input.bodyText ?? "", content: tko_input.content ?? {}, visibility: tko_input.visibility ?? "internal", templateKey: tko_input.templateKey ?? null, correlationId: tko_input.correlationId }); }
export async function documents(tko_actor: PlatformActor) {
  tko_require(tko_actor, "workspace.document.read", "workspace_document", "list");
  const tko_visible: WorkspaceDocument[] = [];
  for (const tko_document of await getWorkspaceStore().listDocuments(tko_actor.tenantId)) {
    try { await tko_requireEntityRead(tko_actor, "document", tko_document.id); tko_visible.push(tko_document); } catch { /* Do not disclose document metadata outside an authorized scope. */ }
  }
  return tko_visible;
}
export async function uploadDocumentFile(tko_actor: PlatformActor, tko_input: { projectId: string; filename: string; contentType: string; base64: string; correlationId: string }) {
  tko_require(tko_actor, "workspace.document.manage", "workspace_document", "new");
  const tko_project = await tko_requireProjectDocumentAccess(tko_actor, tko_input.projectId, "work.item.update");
  const tko_filename = tko_safeDocumentFilename(tko_input.filename);
  const tko_contentType = tko_input.contentType.toLocaleLowerCase();
  if (!tko_documentFileTypes.has(tko_contentType) && !tko_contentType.startsWith("image/")) throw new Error("WORKSPACE_DOCUMENT_FILE_TYPE_UNSUPPORTED");
  const tko_bytes = Buffer.from(tko_input.base64, "base64");
  if (!tko_bytes.length || tko_bytes.length > tko_documentFileMaxBytes) throw new Error("WORKSPACE_DOCUMENT_FILE_SIZE_INVALID");
  const tko_objectKey = `tenants/${tko_actor.tenantId}/workspace-documents/${tko_project.id}/${crypto.randomUUID()}/${tko_filename}`;
  await storagePut(tko_objectKey, tko_bytes, tko_contentType);
  return getWorkspaceStore().createDocument(tko_actor, { title: tko_filename, documentKind: "file", projectId: tko_project.id, objectKey: tko_objectKey, filename: tko_filename, contentType: tko_contentType, byteSize: tko_bytes.length, bodyText: "", content: {}, visibility: tko_project.visibility, templateKey: null, correlationId: tko_input.correlationId });
}
export async function documentDownloadUrl(tko_actor: PlatformActor, tko_documentId: string) {
  await tko_requireEntityRead(tko_actor, "document", tko_documentId);
  const tko_document = await getWorkspaceStore().getDocument(tko_actor.tenantId, tko_documentId);
  if (!tko_document || tko_document.documentKind !== "file" || !tko_document.objectKey) throw new Error("WORKSPACE_DOCUMENT_FILE_NOT_FOUND");
  return { url: await storageGetSignedUrl(tko_document.objectKey), filename: tko_document.filename, contentType: tko_document.contentType };
}
export async function removeDocumentFile(tko_actor: PlatformActor, tko_documentId: string, tko_correlationId: string) {
  const tko_document = await getWorkspaceStore().getDocument(tko_actor.tenantId, tko_documentId);
  if (!tko_document || tko_document.documentKind !== "file") throw new Error("WORKSPACE_DOCUMENT_FILE_NOT_FOUND");
  requireCapability(tko_actor, "workspace.document.manage", tko_document);
  if (tko_document.projectId) await tko_requireProjectDocumentAccess(tko_actor, tko_document.projectId, "work.item.update");
  return getWorkspaceStore().removeDocument(tko_actor, { documentId: tko_document.id, correlationId: tko_correlationId });
}
export async function linkDocument(tko_actor: PlatformActor, tko_input: { documentId: string; entityType: WorkspaceEntityType; entityId: string; correlationId: string }) { const tko_document = await getWorkspaceStore().getDocument(tko_actor.tenantId, tko_input.documentId); if (!tko_document) throw new Error("WORKSPACE_DOCUMENT_NOT_FOUND"); requireCapability(tko_actor, "workspace.document.manage", tko_document); await tko_entityExists(tko_actor, tko_input.entityType, tko_input.entityId); return getWorkspaceStore().linkDocument(tko_actor, tko_input); }
export async function entityLinks(tko_actor: PlatformActor, tko_entityType: WorkspaceEntityType, tko_entityId: string) { await tko_entityExists(tko_actor, tko_entityType, tko_entityId); return getWorkspaceStore().listEntityLinks(tko_actor.tenantId, tko_entityType, tko_entityId); }
export async function createEntityLink(tko_actor: PlatformActor, tko_input: { sourceType: WorkspaceEntityType; sourceId: string; targetType: WorkspaceEntityType; targetId: string; relationType: "context" | "reference" | "related" | "blocks"; correlationId: string }) { tko_require(tko_actor, "workspace.link.manage", "workspace_entity_link", `${tko_input.sourceId}:${tko_input.targetId}`); await tko_entityExists(tko_actor, tko_input.sourceType, tko_input.sourceId); await tko_entityExists(tko_actor, tko_input.targetType, tko_input.targetId); return getWorkspaceStore().createEntityLink(tko_actor, tko_input); }

/** Version history (spec 10 §2 P2). Listing requires the same read scope as the document itself:
 * a non-reader of a private document is denied before any revision metadata leaks. */
export async function documentRevisions(tko_actor: PlatformActor, tko_documentId: string) {
  await tko_requireEntityRead(tko_actor, "document", tko_documentId);
  return getWorkspaceStore().listDocumentRevisions(tko_actor.tenantId, tko_documentId);
}

export async function updateDocumentContent(tko_actor: PlatformActor, tko_input: { documentId: string; title?: string; bodyText: string; content?: Record<string, unknown>; correlationId: string }) {
  const tko_document = await getWorkspaceStore().getDocument(tko_actor.tenantId, tko_input.documentId);
  if (!tko_document) throw new Error("WORKSPACE_DOCUMENT_NOT_FOUND");
  requireCapability(tko_actor, "workspace.document.manage", tko_document);
  if (tko_document.projectId) await tko_requireProjectDocumentAccess(tko_actor, tko_document.projectId, "work.item.update");
  return getWorkspaceStore().updateDocumentContent(tko_actor, { documentId: tko_document.id, title: tko_input.title, bodyText: tko_input.bodyText, content: tko_input.content ?? {}, correlationId: tko_input.correlationId });
}

/** Restore is never destructive: it writes a NEW revision carrying the restored snapshot. */
export async function restoreDocumentRevision(tko_actor: PlatformActor, tko_input: { documentId: string; revisionId: string; correlationId: string }) {
  const tko_document = await getWorkspaceStore().getDocument(tko_actor.tenantId, tko_input.documentId);
  if (!tko_document) throw new Error("WORKSPACE_DOCUMENT_NOT_FOUND");
  requireCapability(tko_actor, "workspace.document.manage", tko_document);
  if (tko_document.projectId) await tko_requireProjectDocumentAccess(tko_actor, tko_document.projectId, "work.item.update");
  const tko_revisions = await getWorkspaceStore().listDocumentRevisions(tko_actor.tenantId, tko_input.documentId);
  if (!tko_revisions.some(tko_revision => tko_revision.id === tko_input.revisionId)) throw new Error("WORKSPACE_DOCUMENT_REVISION_NOT_FOUND");
  return getWorkspaceStore().restoreDocumentRevision(tko_actor, { documentId: tko_document.id, revisionId: tko_input.revisionId, correlationId: tko_input.correlationId });
}

export async function createForm(tko_actor: PlatformActor, tko_input: { name: string; description?: string; fields: import("../../../packages/contracts/src/workspace").WorkspaceFormField[]; targetType: "work_item" | "crm_lead"; targetConfig: Record<string, unknown>; correlationId: string }) {
  tko_require(tko_actor, "workspace.form.manage", "workspace_form", "new");
  if (!tko_input.fields.length) throw new Error("WORKSPACE_FORM_FIELDS_REQUIRED");
  if (tko_input.targetType === "work_item") {
    const tko_projectId = tko_text(tko_input.targetConfig.projectId);
    if (!tko_projectId) throw new Error("WORKSPACE_FORM_WORK_PROJECT_REQUIRED");
    const tko_project = await getWorkStore().getProject(tko_actor.tenantId, tko_projectId);
    if (!tko_project) throw new Error("WORKSPACE_FORM_WORK_PROJECT_NOT_FOUND");
    requireCapability(tko_actor, "work.item.create", tko_project);
  }
  return getWorkspaceStore().createForm(tko_actor, { name: tko_input.name, description: tko_input.description ?? "", fields: tko_input.fields, targetType: tko_input.targetType, targetConfig: tko_input.targetConfig, correlationId: tko_input.correlationId });
}
export async function forms(tko_actor: PlatformActor) { tko_require(tko_actor, "workspace.form.read", "workspace_form", "list"); return getWorkspaceStore().listForms(tko_actor.tenantId); }
export async function activateForm(tko_actor: PlatformActor, tko_input: { formId: string; correlationId: string }) { tko_require(tko_actor, "workspace.form.manage", "workspace_form", tko_input.formId); return getWorkspaceStore().activateForm(tko_actor, tko_input); }

/** Public share mode (spec 10 §5). Enabling regenerates the slug; disabling clears it. */
export async function setFormSharing(tko_actor: PlatformActor, tko_input: { formId: string; isPublic: boolean; correlationId: string }) {
  tko_require(tko_actor, "workspace.form.manage", "workspace_form", tko_input.formId);
  const tko_form = await getWorkspaceStore().getForm(tko_actor.tenantId, tko_input.formId);
  if (!tko_form) throw new Error("WORKSPACE_FORM_NOT_FOUND");
  let tko_slug: string | null = null;
  if (tko_input.isPublic) {
    const tko_alphabet = "abcdefghijkmnpqrstuvwxyz23456789";
    do { tko_slug = Array.from(crypto.getRandomValues(new Uint8Array(16))).map(tko_byte => tko_alphabet[tko_byte % tko_alphabet.length]).join(""); } while (await getWorkspaceStore().getPublicFormBySlug(tko_slug));
  }
  return getWorkspaceStore().setFormSharing(tko_actor, { formId: tko_form.id, isPublic: tko_input.isPublic, shareSlug: tko_slug, correlationId: tko_input.correlationId });
}
export async function formSubmissions(tko_actor: PlatformActor, tko_formId: string) {
  const tko_form = await getWorkspaceStore().getForm(tko_actor.tenantId, tko_formId);
  if (!tko_form) throw new Error("WORKSPACE_FORM_NOT_FOUND");
  tko_require(tko_actor, "workspace.form.read", "workspace_form", tko_form.id);
  return getWorkspaceStore().listFormSubmissions(tko_actor.tenantId, tko_form.id);
}
export async function submitForm(tko_actor: PlatformActor, tko_input: { formId: string; values: Record<string, unknown>; idempotencyKey: string; correlationId: string }) {
  const tko_form = await getWorkspaceStore().getForm(tko_actor.tenantId, tko_input.formId); if (!tko_form) throw new Error("WORKSPACE_FORM_NOT_FOUND"); tko_require(tko_actor, "workspace.form.submit", "workspace_form", tko_form.id); if (tko_form.status !== "active") throw new Error("WORKSPACE_FORM_NOT_ACTIVE");
  for (const tko_field of tko_form.fields) if (tko_field.required && !tko_text(tko_input.values[tko_field.id])) throw new Error(`WORKSPACE_FORM_REQUIRED_FIELD:${tko_field.id}`);
  const tko_existing = await getWorkspaceStore().getFormSubmission(tko_actor.tenantId, tko_form.id, tko_input.idempotencyKey);
  if (tko_existing) return tko_existing;
  const tko_automationCorrelation = `tko_form:${tko_form.id}:${tko_input.idempotencyKey}`;
  await getSaaSService().enforceFeatureUsage(tko_actor, { feature: "forms", metric: "form_submissions", amount: 1, idempotencyKey: `form:${tko_form.id}:${tko_input.idempotencyKey}`, correlationId: tko_input.correlationId });
  if (tko_form.targetType === "work_item") {
    const tko_projectId = tko_text(tko_form.targetConfig.projectId); if (!tko_projectId) throw new Error("WORKSPACE_FORM_WORK_PROJECT_REQUIRED");
    const tko_item = await workService.createWorkItem({ actor: tko_actor, projectId: tko_projectId, title: tko_text(tko_input.values.title) || tko_form.name, description: tko_text(tko_input.values.description) || undefined, correlationId: tko_automationCorrelation });
    return getWorkspaceStore().recordFormSubmission(tko_actor, { formId: tko_form.id, values: tko_input.values, targetEntityType: "work_item", targetEntityId: tko_item.id, idempotencyKey: tko_input.idempotencyKey, correlationId: tko_input.correlationId });
  }
  const tko_lead = await crmService.createLead({ actor: tko_actor, firstName: tko_text(tko_input.values.firstName) || "Form", lastName: tko_text(tko_input.values.lastName) || "Submission", companyName: tko_text(tko_input.values.companyName) || undefined, email: tko_text(tko_input.values.email) || undefined, notes: tko_text(tko_input.values.notes) || undefined, source: `form:${tko_form.id}`, correlationId: tko_automationCorrelation });
  return getWorkspaceStore().recordFormSubmission(tko_actor, { formId: tko_form.id, values: tko_input.values, targetEntityType: "crm_lead", targetEntityId: tko_lead.id, idempotencyKey: tko_input.idempotencyKey, correlationId: tko_input.correlationId });
}

export async function createAutomationRule(tko_actor: PlatformActor, tko_input: { name: string; triggerType: AutomationTriggerType; condition?: Record<string, unknown>; conditions?: Array<{ field: string; equals: string | number | boolean | null }>; actions: WorkspaceAutomationAction[]; correlationId: string }) {
  tko_require(tko_actor, "workspace.automation.manage", "workspace_automation_rule", "new");
  await getSaaSService().requireFeature(tko_actor, "automation");
  if (!tko_input.actions.length) throw new Error("WORKSPACE_AUTOMATION_ACTION_REQUIRED");
  if ((tko_input.conditions?.length ?? 0) > 3) throw new Error("WORKSPACE_AUTOMATION_CONDITIONS_TOO_MANY");
  for (const tko_condition of tko_input.conditions ?? []) if (!tko_text(tko_condition.field)) throw new Error("WORKSPACE_AUTOMATION_CONDITION_FIELD_REQUIRED");
  for (const tko_action of tko_input.actions) {
    if (tko_action.type === "create_work_item") {
      const tko_projectId = tko_text(tko_action.config.projectId);
      if (!tko_projectId) throw new Error("WORKSPACE_AUTOMATION_PROJECT_REQUIRED");
      const tko_project = await getWorkStore().getProject(tko_actor.tenantId, tko_projectId);
      if (!tko_project) throw new Error("WORKSPACE_AUTOMATION_PROJECT_NOT_FOUND");
      requireCapability(tko_actor, "work.item.create", tko_project);
    }
    if (tko_action.type === "post_channel_message") {
      const tko_channelId = tko_text(tko_action.config.channelId);
      const tko_body = tko_text(tko_action.config.body);
      if (!tko_channelId || !tko_body) throw new Error("WORKSPACE_AUTOMATION_CHANNEL_MESSAGE_TARGET_REQUIRED");
      const tko_channel = await getChatStore().getChannel(tko_actor.tenantId, tko_channelId);
      if (!tko_channel) throw new Error("WORKSPACE_AUTOMATION_CHANNEL_NOT_FOUND");
      requireCapability(tko_actor, "chat.message.send", tko_channel);
    }
    if (tko_action.type === "notify_user") {
      const tko_memberId = tko_text(tko_action.config.memberId);
      if (!tko_memberId) throw new Error("WORKSPACE_AUTOMATION_NOTIFY_MEMBER_REQUIRED");
      const tko_members = await getPlatformStore().listTenantMembers(tko_actor.tenantId);
      if (!tko_members.some(tko_member => tko_member.id === tko_memberId && tko_member.status === "active")) throw new Error("WORKSPACE_AUTOMATION_MEMBER_NOT_FOUND");
    }
    if (tko_action.type === "update_work_item") {
      const tko_hasChange = tko_text(tko_action.config.statusId) || Array.isArray(tko_action.config.assigneeMemberIds) && tko_action.config.assigneeMemberIds.length > 0 || tko_action.config.dueAt !== undefined;
      if (!tko_hasChange) throw new Error("WORKSPACE_AUTOMATION_UPDATE_TARGET_REQUIRED");
      const tko_statusId = tko_text(tko_action.config.statusId);
      if (tko_statusId) {
        const tko_projects = await getWorkStore().listProjects(tko_actor.tenantId);
        const tko_statuses = (await Promise.all(tko_projects.map(tko_project => getWorkStore().listStatuses(tko_actor.tenantId, tko_project.workflowId)))).flat();
        if (!tko_statuses.some(tko_status => tko_status.id === tko_statusId)) throw new Error("WORKSPACE_AUTOMATION_STATUS_NOT_FOUND");
      }
      if (tko_text(tko_action.config.workItemId)) {
        const tko_item = await getWorkStore().getWorkItem(tko_actor.tenantId, tko_text(tko_action.config.workItemId));
        if (!tko_item) throw new Error("WORKSPACE_AUTOMATION_WORK_ITEM_NOT_FOUND");
      }
    }
  }
  return getWorkspaceStore().createAutomationRule(tko_actor, { name: tko_input.name, status: "active", triggerType: tko_input.triggerType, condition: tko_input.condition ?? {}, conditions: tko_input.conditions ?? [], actions: tko_input.actions, correlationId: tko_input.correlationId });
}
export async function automationRules(tko_actor: PlatformActor) { tko_require(tko_actor, "workspace.automation.manage", "workspace_automation_rule", "list"); return getWorkspaceStore().listAutomationRules(tko_actor.tenantId); }
export async function automationExecutions(tko_actor: PlatformActor) {
  tko_require(tko_actor, "workspace.automation.manage", "workspace_automation_execution", "list");
  const tko_rules = await getWorkspaceStore().listAutomationRules(tko_actor.tenantId);
  return (await Promise.all(tko_rules.map(tko_rule => getWorkspaceStore().listAutomationExecutions(tko_actor.tenantId, tko_rule.id)))).flat().sort((tko_left, tko_right) => tko_right.createdAt.getTime() - tko_left.createdAt.getTime());
}

function tko_triggerFor(tko_eventType: string): AutomationTriggerType | null { return tko_eventType === "crm.lead_created.v1" || tko_eventType === "work.work_item_created.v1" || tko_eventType === "work.work_item_status_changed.v1" || tko_eventType === "crm.deal_stage_changed.v1" || tko_eventType === "crm.deal_won.v1" || tko_eventType === "workspace.form_submitted.v1" ? tko_eventType : null; }
function tko_matchesCondition(tko_rule: WorkspaceAutomationRule, tko_record: OutboxRecord): boolean {
  // Legacy single-field condition and v2 AND-ed condition list may coexist; every declared
  // condition must match (spec 12 §4 all-of). A condition on a missing payload field never matches.
  const tko_legacyField = tko_text(tko_rule.condition.field);
  if (tko_legacyField && tko_record.payload[tko_legacyField] !== tko_rule.condition.equals) return false;
  for (const tko_condition of tko_rule.conditions ?? []) {
    const tko_value = tko_record.payload[tko_condition.field];
    if (tko_value !== tko_condition.equals) return false;
  }
  return true;
}
function tko_template(tko_templateValue: unknown, tko_record: OutboxRecord): string { return tko_text(tko_templateValue).replace(/\{\{([^}]+)\}\}/g, (_tko_match, tko_field) => tko_text(tko_record.payload[tko_field])); }
function tko_triggerEntityFor(tko_record: OutboxRecord): { entityType: WorkspaceEntityType; entityId: string } | null {
  if (tko_record.eventType.startsWith("work.")) { const tko_workItemId = tko_payloadId(tko_record, "workItemId"); return tko_workItemId ? { entityType: "work_item", entityId: tko_workItemId } : null; }
  if (tko_record.eventType.startsWith("crm.deal")) { const tko_dealId = tko_payloadId(tko_record, "dealId"); return tko_dealId ? { entityType: "crm_deal", entityId: tko_dealId } : null; }
  if (tko_record.eventType === "crm.lead_created.v1") { const tko_leadId = tko_payloadId(tko_record, "leadId"); return tko_leadId ? { entityType: "crm_lead", entityId: tko_leadId } : null; }
  if (tko_record.eventType === "workspace.form_submitted.v1") { const tko_type = tko_payloadId(tko_record, "targetEntityType"); const tko_entityId = tko_payloadId(tko_record, "targetEntityId"); return tko_type === "work_item" || tko_type === "crm_lead" ? { entityType: tko_type, entityId: tko_entityId ?? "" } : null; }
  return null;
}
function tko_payloadId(tko_record: OutboxRecord, tko_name: string): string | null { const tko_value = tko_record.payload[tko_name]; return typeof tko_value === "string" ? tko_value : null; }

export async function processAutomationEvent(tko_actor: PlatformActor, tko_record: OutboxRecord): Promise<void> {
  const tko_trigger = tko_triggerFor(tko_record.eventType); if (!tko_trigger || tko_record.correlationId.startsWith("tko_automation:")) return;
  const tko_rules = await getWorkspaceStore().listAutomationRules(tko_actor.tenantId, tko_trigger);
  for (const tko_rule of tko_rules) {
    const tko_previous = await getWorkspaceStore().getAutomationExecution(tko_actor.tenantId, tko_rule.id, tko_record.eventId, tko_rule.version); if (tko_previous?.status === "completed" || tko_previous?.status === "skipped") continue;
    if (!tko_matchesCondition(tko_rule, tko_record)) { await getWorkspaceStore().recordAutomationExecution(tko_actor, { ruleId: tko_rule.id, ruleVersion: tko_rule.version, sourceEventId: tko_record.eventId, status: "skipped", results: { reason: "condition_not_matched" }, error: null, correlationId: `tko_automation:${tko_record.eventId}` }); continue; }
    try {
      await getSaaSService().enforceFeatureUsage(tko_actor, { feature: "automation", metric: "automation_executions", amount: 1, idempotencyKey: `automation:${tko_rule.id}:${tko_record.eventId}:${tko_rule.version}`, correlationId: `tko_automation:${tko_record.eventId}` });
      const tko_results: Record<string, unknown> = {};
      for (const tko_action of tko_rule.actions) {
        if (tko_action.type === "create_work_item") { const tko_projectId = tko_text(tko_action.config.projectId); if (!tko_projectId) throw new Error("WORKSPACE_AUTOMATION_PROJECT_REQUIRED"); const tko_item = await workService.createWorkItem({ actor: tko_actor, projectId: tko_projectId, title: tko_template(tko_action.config.title, tko_record) || `Automation: ${tko_rule.name}`, correlationId: `tko_automation:${tko_record.eventId}` }); tko_results.workItemId = tko_item.id; }
        if (tko_action.type === "create_crm_activity") { const tko_entityType = tko_text(tko_action.config.entityType) as CRMEntityType; const tko_entityId = tko_template(tko_action.config.entityId, tko_record); if (!(["lead", "company", "contact", "deal"] as string[]).includes(tko_entityType) || !tko_entityId) throw new Error("WORKSPACE_AUTOMATION_CRM_ACTIVITY_TARGET_REQUIRED"); const tko_activity = await crmService.addActivity(tko_actor, { entityType: tko_entityType, entityId: tko_entityId, activityType: "note", subject: tko_template(tko_action.config.subject, tko_record) || tko_rule.name, body: tko_template(tko_action.config.body, tko_record), correlationId: `tko_automation:${tko_record.eventId}` }); tko_results.crmActivityId = tko_activity.id; }
        if (tko_action.type === "post_channel_message") {
          const tko_channelId = tko_text(tko_action.config.channelId);
          const tko_body = tko_template(tko_action.config.body, tko_record);
          if (!tko_channelId || !tko_body) throw new Error("WORKSPACE_AUTOMATION_CHANNEL_MESSAGE_TARGET_REQUIRED");
          // Trusted worker path: post through the chat store directly, mirroring the CRM handoff
          // worker. Capability checks were applied when the rule was created.
          const tko_channel = await getChatStore().getChannel(tko_actor.tenantId, tko_channelId);
          if (!tko_channel) throw new Error("WORKSPACE_AUTOMATION_CHANNEL_NOT_FOUND");
          const tko_message = await getChatStore().sendMessage(tko_actor, { tenantId: tko_actor.tenantId, channelId: tko_channel.id, authorMemberId: tko_actor.memberId, clientMessageId: crypto.randomUUID(), body: { type: "text", text: tko_body, mentions: [] } }, `tko_automation:${tko_record.eventId}`);
          tko_results.messageId = tko_message.id;
        }
        if (tko_action.type === "notify_user") {
          const tko_memberId = tko_text(tko_action.config.memberId);
          if (!tko_memberId) throw new Error("WORKSPACE_AUTOMATION_NOTIFY_MEMBER_REQUIRED");
          const tko_entity = tko_triggerEntityFor(tko_record);
          await getWorkspaceStore().createInboxItem(tko_actor, { memberId: tko_memberId, kind: "automation", entityType: tko_entity?.entityType ?? "form", entityId: tko_entity?.entityId ?? (tko_record.payload.submissionId ? String(tko_record.payload.submissionId) : tko_record.eventId), title: tko_template(tko_action.config.title, tko_record) || `Automation: ${tko_rule.name}`, body: tko_template(tko_action.config.body, tko_record), href: tko_entity ? (tko_entity.entityType === "work_item" ? `/work?item=${tko_entity.entityId}` : tko_entity.entityType === "crm_deal" ? `/crm?deal=${tko_entity.entityId}` : tko_entity.entityType === "crm_lead" ? `/crm?lead=${tko_entity.entityId}` : "/") : "/", sourceEventId: tko_record.eventId, correlationId: `tko_automation:${tko_record.eventId}` });
          tko_results.notifiedMemberId = tko_memberId;
        }
        if (tko_action.type === "update_work_item") {
          const tko_workItemId = tko_text(tko_action.config.workItemId) || tko_payloadId(tko_record, "workItemId");
          if (!tko_workItemId) throw new Error("WORKSPACE_AUTOMATION_WORK_ITEM_REQUIRED");
          const tko_item = await getWorkStore().getWorkItem(tko_actor.tenantId, tko_workItemId);
          if (!tko_item) throw new Error("WORKSPACE_AUTOMATION_WORK_ITEM_NOT_FOUND");
          const tko_statusId = tko_text(tko_action.config.statusId);
          if (tko_statusId && tko_statusId !== tko_item.statusId) { await getWorkStore().transitionWorkItem({ actor: tko_actor, workItemId: tko_item.id, targetStatusId: tko_statusId, expectedVersion: tko_item.version, correlationId: `tko_automation:${tko_record.eventId}` }); tko_results.updatedStatusId = tko_statusId; }
          const tko_assigneeMemberIds = Array.isArray(tko_action.config.assigneeMemberIds) ? tko_action.config.assigneeMemberIds.filter((tko_id): tko_id is string => typeof tko_id === "string") : null;
          const tko_dueAtRaw = tko_action.config.dueAt;
          const tko_dueAt = typeof tko_dueAtRaw === "string" && tko_dueAtRaw ? new Date(tko_dueAtRaw) : tko_dueAtRaw === null ? null : undefined;
          if (tko_dueAt instanceof Date && Number.isNaN(tko_dueAt.getTime())) throw new Error("WORKSPACE_AUTOMATION_DUE_AT_INVALID");
          if (tko_assigneeMemberIds?.length || tko_dueAt !== undefined) { await getWorkStore().updateWorkItem({ actor: tko_actor, workItemId: tko_item.id, expectedVersion: tko_statusId && tko_statusId !== tko_item.statusId ? tko_item.version + 1 : tko_item.version, assigneeMemberIds: tko_assigneeMemberIds ?? undefined, dueAt: tko_dueAt, correlationId: `tko_automation:${tko_record.eventId}` }); tko_results.updatedWorkItemId = tko_item.id; }
        }
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
  ].sort((tko_left, tko_right) => tko_right.createdAt.getTime() - tko_left.createdAt.getTime());
  const tko_weekAgoMs = Date.now() - 7 * 86_400_000;
  const tko_thisWeekActivityCount = tko_recentActivity.filter(tko_activity => tko_activity.createdAt.getTime() >= tko_weekAgoMs).length;
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
  return { openWorkCount: tko_workItems.filter(tko_item => !tko_item.completedAt && !tko_item.archivedAt).length, dueSoonCount: tko_workItems.filter(tko_item => tko_item.dueAt && tko_item.dueAt.getTime() < Date.now() + 7 * 86_400_000 && !tko_item.completedAt).length, unreadInboxCount: tko_inboxItems.filter(tko_item => !tko_item.readAt).length, activeDealsCount: tko_deals.filter(tko_deal => !tko_deal.wonAt && !tko_deal.lostAt).length, documentsCount: tko_documents.length, thisWeekActivityCount: tko_thisWeekActivityCount, overdueWorkItemsCount: tko_workItems.filter(tko_item => tko_item.dueAt && tko_item.dueAt.getTime() < Date.now() && !tko_item.completedAt && !tko_item.archivedAt).length, openPipelineValueCents: tko_deals.filter(tko_deal => !tko_deal.wonAt && !tko_deal.lostAt).reduce((tko_total, tko_deal) => tko_total + (tko_deal.amountCents ?? 0), 0), recentActivity: tko_recentActivity.slice(0, 8), linkedObjects: tko_authorizedLinks, workGraph: { nodes: tko_graphNodes, edges: tko_graphEdges }, calendarItems: tko_workItems.filter(tko_item => tko_item.dueAt).sort((tko_left, tko_right) => (tko_left.dueAt?.getTime() ?? 0) - (tko_right.dueAt?.getTime() ?? 0)).slice(0, 12) };
}
