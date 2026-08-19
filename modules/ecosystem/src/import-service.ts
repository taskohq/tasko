import type { ImportFieldMapping, ImportJob, ImportSource, ImportStagingRecord, ImportTargetKind } from "../../../packages/contracts/src/ecosystem";
import type { PlatformActor, TenantResource } from "../../../packages/contracts/src/platform";
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
    const tko_seen = new Map<string, { targetKind: ImportTargetKind; targetEntityId: string }>(tko_previous.map(tko_mapping => [tko_mapping.sourceRecordId, { targetKind: tko_mapping.targetKind, targetEntityId: tko_mapping.targetEntityId }])); const tko_imported: Array<{ stagingRecordId: string; targetKind: ImportTargetKind; targetEntityId: string }> = [];
    for (const tko_record of tko_records.filter(tko_record => tko_batch.recordIds.includes(tko_record.id))) {
      const tko_existing = tko_seen.get(tko_record.sourceRecordId); if (tko_existing) { tko_imported.push({ stagingRecordId: tko_record.id, targetKind: tko_existing.targetKind, targetEntityId: tko_existing.targetEntityId }); continue; }
      const tko_mapping = tko_mappings.find(tko_candidate => tko_candidate.sourceType === tko_record.sourceType); if (!tko_mapping) throw new Error("IMPORT_MAPPING_REQUIRED");
      const tko_targetId = await this.tko_materialize(tko_actor, tko_record, tko_mapping.targetKind, tko_mapping.fields, tko_seen, tko_input.correlationId);
      tko_imported.push({ stagingRecordId: tko_record.id, targetKind: tko_mapping.targetKind, targetEntityId: tko_targetId });
      tko_seen.set(tko_record.sourceRecordId, { targetKind: tko_mapping.targetKind, targetEntityId: tko_targetId });
    }
    return this.tko_store.completeImportBatch(tko_actor, { batchId: tko_batch.id, imported: tko_imported, warnings: 0, correlationId: tko_input.correlationId });
  }

  private async tko_materialize(tko_actor: PlatformActor, tko_record: ImportStagingRecord, tko_targetKind: ImportTargetKind, tko_fields: ImportFieldMapping[], tko_sourceMappings: Map<string, { targetKind: ImportTargetKind; targetEntityId: string }>, tko_correlationId: string): Promise<string> {
    const tko_values: Record<string, unknown> = {};
    for (const tko_field of tko_fields) { const tko_value = tko_transform(tko_valueAt(tko_record.payload, tko_field.sourceField), tko_field.transform); if (tko_field.required && (tko_value === undefined || tko_value === null || tko_value === "")) throw new Error(`IMPORT_REQUIRED_FIELD_MISSING:${tko_field.targetField}`); if (tko_field.transform === "split_name" && tko_value && typeof tko_value === "object") Object.assign(tko_values, tko_value); else tko_values[tko_field.targetField] = tko_value; }
    if (tko_targetKind === "lead") return (await crmService.createLead({ actor: tko_actor, firstName: tko_string(tko_values.firstName, "Imported"), lastName: tko_string(tko_values.lastName), companyName: tko_string(tko_values.companyName), email: tko_string(tko_values.email), phone: tko_string(tko_values.phone), source: `import:${tko_record.sourceType}`, notes: tko_string(tko_values.notes), customFields: { importJobId: tko_record.importJobId, sourceRecordId: tko_record.sourceRecordId }, correlationId: tko_correlationId })).id;
    if (tko_targetKind === "work_item") { const tko_projectId = tko_string(tko_values.projectId); if (!tko_projectId) throw new Error("IMPORT_WORK_PROJECT_REQUIRED"); return (await workService.createWorkItem({ actor: tko_actor, projectId: tko_projectId, title: tko_string(tko_values.title, "Imported work item"), description: tko_string(tko_values.description), correlationId: tko_correlationId })).id; }
    if (tko_targetKind === "channel") return (await chatService.createChannel(tko_actor, { kind: tko_values.kind === "private" ? "private" : "public", name: tko_string(tko_values.name, `imported-${tko_record.sourceRecordId}`), topic: tko_string(tko_values.topic), memberIds: [tko_actor.memberId], visibility: "internal" })).id;
    if (tko_targetKind === "message") { const tko_channelSourceId = tko_string(tko_values.channelSourceId); const tko_channelId = tko_string(tko_values.channelId) || tko_sourceMappings.get(tko_channelSourceId)?.targetEntityId; if (!tko_channelId) throw new Error("IMPORT_SLACK_CHANNEL_MAPPING_REQUIRED"); return (await chatService.sendMessage(tko_actor, { channelId: tko_channelId, clientMessageId: `import:${tko_record.importJobId}:${tko_record.sourceRecordId}`, body: { type: "text", text: tko_string(tko_values.text, "[empty historical message]") } }, tko_correlationId)).id; }
    throw new Error(`IMPORT_TARGET_NOT_SUPPORTED:${tko_targetKind}`);
  }
}

let tko_importService: ImportService | null = null;
export function getImportService(): ImportService { if (!tko_importService) tko_importService = new ImportService(); return tko_importService; }
export function setImportServiceForTests(tko_service: ImportService | null): void { tko_importService = tko_service; }
