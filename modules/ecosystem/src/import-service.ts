import type { ImportFieldMapping, ImportJob, ImportSource, ImportStagingRecord, ImportTargetKind } from "../../../packages/contracts/src/ecosystem";
import type { PlatformActor, TenantResource } from "../../../packages/contracts/src/platform";
import { getCRMStore } from "../../../packages/database/src/crm-store";
import { getChatStore } from "../../../packages/database/src/chat-store";
import { getWorkStore } from "../../../packages/database/src/work-store";
import { getEcosystemStore, type EcosystemStore, type StageImportRecordInput } from "../../../packages/database/src/ecosystem-store";
import { requireCapability } from "../../permissions/src/authorization";
import * as crmService from "../../crm/src/crm-service";
import * as workService from "../../work/src/work-service";
import * as chatService from "../../chat/src/chat-service";

const tko_resource = (tko_actor: PlatformActor, tko_type: string, tko_id: string): TenantResource => ({ tenantId: tko_actor.tenantId, type: tko_type, id: tko_id, visibility: "internal" });
const tko_require = (tko_actor: PlatformActor, tko_capability: "ecosystem.import.read" | "ecosystem.import.manage", tko_type: string, tko_id: string): void => requireCapability(tko_actor, tko_capability, tko_resource(tko_actor, tko_type, tko_id));
const tko_string = (tko_value: unknown, tko_fallback = ""): string => typeof tko_value === "string" && tko_value.trim() ? tko_value.trim() : tko_fallback;
const tko_valueAt = (tko_payload: Record<string, unknown>, tko_path: string): unknown => tko_path.split(".").reduce<unknown>((tko_value, tko_key) => tko_value && typeof tko_value === "object" ? (tko_value as Record<string, unknown>)[tko_key] : undefined, tko_payload);
const tko_transform = (tko_value: unknown, tko_transformName: ImportFieldMapping["transform"]): unknown => {
  if (tko_transformName === "lowercase" || tko_transformName === "email") return tko_string(tko_value).toLowerCase();
  if (tko_transformName === "date") { const tko_date = new Date(tko_string(tko_value)); return Number.isNaN(tko_date.getTime()) ? null : tko_date.toISOString(); }
  if (tko_transformName === "split_name") { const [tko_firstName = "", ...tko_last] = tko_string(tko_value).split(/\s+/); return { firstName: tko_firstName, lastName: tko_last.join(" ") }; }
  return tko_value;
};
const tko_buildValues = (tko_record: ImportStagingRecord, tko_fields: ImportFieldMapping[]): Record<string, unknown> => {
  const tko_values: Record<string, unknown> = {};
  for (const tko_field of tko_fields) {
    const tko_value = tko_transform(tko_valueAt(tko_record.payload, tko_field.sourceField), tko_field.transform);
    if (tko_field.required && (tko_value === undefined || tko_value === null || tko_value === "")) throw new Error(`IMPORT_REQUIRED_FIELD_MISSING:${tko_field.targetField}`);
    if (tko_field.transform === "split_name" && tko_value && typeof tko_value === "object") Object.assign(tko_values, tko_value); else tko_values[tko_field.targetField] = tko_value;
  }
  return tko_values;
};
/** Natural duplicate-detection keys (spec 19 §6 mapping UI). Leads match on email, else
 * name+company; companies on lowercase domain or name; contacts on email; deals on name+company;
 * work items on project+title; channels on name. Messages have no natural key. */
const tko_naturalKey = (tko_targetKind: ImportTargetKind, tko_values: Record<string, unknown>): string | null => {
  const tko_lower = (tko_value: unknown): string => tko_string(tko_value).toLowerCase();
  if (tko_targetKind === "lead") { const tko_email = tko_lower(tko_values.email); if (tko_email) return `lead:email:${tko_email}`; const tko_name = `${tko_lower(tko_values.firstName)}|${tko_lower(tko_values.lastName)}|${tko_lower(tko_values.companyName)}`; return tko_name.replace(/\|+/g, "|").trim() ? `lead:name:${tko_name}` : null; }
  if (tko_targetKind === "company") { const tko_domain = tko_lower(tko_values.domain); if (tko_domain) return `company:domain:${tko_domain}`; const tko_name = tko_lower(tko_values.name); return tko_name ? `company:name:${tko_name}` : null; }
  if (tko_targetKind === "contact") { const tko_email = tko_lower(tko_values.email); if (tko_email) return `contact:email:${tko_email}`; const tko_name = `${tko_lower(tko_values.firstName)}|${tko_lower(tko_values.lastName)}`; return tko_name.replace(/\|/g, "").trim() ? `contact:name:${tko_name}` : null; }
  if (tko_targetKind === "deal") { const tko_name = tko_lower(tko_values.name); const tko_company = tko_lower(tko_values.companyName); return tko_name && tko_company ? `deal:name:${tko_name}|${tko_company}` : null; }
  if (tko_targetKind === "work_item") { const tko_project = tko_string(tko_values.projectId); const tko_title = tko_lower(tko_values.title); return tko_project && tko_title ? `work_item:project:${tko_project}|${tko_title}` : null; }
  if (tko_targetKind === "channel") { const tko_name = tko_lower(tko_values.name); return tko_name ? `channel:name:${tko_name}` : null; }
  return null;
};

export class ImportService {
  constructor(private readonly tko_store: EcosystemStore = getEcosystemStore()) {}

  async create(tko_actor: PlatformActor, tko_input: { source: ImportSource; name: string; sourceObjectKey?: string | null; idempotencyKey: string; correlationId: string }): Promise<ImportJob> {
    tko_require(tko_actor, "ecosystem.import.manage", "import_job", "new");
    if (!tko_input.name.trim() || !tko_input.idempotencyKey.trim()) throw new Error("IMPORT_INPUT_INVALID");
    return this.tko_store.createImportJob({ actor: tko_actor, ...tko_input });
  }

  async list(tko_actor: PlatformActor): Promise<ImportJob[]> {
    tko_require(tko_actor, "ecosystem.import.read", "import_job", "list");
    return this.tko_store.listImportJobs(tko_actor.tenantId);
  }

  async stage(tko_actor: PlatformActor, tko_input: { jobId: string; records: StageImportRecordInput[]; correlationId: string }): Promise<ImportStagingRecord[]> {
    tko_require(tko_actor, "ecosystem.import.manage", "import_job", tko_input.jobId);
    if (!tko_input.records.length || tko_input.records.length > 500) throw new Error("IMPORT_STAGE_SIZE_INVALID");
    const tko_sourceIds = new Set<string>();
    for (const tko_record of tko_input.records) { if (!tko_record.sourceRecordId.trim() || !tko_record.sourceType.trim() || tko_sourceIds.has(tko_record.sourceRecordId)) throw new Error("IMPORT_SOURCE_RECORD_INVALID"); tko_sourceIds.add(tko_record.sourceRecordId); }
    return this.tko_store.stageImportRecords(tko_actor, tko_input);
  }

  async saveMapping(tko_actor: PlatformActor, tko_input: { jobId: string; sourceType: string; targetKind: ImportTargetKind; duplicateStrategy: "skip" | "update" | "create_duplicate"; ownerMemberId?: string | null; fields: ImportFieldMapping[]; correlationId: string }) {
    tko_require(tko_actor, "ecosystem.import.manage", "import_job", tko_input.jobId);
    if (!tko_input.sourceType.trim() || !tko_input.fields.length || tko_input.fields.some(tko_field => !tko_field.sourceField.trim() || !tko_field.targetField.trim())) throw new Error("IMPORT_MAPPING_INVALID");
    const tko_mapping = await this.tko_store.saveImportMapping(tko_actor, tko_input);
    await this.tko_store.setImportJobStatus(tko_actor, { jobId: tko_input.jobId, status: "ready", correlationId: tko_input.correlationId });
    return tko_mapping;
  }

  async preview(tko_actor: PlatformActor, tko_jobId: string): Promise<{ job: ImportJob; records: ImportStagingRecord[]; mappings: Awaited<ReturnType<EcosystemStore["listImportMappings"]>>; summary: Record<string, number> }> {
    tko_require(tko_actor, "ecosystem.import.read", "import_job", tko_jobId);
    const tko_job = await this.tko_store.getImportJob(tko_actor.tenantId, tko_jobId); if (!tko_job) throw new Error("IMPORT_JOB_NOT_FOUND");
    const [tko_records, tko_mappings] = await Promise.all([this.tko_store.listStagingRecords(tko_actor.tenantId, tko_jobId), this.tko_store.listImportMappings(tko_actor.tenantId, tko_jobId)]);
    return { job: tko_job, records: tko_records, mappings: tko_mappings, summary: tko_records.reduce<Record<string, number>>((tko_summary, tko_record) => ({ ...tko_summary, [tko_record.status]: (tko_summary[tko_record.status] ?? 0) + 1 }), {}) };
  }

  async queue(tko_actor: PlatformActor, tko_input: { jobId: string; idempotencyKey: string; batchSize?: number; correlationId: string }) {
    tko_require(tko_actor, "ecosystem.import.manage", "import_job", tko_input.jobId);
    const tko_job = await this.tko_store.getImportJob(tko_actor.tenantId, tko_input.jobId); if (!tko_job) throw new Error("IMPORT_JOB_NOT_FOUND");
    const tko_records = (await this.tko_store.listStagingRecords(tko_actor.tenantId, tko_input.jobId)).filter(tko_record => ["staged", "valid", "warning"].includes(tko_record.status));
    if (!tko_records.length) throw new Error("IMPORT_HAS_NO_EXECUTABLE_RECORDS");
    const tko_size = Math.min(Math.max(tko_input.batchSize ?? 100, 1), 100);
    const tko_batches = [];
    for (let tko_start = 0; tko_start < tko_records.length; tko_start += tko_size) tko_batches.push(await this.tko_store.createImportBatch(tko_actor, { jobId: tko_job.id, idempotencyKey: `${tko_input.idempotencyKey}:${tko_start / tko_size}`, recordIds: tko_records.slice(tko_start, tko_start + tko_size).map(tko_record => tko_record.id), correlationId: tko_input.correlationId }));
    await this.tko_store.setImportJobStatus(tko_actor, { jobId: tko_job.id, status: "executing", correlationId: tko_input.correlationId });
    return tko_batches;
  }

  async executeBatch(tko_actor: PlatformActor, tko_input: { batchId: string; correlationId: string }): Promise<Awaited<ReturnType<EcosystemStore["completeImportBatch"]>>> {
    tko_require(tko_actor, "ecosystem.import.manage", "import_batch", tko_input.batchId);
    const tko_batch = await this.tko_store.getImportBatch(tko_actor.tenantId, tko_input.batchId);
    if (!tko_batch) throw new Error("IMPORT_BATCH_NOT_FOUND");
    if (tko_batch.status === "completed") return this.tko_store.completeImportBatch(tko_actor, { batchId: tko_batch.id, imported: [], warnings: 0, correlationId: tko_input.correlationId });
    const [tko_records, tko_mappings, tko_previous] = await Promise.all([this.tko_store.listStagingRecords(tko_actor.tenantId, tko_batch.importJobId), this.tko_store.listImportMappings(tko_actor.tenantId, tko_batch.importJobId), this.tko_store.listSourceMappings(tko_actor.tenantId, tko_batch.importJobId)]);
    const tko_seen = new Map<string, { targetKind: ImportTargetKind; targetEntityId: string }>(tko_previous.map(tko_mapping => [tko_mapping.sourceRecordId, { targetKind: tko_mapping.targetKind, targetEntityId: tko_mapping.targetEntityId }]));
    const tko_imported: Array<{ stagingRecordId: string; targetKind: ImportTargetKind; targetEntityId: string }> = [];
    const tko_duplicateIndex = await this.tko_buildDuplicateIndex(tko_actor);
    for (const tko_record of tko_records.filter(tko_record => tko_batch.recordIds.includes(tko_record.id))) {
      const tko_existing = tko_seen.get(tko_record.sourceRecordId); if (tko_existing) { tko_imported.push({ stagingRecordId: tko_record.id, targetKind: tko_existing.targetKind, targetEntityId: tko_existing.targetEntityId }); continue; }
      const tko_mapping = tko_mappings.find(tko_candidate => tko_candidate.sourceType === tko_record.sourceType); if (!tko_mapping) throw new Error("IMPORT_MAPPING_REQUIRED");
      const tko_values = tko_buildValues(tko_record, tko_mapping.fields);
      const tko_targetId = await this.tko_resolveTarget(tko_actor, tko_record, tko_mapping.targetKind, tko_mapping.duplicateStrategy, tko_values, tko_seen, tko_duplicateIndex, tko_input.correlationId);
      tko_imported.push({ stagingRecordId: tko_record.id, targetKind: tko_mapping.targetKind, targetEntityId: tko_targetId });
      tko_seen.set(tko_record.sourceRecordId, { targetKind: tko_mapping.targetKind, targetEntityId: tko_targetId });
    }
    return this.tko_store.completeImportBatch(tko_actor, { batchId: tko_batch.id, imported: tko_imported, warnings: 0, correlationId: tko_input.correlationId });
  }

  /** Duplicate-strategy resolution (spec 19 §2). Re-runs are always idempotent via the persisted
   * source mapping; the strategy only decides what the FIRST execution of a source record does:
   *  - skip: materialize a new record (historical staged-import semantics);
   *  - update: match an existing tenant record by its natural key and update its mutable fields
   *    (original id/history is kept); create when no match exists;
   *  - create_duplicate: always materialize a new record. */
  private async tko_resolveTarget(tko_actor: PlatformActor, tko_record: ImportStagingRecord, tko_targetKind: ImportTargetKind, tko_strategy: "skip" | "update" | "create_duplicate", tko_values: Record<string, unknown>, tko_sourceMappings: Map<string, { targetKind: ImportTargetKind; targetEntityId: string }>, tko_duplicateIndex: Map<string, string>, tko_correlationId: string): Promise<string> {
    if (tko_strategy === "update") {
      const tko_key = tko_naturalKey(tko_targetKind, tko_values);
      if (tko_key) {
        const tko_existingId = tko_duplicateIndex.get(tko_key);
        if (tko_existingId) { await this.tko_applyUpdates(tko_actor, tko_targetKind, tko_existingId, tko_values, tko_correlationId); return tko_existingId; }
      }
      const tko_createdId = await this.tko_materialize(tko_actor, tko_record, tko_targetKind, tko_values, tko_sourceMappings, tko_correlationId);
      if (tko_key) tko_duplicateIndex.set(tko_key, tko_createdId);
      return tko_createdId;
    }
    return this.tko_materialize(tko_actor, tko_record, tko_targetKind, tko_values, tko_sourceMappings, tko_correlationId);
  }

  private async tko_applyUpdates(tko_actor: PlatformActor, tko_targetKind: ImportTargetKind, tko_existingId: string, tko_values: Record<string, unknown>, tko_correlationId: string): Promise<void> {
    // Only CRM records expose a mutation API for imports. Empty values are ignored so an
    // unmapped column never wipes an existing field. Original ids and history are preserved.
    const tko_present = (tko_field: string): string | undefined => { const tko_value = tko_string(tko_values[tko_field]); return tko_value ? tko_value : undefined; };
    if (tko_targetKind === "lead") { await crmService.updateLead(tko_actor, { leadId: tko_existingId, ...(tko_present("firstName") ? { firstName: tko_present("firstName") } : {}), ...(tko_present("lastName") ? { lastName: tko_present("lastName") } : {}), ...(tko_present("companyName") ? { companyName: tko_present("companyName") } : {}), ...(tko_present("email") ? { email: tko_present("email") } : {}), ...(tko_present("phone") ? { phone: tko_present("phone") } : {}), ...(tko_present("website") ? { website: tko_present("website") } : {}), ...(tko_present("country") ? { country: tko_present("country") } : {}), ...(tko_present("jobTitle") ? { jobTitle: tko_present("jobTitle") } : {}), ...(tko_present("notes") ? { notes: tko_present("notes") } : {}), correlationId: tko_correlationId }); return; }
    if (tko_targetKind === "company") { await crmService.updateCompany(tko_actor, { companyId: tko_existingId, ...(tko_present("name") ? { name: tko_present("name") } : {}), ...(tko_present("domain") ? { domain: tko_present("domain") } : {}), ...(tko_present("website") ? { website: tko_present("website") } : {}), ...(tko_present("industry") ? { industry: tko_present("industry") } : {}), ...(tko_present("country") ? { country: tko_present("country") } : {}), ...(tko_present("lifecycleStatus") ? { lifecycleStatus: tko_present("lifecycleStatus") } : {}), correlationId: tko_correlationId }); return; }
    if (tko_targetKind === "contact") { await crmService.updateContact(tko_actor, { contactId: tko_existingId, ...(tko_present("firstName") ? { firstName: tko_present("firstName") } : {}), ...(tko_present("lastName") ? { lastName: tko_present("lastName") } : {}), ...(tko_present("title") ? { title: tko_present("title") } : {}), ...(tko_values.emails !== undefined && Array.isArray(tko_values.emails) && tko_values.emails.length ? { emails: (tko_values.emails as string[]).map(tko_email => tko_string(tko_email)).filter(Boolean) } : {}), ...(tko_values.phones !== undefined && Array.isArray(tko_values.phones) && tko_values.phones.length ? { phones: (tko_values.phones as string[]).map(tko_phone => tko_string(tko_phone)).filter(Boolean) } : {}), correlationId: tko_correlationId }); return; }
    // Deals, work items, channels and messages have no import mutation API: a matched record
    // keeps its original id and history untouched (mapping still recorded => idempotent re-runs).
  }

  /** In-tenant natural-key index used by the `update` duplicate strategy. Keys are namespaced by
   * target kind so the same email can exist as a lead and a contact without colliding. */
  private async tko_buildDuplicateIndex(tko_actor: PlatformActor): Promise<Map<string, string>> {
    const tko_index = new Map<string, string>();
    const tko_crm = getCRMStore();
    for (const tko_lead of await tko_crm.listLeads(tko_actor.tenantId)) { const tko_key = tko_naturalKey("lead", { email: tko_lead.email, firstName: tko_lead.firstName, lastName: tko_lead.lastName, companyName: tko_lead.companyName }); if (tko_key) tko_index.set(tko_key, tko_lead.id); }
    for (const tko_company of await tko_crm.listCompanies(tko_actor.tenantId)) { const tko_key = tko_naturalKey("company", { name: tko_company.name, domain: tko_company.domain }); if (tko_key) tko_index.set(tko_key, tko_company.id); }
    for (const tko_contact of await tko_crm.listContacts(tko_actor.tenantId)) { const tko_key = tko_naturalKey("contact", { email: tko_contact.emails[0] ?? "", firstName: tko_contact.firstName, lastName: tko_contact.lastName }); if (tko_key) tko_index.set(tko_key, tko_contact.id); }
    for (const tko_deal of await tko_crm.listDeals(tko_actor.tenantId)) { const tko_companyName = tko_deal.companyId ? (await tko_crm.getCompany(tko_actor.tenantId, tko_deal.companyId))?.name ?? "" : ""; const tko_key = tko_naturalKey("deal", { name: tko_deal.name, companyName: tko_companyName }); if (tko_key) tko_index.set(tko_key, tko_deal.id); }
    const tko_work = getWorkStore();
    for (const tko_project of await tko_work.listProjects(tko_actor.tenantId)) for (const tko_item of await tko_work.listWorkItems(tko_actor.tenantId, tko_project.id)) { const tko_key = tko_naturalKey("work_item", { projectId: tko_item.projectId, title: tko_item.title }); if (tko_key) tko_index.set(tko_key, tko_item.id); }
    const tko_chat = getChatStore();
    for (const tko_channel of await tko_chat.listChannels(tko_actor.tenantId, tko_actor.memberId)) { if (tko_channel.archivedAt) continue; const tko_key = tko_naturalKey("channel", { name: tko_channel.name ?? "" }); if (tko_key) tko_index.set(tko_key, tko_channel.id); }
    return tko_index;
  }

  private async tko_materialize(tko_actor: PlatformActor, tko_record: ImportStagingRecord, tko_targetKind: ImportTargetKind, tko_values: Record<string, unknown>, tko_sourceMappings: Map<string, { targetKind: ImportTargetKind; targetEntityId: string }>, tko_correlationId: string): Promise<string> {
    if (tko_targetKind === "lead") return (await crmService.createLead({ actor: tko_actor, firstName: tko_string(tko_values.firstName, "Imported"), lastName: tko_string(tko_values.lastName), companyName: tko_string(tko_values.companyName), email: tko_string(tko_values.email), phone: tko_string(tko_values.phone), source: `import:${tko_record.sourceType}`, notes: tko_string(tko_values.notes), customFields: { importJobId: tko_record.importJobId, sourceRecordId: tko_record.sourceRecordId }, correlationId: tko_correlationId })).id;
    if (tko_targetKind === "company") return (await crmService.createCompany(tko_actor, { name: tko_string(tko_values.name, "Imported company"), domain: tko_string(tko_values.domain) || undefined, website: tko_string(tko_values.website) || undefined, industry: tko_string(tko_values.industry) || undefined, country: tko_string(tko_values.country) || undefined, lifecycleStatus: tko_string(tko_values.lifecycleStatus) || undefined, correlationId: tko_correlationId })).id;
    if (tko_targetKind === "contact") { const tko_companyId = tko_string(tko_values.companyId) || (tko_string(tko_values.companyName) ? (await getCRMStore().listCompanies(tko_actor.tenantId)).find(tko_company => tko_company.name.toLowerCase() === tko_string(tko_values.companyName).toLowerCase())?.id ?? null : null); return (await crmService.createContact(tko_actor, { companyId: tko_companyId, firstName: tko_string(tko_values.firstName, "Imported"), lastName: tko_string(tko_values.lastName), title: tko_string(tko_values.title) || undefined, emails: tko_string(tko_values.email) ? [tko_string(tko_values.email)] : undefined, phones: tko_string(tko_values.phone) ? [tko_string(tko_values.phone)] : undefined, correlationId: tko_correlationId })).id; }
    if (tko_targetKind === "deal") { const tko_pipelineId = tko_string(tko_values.pipelineId); const tko_stageId = tko_string(tko_values.stageId); if (!tko_pipelineId || !tko_stageId) throw new Error("IMPORT_DEAL_PIPELINE_REQUIRED"); const tko_companyName = tko_string(tko_values.companyName); const tko_companyId = tko_string(tko_values.companyId) || (tko_companyName ? (await getCRMStore().listCompanies(tko_actor.tenantId)).find(tko_company => tko_company.name.toLowerCase() === tko_companyName.toLowerCase())?.id ?? null : null); const tko_amount = tko_values.amountCents; return (await crmService.createDeal(tko_actor, { companyId: tko_companyId, pipelineId: tko_pipelineId, stageId: tko_stageId, name: tko_string(tko_values.name, "Imported deal"), amountCents: typeof tko_amount === "number" && Number.isFinite(tko_amount) ? tko_amount : null, currency: tko_string(tko_values.currency) || undefined, probability: typeof tko_values.probability === "number" ? tko_values.probability : undefined, expectedCloseDate: tko_string(tko_values.expectedCloseDate) ? new Date(tko_string(tko_values.expectedCloseDate)) : null, source: `import:${tko_record.sourceType}`, nextStep: tko_string(tko_values.nextStep) || undefined, correlationId: tko_correlationId })).id; }
    if (tko_targetKind === "work_item") { const tko_projectId = tko_string(tko_values.projectId); if (!tko_projectId) throw new Error("IMPORT_WORK_PROJECT_REQUIRED"); return (await workService.createWorkItem({ actor: tko_actor, projectId: tko_projectId, title: tko_string(tko_values.title, "Imported work item"), description: tko_string(tko_values.description), correlationId: tko_correlationId })).id; }
    if (tko_targetKind === "channel") return (await chatService.createChannel(tko_actor, { kind: tko_values.kind === "private" ? "private" : "public", name: tko_string(tko_values.name, `imported-${tko_record.sourceRecordId}`), topic: tko_string(tko_values.topic), memberIds: [tko_actor.memberId], visibility: "internal" })).id;
    if (tko_targetKind === "message") { const tko_channelSourceId = tko_string(tko_values.channelSourceId); const tko_channelId = tko_string(tko_values.channelId) || tko_sourceMappings.get(tko_channelSourceId)?.targetEntityId; if (!tko_channelId) throw new Error("IMPORT_SLACK_CHANNEL_MAPPING_REQUIRED"); return (await chatService.sendMessage(tko_actor, { channelId: tko_channelId, clientMessageId: `import:${tko_record.importJobId}:${tko_record.sourceRecordId}`, body: { type: "text", text: tko_string(tko_values.text, "[empty historical message]") } }, tko_correlationId)).id; }
    throw new Error(`IMPORT_TARGET_NOT_SUPPORTED:${tko_targetKind}`);
  }
}

let tko_importService: ImportService | null = null;
export function getImportService(): ImportService { if (!tko_importService) tko_importService = new ImportService(); return tko_importService; }
export function setImportServiceForTests(tko_service: ImportService | null): void { tko_importService = tko_service; }
