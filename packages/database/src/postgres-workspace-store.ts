import { Pool, type PoolClient } from "pg";
import type { PlatformActor } from "../../contracts/src/platform";
import type {
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
import type { WorkspaceInboxItemResult, WorkspaceStore } from "./workspace-store";

type TkoRow = Record<string, unknown>;
const tko_date = (tko_value: unknown): Date | null => tko_value ? new Date(String(tko_value)) : null;
const tko_json = <T>(tko_value: unknown, tko_fallback: T): T => typeof tko_value === "string" ? JSON.parse(tko_value) as T : (tko_value ?? tko_fallback) as T;

export class PostgresWorkspaceStore implements WorkspaceStore {
  private readonly tko_pool: Pool;
  constructor(tko_url: string) { this.tko_pool = new Pool({ connectionString: tko_url, max: 10 }); }
  async close(): Promise<void> { await this.tko_pool.end(); }

  async upsertSearchDocument(tko_actor: PlatformActor, tko_input: Omit<WorkspaceSearchDocument, "id" | "type" | "tenantId" | "updatedAt"> & { correlationId: string }): Promise<WorkspaceSearchDocument> {
    return this.tko_tx(tko_actor.tenantId, async tko_client => {
      const tko_result = await tko_client.query(`insert into workspace_search_documents(id,tenant_id,entity_type,entity_id,kind,title,body_text,href,visibility,explicit_member_ids_json,updated_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,now()) on conflict(tenant_id,entity_type,entity_id) do update set kind=excluded.kind,title=excluded.title,body_text=excluded.body_text,href=excluded.href,visibility=excluded.visibility,explicit_member_ids_json=excluded.explicit_member_ids_json,updated_at=now() returning *`, [crypto.randomUUID(), tko_actor.tenantId, tko_input.entityType, tko_input.entityId, tko_input.kind, tko_input.title.trim(), tko_input.bodyText.trim(), tko_input.href, tko_input.visibility, JSON.stringify(tko_input.explicitMemberIds)]);
      const tko_document = this.tko_searchRow(tko_result.rows[0]);
      await this.tko_emit(tko_client, tko_actor, "workspace.search_indexed.v1", "workspace.search", { entityType: tko_document.entityType, entityId: tko_document.entityId }, "workspace.search.indexed", "workspace_search_document", tko_document.id, tko_input.correlationId);
      return tko_document;
    });
  }

  async searchDocuments(tko_tenantId: string, tko_query: string, tko_kind?: WorkspaceSearchDocument["kind"]): Promise<WorkspaceSearchDocument[]> {
    const tko_normalized = tko_query.trim(); if (!tko_normalized) return [];
    return this.tko_read(tko_tenantId, async tko_client => {
      const tko_queryArgs: unknown[] = [tko_tenantId, tko_normalized];
      const tko_kindSql = tko_kind ? `and kind=$${tko_queryArgs.push(tko_kind)}` : "";
      const tko_result = await tko_client.query(`select * from workspace_search_documents where tenant_id=$1 and to_tsvector('simple',title || ' ' || body_text) @@ websearch_to_tsquery('simple',$2) ${tko_kindSql} order by updated_at desc limit 50`, tko_queryArgs);
      return tko_result.rows.map(this.tko_searchRow);
    });
  }

  async createInboxItem(tko_actor: PlatformActor, tko_input: Parameters<WorkspaceStore["createInboxItem"]>[1]): Promise<WorkspaceInboxItemResult> {
    return this.tko_tx(tko_actor.tenantId, async tko_client => {
      const tko_existing = await tko_client.query("select * from workspace_inbox_items where tenant_id=$1 and member_id=$2 and source_event_id is not distinct from $3 and kind=$4", [tko_actor.tenantId, tko_input.memberId, tko_input.sourceEventId, tko_input.kind]);
      if (tko_existing.rowCount) return this.tko_inboxRow(tko_existing.rows[0]);
      const tko_result = await tko_client.query(`insert into workspace_inbox_items(id,tenant_id,member_id,kind,entity_type,entity_id,title,body,href,source_event_id) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *`, [crypto.randomUUID(), tko_actor.tenantId, tko_input.memberId, tko_input.kind, tko_input.entityType, tko_input.entityId, tko_input.title.trim(), tko_input.body.trim(), tko_input.href, tko_input.sourceEventId]);
      const tko_item = this.tko_inboxRow(tko_result.rows[0]);
      await this.tko_emit(tko_client, tko_actor, "workspace.inbox_item_created.v1", "workspace.inbox", { inboxItemId: tko_item.id, memberId: tko_item.memberId, entityType: tko_item.entityType, entityId: tko_item.entityId }, "workspace.inbox.item_created", "workspace_inbox_item", tko_item.id, tko_input.correlationId);
      return tko_item;
    });
  }

  async listInbox(tko_tenantId: string, tko_memberId: string, tko_options: { includeArchived?: boolean } = {}): Promise<WorkspaceInboxItemResult[]> {
    return this.tko_read(tko_tenantId, async tko_client => (await tko_client.query(`select * from workspace_inbox_items where tenant_id=$1 and member_id=$2 ${tko_options.includeArchived ? "" : "and archived_at is null"} order by created_at desc`, [tko_tenantId, tko_memberId])).rows.map(this.tko_inboxRow));
  }

  async setInboxState(tko_actor: PlatformActor, tko_input: { inboxItemId: string; state: "read" | "unread" | "archived"; correlationId: string }): Promise<WorkspaceInboxItemResult> {
    return this.tko_tx(tko_actor.tenantId, async tko_client => {
      const tko_setSql = tko_input.state === "read" ? "read_at=now(), archived_at=null" : tko_input.state === "unread" ? "read_at=null, archived_at=null" : "archived_at=now()";
      const tko_result = await tko_client.query(`update workspace_inbox_items set ${tko_setSql} where tenant_id=$1 and id=$2 and member_id=$3 returning *`, [tko_actor.tenantId, tko_input.inboxItemId, tko_actor.memberId]);
      if (!tko_result.rowCount) throw new Error("WORKSPACE_INBOX_ITEM_NOT_FOUND");
      const tko_item = this.tko_inboxRow(tko_result.rows[0]);
      await this.tko_emit(tko_client, tko_actor, "workspace.inbox_item_state_changed.v1", "workspace.inbox", { inboxItemId: tko_item.id, state: tko_input.state }, "workspace.inbox.state_changed", "workspace_inbox_item", tko_item.id, tko_input.correlationId);
      return tko_item;
    });
  }

  async createEntityLink(tko_actor: PlatformActor, tko_input: Parameters<WorkspaceStore["createEntityLink"]>[1]): Promise<WorkspaceEntityLink> {
    return this.tko_tx(tko_actor.tenantId, async tko_client => {
      const tko_result = await tko_client.query(`insert into workspace_entity_links(id,tenant_id,source_type,source_id,target_type,target_id,relation_type) values($1,$2,$3,$4,$5,$6,$7) on conflict(tenant_id,source_type,source_id,target_type,target_id,relation_type) do update set relation_type=excluded.relation_type returning *`, [crypto.randomUUID(), tko_actor.tenantId, tko_input.sourceType, tko_input.sourceId, tko_input.targetType, tko_input.targetId, tko_input.relationType]);
      const tko_link = this.tko_entityLinkRow(tko_result.rows[0]);
      await this.tko_emit(tko_client, tko_actor, "workspace.entity_linked.v1", "workspace.link", { sourceType: tko_link.sourceType, sourceId: tko_link.sourceId, targetType: tko_link.targetType, targetId: tko_link.targetId }, "workspace.entity.linked", "workspace_entity_link", tko_link.id, tko_input.correlationId);
      return tko_link;
    });
  }

  async listEntityLinks(tko_tenantId: string, tko_entityType: WorkspaceEntityType, tko_entityId: string): Promise<WorkspaceEntityLink[]> { return this.tko_read(tko_tenantId, async tko_client => (await tko_client.query("select * from workspace_entity_links where tenant_id=$1 and ((source_type=$2 and source_id=$3) or (target_type=$2 and target_id=$3)) order by created_at desc", [tko_tenantId, tko_entityType, tko_entityId])).rows.map(this.tko_entityLinkRow)); }

  async createDocument(tko_actor: PlatformActor, tko_input: Parameters<WorkspaceStore["createDocument"]>[1]): Promise<WorkspaceDocument> {
    return this.tko_tx(tko_actor.tenantId, async tko_client => {
      const tko_result = await tko_client.query(`insert into workspace_documents(id,tenant_id,title,document_kind,project_id,object_key,filename,content_type,byte_size,content_json,body_text,owner_member_id,visibility,template_key) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13,$14) returning *`, [crypto.randomUUID(), tko_actor.tenantId, tko_input.title.trim(), tko_input.documentKind, tko_input.projectId, tko_input.objectKey, tko_input.filename, tko_input.contentType, tko_input.byteSize, JSON.stringify(tko_input.content), tko_input.bodyText.trim(), tko_actor.memberId, tko_input.visibility, tko_input.templateKey]);
      const tko_document = this.tko_documentRow(tko_result.rows[0]);
      await this.tko_emit(tko_client, tko_actor, "workspace.document_created.v1", "workspace.document", { documentId: tko_document.id, title: tko_document.title }, "workspace.document.created", "workspace_document", tko_document.id, tko_input.correlationId);
      return tko_document;
    });
  }

  async listDocuments(tko_tenantId: string): Promise<WorkspaceDocument[]> { return this.tko_read(tko_tenantId, async tko_client => (await tko_client.query("select * from workspace_documents where tenant_id=$1 order by updated_at desc", [tko_tenantId])).rows.map(this.tko_documentRow)); }
  async getDocument(tko_tenantId: string, tko_documentId: string): Promise<WorkspaceDocument | null> { return this.tko_read(tko_tenantId, async tko_client => { const tko_result = await tko_client.query("select * from workspace_documents where tenant_id=$1 and id=$2", [tko_tenantId, tko_documentId]); return tko_result.rowCount ? this.tko_documentRow(tko_result.rows[0]) : null; }); }

  async removeDocument(tko_actor: PlatformActor, tko_input: { documentId: string; correlationId: string }): Promise<WorkspaceDocument> {
    return this.tko_tx(tko_actor.tenantId, async tko_client => {
      const tko_result = await tko_client.query("delete from workspace_documents where tenant_id=$1 and id=$2 returning *", [tko_actor.tenantId, tko_input.documentId]);
      if (!tko_result.rowCount) throw new Error("WORKSPACE_DOCUMENT_NOT_FOUND");
      const tko_document = this.tko_documentRow(tko_result.rows[0]);
      await this.tko_emit(tko_client, tko_actor, "workspace.document_deleted.v1", "workspace.document", { documentId: tko_document.id, projectId: tko_document.projectId }, "workspace.document.deleted", "workspace_document", tko_document.id, tko_input.correlationId);
      return tko_document;
    });
  }

  async linkDocument(tko_actor: PlatformActor, tko_input: { documentId: string; entityType: WorkspaceEntityType; entityId: string; correlationId: string }): Promise<WorkspaceDocumentLink> {
    return this.tko_tx(tko_actor.tenantId, async tko_client => {
      const tko_exists = await tko_client.query("select id from workspace_documents where tenant_id=$1 and id=$2", [tko_actor.tenantId, tko_input.documentId]); if (!tko_exists.rowCount) throw new Error("WORKSPACE_DOCUMENT_NOT_FOUND");
      const tko_result = await tko_client.query(`insert into workspace_document_links(id,tenant_id,document_id,entity_type,entity_id) values($1,$2,$3,$4,$5) on conflict(tenant_id,document_id,entity_type,entity_id) do update set entity_id=excluded.entity_id returning *`, [crypto.randomUUID(), tko_actor.tenantId, tko_input.documentId, tko_input.entityType, tko_input.entityId]);
      const tko_link = this.tko_documentLinkRow(tko_result.rows[0]);
      await this.tko_emit(tko_client, tko_actor, "workspace.document_linked.v1", "workspace.document", { documentId: tko_link.documentId, entityType: tko_link.entityType, entityId: tko_link.entityId }, "workspace.document.linked", "workspace_document_link", tko_link.id, tko_input.correlationId);
      return tko_link;
    });
  }

  async listDocumentLinks(tko_tenantId: string, tko_documentId: string): Promise<WorkspaceDocumentLink[]> { return this.tko_read(tko_tenantId, async tko_client => (await tko_client.query("select * from workspace_document_links where tenant_id=$1 and document_id=$2", [tko_tenantId, tko_documentId])).rows.map(this.tko_documentLinkRow)); }
  async listDocumentLinksForEntity(tko_tenantId: string, tko_entityType: WorkspaceEntityType, tko_entityId: string): Promise<WorkspaceDocumentLink[]> { return this.tko_read(tko_tenantId, async tko_client => (await tko_client.query("select * from workspace_document_links where tenant_id=$1 and entity_type=$2 and entity_id=$3 order by created_at desc", [tko_tenantId, tko_entityType, tko_entityId])).rows.map(this.tko_documentLinkRow)); }

  async createForm(tko_actor: PlatformActor, tko_input: Parameters<WorkspaceStore["createForm"]>[1]): Promise<WorkspaceForm> {
    return this.tko_tx(tko_actor.tenantId, async tko_client => {
      const tko_result = await tko_client.query(`insert into workspace_forms(id,tenant_id,name,description,fields_json,target_type,target_config_json,owner_member_id) values($1,$2,$3,$4,$5::jsonb,$6,$7::jsonb,$8) returning *`, [crypto.randomUUID(), tko_actor.tenantId, tko_input.name.trim(), tko_input.description.trim(), JSON.stringify(tko_input.fields), tko_input.targetType, JSON.stringify(tko_input.targetConfig), tko_actor.memberId]);
      const tko_form = this.tko_formRow(tko_result.rows[0]);
      await this.tko_emit(tko_client, tko_actor, "workspace.form_created.v1", "workspace.form", { formId: tko_form.id, targetType: tko_form.targetType }, "workspace.form.created", "workspace_form", tko_form.id, tko_input.correlationId);
      return tko_form;
    });
  }

  async listForms(tko_tenantId: string): Promise<WorkspaceForm[]> { return this.tko_read(tko_tenantId, async tko_client => (await tko_client.query("select * from workspace_forms where tenant_id=$1 order by updated_at desc", [tko_tenantId])).rows.map(this.tko_formRow)); }
  async getForm(tko_tenantId: string, tko_formId: string): Promise<WorkspaceForm | null> { return this.tko_read(tko_tenantId, async tko_client => { const tko_result = await tko_client.query("select * from workspace_forms where tenant_id=$1 and id=$2", [tko_tenantId, tko_formId]); return tko_result.rowCount ? this.tko_formRow(tko_result.rows[0]) : null; }); }
  async activateForm(tko_actor: PlatformActor, tko_input: { formId: string; correlationId: string }): Promise<WorkspaceForm> { return this.tko_tx(tko_actor.tenantId, async tko_client => { const tko_result = await tko_client.query("update workspace_forms set status='active',updated_at=now() where tenant_id=$1 and id=$2 returning *", [tko_actor.tenantId, tko_input.formId]); if (!tko_result.rowCount) throw new Error("WORKSPACE_FORM_NOT_FOUND"); const tko_form = this.tko_formRow(tko_result.rows[0]); await this.tko_emit(tko_client, tko_actor, "workspace.form_activated.v1", "workspace.form", { formId: tko_form.id }, "workspace.form.activated", "workspace_form", tko_form.id, tko_input.correlationId); return tko_form; }); }
  async getFormSubmission(tko_tenantId: string, tko_formId: string, tko_idempotencyKey: string): Promise<WorkspaceFormSubmission | null> { return this.tko_read(tko_tenantId, async tko_client => { const tko_result = await tko_client.query("select * from workspace_form_submissions where tenant_id=$1 and form_id=$2 and idempotency_key=$3", [tko_tenantId, tko_formId, tko_idempotencyKey]); return tko_result.rowCount ? this.tko_submissionRow(tko_result.rows[0]) : null; }); }
  async listFormSubmissions(tko_tenantId: string, tko_formId: string): Promise<WorkspaceFormSubmission[]> { return this.tko_read(tko_tenantId, async tko_client => (await tko_client.query("select * from workspace_form_submissions where tenant_id=$1 and form_id=$2 order by created_at desc", [tko_tenantId, tko_formId])).rows.map(this.tko_submissionRow)); }

  async recordFormSubmission(tko_actor: PlatformActor, tko_input: Parameters<WorkspaceStore["recordFormSubmission"]>[1]): Promise<WorkspaceFormSubmission> { return this.tko_tx(tko_actor.tenantId, async tko_client => { const tko_existing = await tko_client.query("select * from workspace_form_submissions where tenant_id=$1 and form_id=$2 and idempotency_key=$3", [tko_actor.tenantId, tko_input.formId, tko_input.idempotencyKey]); if (tko_existing.rowCount) return this.tko_submissionRow(tko_existing.rows[0]); const tko_result = await tko_client.query(`insert into workspace_form_submissions(id,tenant_id,form_id,submitted_by_member_id,values_json,target_entity_type,target_entity_id,idempotency_key) values($1,$2,$3,$4,$5::jsonb,$6,$7,$8) returning *`, [crypto.randomUUID(), tko_actor.tenantId, tko_input.formId, tko_actor.memberId, JSON.stringify(tko_input.values), tko_input.targetEntityType, tko_input.targetEntityId, tko_input.idempotencyKey]); const tko_submission = this.tko_submissionRow(tko_result.rows[0]); await this.tko_emit(tko_client, tko_actor, "workspace.form_submitted.v1", "workspace.form", { formId: tko_submission.formId, submissionId: tko_submission.id, submittedByMemberId: tko_submission.submittedByMemberId, targetEntityType: tko_submission.targetEntityType, targetEntityId: tko_submission.targetEntityId }, "workspace.form.submitted", "workspace_form_submission", tko_submission.id, tko_input.correlationId); return tko_submission; }); }

  async createAutomationRule(tko_actor: PlatformActor, tko_input: Parameters<WorkspaceStore["createAutomationRule"]>[1]): Promise<WorkspaceAutomationRule> { return this.tko_tx(tko_actor.tenantId, async tko_client => { const tko_result = await tko_client.query(`insert into workspace_automation_rules(id,tenant_id,name,status,trigger_type,condition_json,actions_json,owner_member_id) values($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8) returning *`, [crypto.randomUUID(), tko_actor.tenantId, tko_input.name.trim(), tko_input.status, tko_input.triggerType, JSON.stringify(tko_input.condition), JSON.stringify(tko_input.actions), tko_actor.memberId]); const tko_rule = this.tko_ruleRow(tko_result.rows[0]); await this.tko_emit(tko_client, tko_actor, "workspace.automation_rule_created.v1", "workspace.automation", { ruleId: tko_rule.id, triggerType: tko_rule.triggerType }, "workspace.automation.rule_created", "workspace_automation_rule", tko_rule.id, tko_input.correlationId); return tko_rule; }); }
  async listAutomationRules(tko_tenantId: string, tko_triggerType?: WorkspaceAutomationRule["triggerType"]): Promise<WorkspaceAutomationRule[]> { return this.tko_read(tko_tenantId, async tko_client => { const tko_result = await tko_client.query(`select * from workspace_automation_rules where tenant_id=$1 and status='active' ${tko_triggerType ? "and trigger_type=$2" : ""} order by created_at desc`, tko_triggerType ? [tko_tenantId, tko_triggerType] : [tko_tenantId]); return tko_result.rows.map(this.tko_ruleRow); }); }
  async listAutomationExecutions(tko_tenantId: string, tko_ruleId: string): Promise<WorkspaceAutomationExecution[]> { return this.tko_read(tko_tenantId, async tko_client => (await tko_client.query("select * from workspace_automation_executions where tenant_id=$1 and rule_id=$2 order by created_at desc", [tko_tenantId, tko_ruleId])).rows.map(this.tko_executionRow)); }
  async getAutomationExecution(tko_tenantId: string, tko_ruleId: string, tko_sourceEventId: string, tko_ruleVersion: number): Promise<WorkspaceAutomationExecution | null> { return this.tko_read(tko_tenantId, async tko_client => { const tko_result = await tko_client.query("select * from workspace_automation_executions where tenant_id=$1 and rule_id=$2 and source_event_id=$3 and rule_version=$4", [tko_tenantId, tko_ruleId, tko_sourceEventId, tko_ruleVersion]); return tko_result.rowCount ? this.tko_executionRow(tko_result.rows[0]) : null; }); }
  async recordAutomationExecution(tko_actor: PlatformActor, tko_input: Parameters<WorkspaceStore["recordAutomationExecution"]>[1]): Promise<WorkspaceAutomationExecution> { return this.tko_tx(tko_actor.tenantId, async tko_client => { const tko_existing = await tko_client.query("select * from workspace_automation_executions where tenant_id=$1 and rule_id=$2 and source_event_id=$3 and rule_version=$4", [tko_actor.tenantId, tko_input.ruleId, tko_input.sourceEventId, tko_input.ruleVersion]); if (tko_existing.rowCount) return this.tko_executionRow(tko_existing.rows[0]); const tko_result = await tko_client.query(`insert into workspace_automation_executions(id,tenant_id,rule_id,rule_version,source_event_id,status,results_json,error,completed_at) values($1,$2,$3,$4,$5,$6,$7::jsonb,$8,now()) returning *`, [crypto.randomUUID(), tko_actor.tenantId, tko_input.ruleId, tko_input.ruleVersion, tko_input.sourceEventId, tko_input.status, JSON.stringify(tko_input.results), tko_input.error]); const tko_execution = this.tko_executionRow(tko_result.rows[0]); await this.tko_emit(tko_client, tko_actor, "workspace.automation_executed.v1", "workspace.automation", { executionId: tko_execution.id, ruleId: tko_execution.ruleId, status: tko_execution.status }, "workspace.automation.executed", "workspace_automation_execution", tko_execution.id, tko_input.correlationId); return tko_execution; }); }

  private async tko_read<T>(tko_tenantId: string, tko_operation: (tko_client: PoolClient) => Promise<T>): Promise<T> { const tko_client = await this.tko_pool.connect(); try { await tko_client.query("begin"); await tko_client.query("select set_config('app.tenant_id',$1,true)", [tko_tenantId]); const tko_value = await tko_operation(tko_client); await tko_client.query("commit"); return tko_value; } catch (tko_error) { await tko_client.query("rollback"); throw tko_error; } finally { tko_client.release(); } }
  private async tko_tx<T>(tko_tenantId: string, tko_operation: (tko_client: PoolClient) => Promise<T>): Promise<T> { return this.tko_read(tko_tenantId, tko_operation); }
  private async tko_emit(tko_client: PoolClient, tko_actor: PlatformActor, tko_eventType: string, tko_topic: string, tko_payload: Record<string, unknown>, tko_action: string, tko_resourceType: string, tko_resourceId: string, tko_correlationId: string): Promise<void> { await tko_client.query("insert into audit_logs(id,tenant_id,actor_auth_subject,action,resource_type,resource_id,correlation_id,metadata_json) values(gen_random_uuid(),$1,$2,$3,$4,$5,$6,'{}'::jsonb)", [tko_actor.tenantId, tko_actor.authSubject, tko_action, tko_resourceType, tko_resourceId, tko_correlationId]); await tko_client.query("insert into outbox(id,event_id,tenant_id,topic,event_type,payload_json,actor_auth_subject,correlation_id,status,attempts,available_at) values($1,$2,$3,$4,$5,$6::jsonb,$7,$8,'pending',0,now())", [crypto.randomUUID(), crypto.randomUUID(), tko_actor.tenantId, tko_topic, tko_eventType, JSON.stringify(tko_payload), tko_actor.authSubject, tko_correlationId]); }
  private tko_searchRow = (tko_row: TkoRow): WorkspaceSearchDocument => ({ id: String(tko_row.id), tenantId: String(tko_row.tenant_id), type: "workspace_search_document", entityType: tko_row.entity_type as WorkspaceEntityType, entityId: String(tko_row.entity_id), kind: tko_row.kind as WorkspaceSearchDocument["kind"], title: String(tko_row.title), bodyText: String(tko_row.body_text), href: String(tko_row.href), visibility: tko_row.visibility as WorkspaceSearchDocument["visibility"], explicitMemberIds: tko_json<string[]>(tko_row.explicit_member_ids_json, []), updatedAt: new Date(String(tko_row.updated_at)) });
  private tko_inboxRow = (tko_row: TkoRow): WorkspaceInboxItemResult => ({ id: String(tko_row.id), tenantId: String(tko_row.tenant_id), type: "workspace_inbox_item", memberId: String(tko_row.member_id), kind: tko_row.kind as WorkspaceInboxItemResult["kind"], entityType: tko_row.entity_type as WorkspaceEntityType, entityId: String(tko_row.entity_id), title: String(tko_row.title), body: String(tko_row.body), href: String(tko_row.href), sourceEventId: tko_row.source_event_id ? String(tko_row.source_event_id) : null, readAt: tko_date(tko_row.read_at), archivedAt: tko_date(tko_row.archived_at), createdAt: new Date(String(tko_row.created_at)) });
  private tko_entityLinkRow = (tko_row: TkoRow): WorkspaceEntityLink => ({ id: String(tko_row.id), tenantId: String(tko_row.tenant_id), type: "workspace_entity_link", sourceType: tko_row.source_type as WorkspaceEntityType, sourceId: String(tko_row.source_id), targetType: tko_row.target_type as WorkspaceEntityType, targetId: String(tko_row.target_id), relationType: tko_row.relation_type as WorkspaceEntityLink["relationType"], createdAt: new Date(String(tko_row.created_at)) });
  private tko_documentRow = (tko_row: TkoRow): WorkspaceDocument => ({ id: String(tko_row.id), tenantId: String(tko_row.tenant_id), type: "workspace_document", title: String(tko_row.title), documentKind: (tko_row.document_kind === "file" ? "file" : "note"), projectId: tko_row.project_id ? String(tko_row.project_id) : null, objectKey: tko_row.object_key ? String(tko_row.object_key) : null, filename: tko_row.filename ? String(tko_row.filename) : null, contentType: tko_row.content_type ? String(tko_row.content_type) : null, byteSize: tko_row.byte_size === null || tko_row.byte_size === undefined ? null : Number(tko_row.byte_size), content: tko_json<Record<string, unknown>>(tko_row.content_json, {}), bodyText: String(tko_row.body_text), ownerMemberId: String(tko_row.owner_member_id), visibility: tko_row.visibility as WorkspaceDocument["visibility"], templateKey: tko_row.template_key ? String(tko_row.template_key) : null, createdAt: new Date(String(tko_row.created_at)), updatedAt: new Date(String(tko_row.updated_at)) });
  private tko_documentLinkRow = (tko_row: TkoRow): WorkspaceDocumentLink => ({ id: String(tko_row.id), tenantId: String(tko_row.tenant_id), type: "workspace_document_link", documentId: String(tko_row.document_id), entityType: tko_row.entity_type as WorkspaceEntityType, entityId: String(tko_row.entity_id), createdAt: new Date(String(tko_row.created_at)) });
  private tko_formRow = (tko_row: TkoRow): WorkspaceForm => ({ id: String(tko_row.id), tenantId: String(tko_row.tenant_id), type: "workspace_form", name: String(tko_row.name), description: String(tko_row.description), status: tko_row.status as WorkspaceForm["status"], accessMode: "internal", fields: tko_json<WorkspaceForm["fields"]>(tko_row.fields_json, []), targetType: tko_row.target_type as WorkspaceForm["targetType"], targetConfig: tko_json<Record<string, unknown>>(tko_row.target_config_json, {}), ownerMemberId: String(tko_row.owner_member_id), createdAt: new Date(String(tko_row.created_at)), updatedAt: new Date(String(tko_row.updated_at)) });
  private tko_submissionRow = (tko_row: TkoRow): WorkspaceFormSubmission => ({ id: String(tko_row.id), tenantId: String(tko_row.tenant_id), type: "workspace_form_submission", formId: String(tko_row.form_id), submittedByMemberId: String(tko_row.submitted_by_member_id), values: tko_json<Record<string, unknown>>(tko_row.values_json, {}), targetEntityType: tko_row.target_entity_type as WorkspaceEntityType, targetEntityId: String(tko_row.target_entity_id), idempotencyKey: String(tko_row.idempotency_key), createdAt: new Date(String(tko_row.created_at)) });
  private tko_ruleRow = (tko_row: TkoRow): WorkspaceAutomationRule => ({ id: String(tko_row.id), tenantId: String(tko_row.tenant_id), type: "workspace_automation_rule", name: String(tko_row.name), status: tko_row.status as WorkspaceAutomationRule["status"], triggerType: tko_row.trigger_type as WorkspaceAutomationRule["triggerType"], condition: tko_json<Record<string, unknown>>(tko_row.condition_json, {}), actions: tko_json<WorkspaceAutomationRule["actions"]>(tko_row.actions_json, []), ownerMemberId: String(tko_row.owner_member_id), version: Number(tko_row.version), createdAt: new Date(String(tko_row.created_at)), updatedAt: new Date(String(tko_row.updated_at)) });
  private tko_executionRow = (tko_row: TkoRow): WorkspaceAutomationExecution => ({ id: String(tko_row.id), tenantId: String(tko_row.tenant_id), type: "workspace_automation_execution", ruleId: String(tko_row.rule_id), ruleVersion: Number(tko_row.rule_version), sourceEventId: String(tko_row.source_event_id), status: tko_row.status as WorkspaceAutomationExecution["status"], results: tko_json<Record<string, unknown>>(tko_row.results_json, {}), error: tko_row.error ? String(tko_row.error) : null, createdAt: new Date(String(tko_row.created_at)), completedAt: tko_date(tko_row.completed_at) });
}
