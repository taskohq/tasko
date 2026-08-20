import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { describe, expect, it } from "vitest";
import type { PlatformActor } from "../../packages/contracts/src/platform";
import { PostgresWorkspaceStore } from "../../packages/database/src/postgres-workspace-store";

const tko_postgresUrl = process.env.TASKO_POSTGRES_URL;
const tko_describe = tko_postgresUrl && process.env.TASKO_RUN_POSTGRES_INTEGRATION_TESTS === "1" ? describe : describe.skip;

async function tko_cleanup(tko_pool: Pool, tko_tenantId: string, tko_userId: string): Promise<void> {
  for (const tko_table of ["workspace_document_links", "workspace_form_submissions", "workspace_automation_executions", "workspace_automation_rules", "workspace_forms", "workspace_entity_links", "workspace_inbox_items", "workspace_search_documents", "workspace_documents", "outbox", "audit_logs", "tenant_members"]) {
    await tko_pool.query(`delete from ${tko_table} where tenant_id=$1`, [tko_tenantId]);
  }
  await tko_pool.query("delete from tenants where id=$1", [tko_tenantId]);
  await tko_pool.query("delete from users where id=$1", [tko_userId]);
}

tko_describe("Unified Workspace Beta M4 on PostgreSQL", () => {
  it("persists document context, Inbox state and an idempotent automation execution with audit/outbox", async () => {
    const tko_pool = new Pool({ connectionString: tko_postgresUrl });
    const tko_store = new PostgresWorkspaceStore(tko_postgresUrl!);
    const tko_tenantId = randomUUID();
    const tko_userId = randomUUID();
    const tko_actor: PlatformActor = { authSubject: `postgres-workspace-test:${tko_tenantId}`, tenantId: tko_tenantId, tenantSlug: `postgres-workspace-${tko_tenantId.slice(0, 8)}`, memberId: randomUUID(), role: "owner", membershipStatus: "active", correlationId: `postgres-workspace:${tko_tenantId}` };

    try {
      await tko_pool.query("insert into tenants (id,slug,name,status,deployment_profile) values ($1,$2,$3,'active','single_tenant')", [tko_tenantId, tko_actor.tenantSlug, "PostgreSQL Workspace Acceptance"]);
      await tko_pool.query("insert into users (id,auth_subject,status) values ($1,$2,'active')", [tko_userId, tko_actor.authSubject]);
      await tko_pool.query("insert into tenant_members (id,tenant_id,user_id,role,status,display_name) values ($1,$2,$3,'owner','active','PostgreSQL Workspace Owner')", [tko_actor.memberId, tko_tenantId, tko_userId]);

      const tko_document = await tko_store.createDocument(tko_actor, { title: "Delivery decision", bodyText: "Capture scope and ownership.", content: {}, visibility: "internal", templateKey: "operating-note", correlationId: tko_actor.correlationId });
      const tko_link = await tko_store.linkDocument(tko_actor, { documentId: tko_document.id, entityType: "document", entityId: tko_document.id, correlationId: `${tko_actor.correlationId}:link` });
      const tko_inboxEventId = randomUUID();
      const tko_executionEventId = randomUUID();
      const tko_inbox = await tko_store.createInboxItem(tko_actor, { memberId: tko_actor.memberId, kind: "system", entityType: "document", entityId: tko_document.id, title: "Review delivery decision", body: "Document context is ready.", href: `/docs/${tko_document.id}`, sourceEventId: tko_inboxEventId, correlationId: `${tko_actor.correlationId}:inbox` });
      const tko_readInbox = await tko_store.setInboxState(tko_actor, { inboxItemId: tko_inbox.id, state: "read", correlationId: `${tko_actor.correlationId}:inbox-read` });
      const tko_rule = await tko_store.createAutomationRule(tko_actor, { name: "Create handoff triage", status: "active", triggerType: "crm.lead_created.v1", condition: {}, actions: [{ type: "create_work_item", config: { projectId: randomUUID(), title: "Triage {{leadId}}" } }], correlationId: `${tko_actor.correlationId}:rule` });
      const tko_firstExecution = await tko_store.recordAutomationExecution(tko_actor, { ruleId: tko_rule.id, ruleVersion: tko_rule.version, sourceEventId: tko_executionEventId, status: "completed", results: { createdWorkItemId: randomUUID() }, error: null, correlationId: `${tko_actor.correlationId}:run` });
      const tko_secondExecution = await tko_store.recordAutomationExecution(tko_actor, { ruleId: tko_rule.id, ruleVersion: tko_rule.version, sourceEventId: tko_executionEventId, status: "completed", results: { ignored: true }, error: null, correlationId: `${tko_actor.correlationId}:run-retry` });
      const tko_durable = await tko_pool.query("select (select count(*) from workspace_document_links where tenant_id=$1) as links, (select count(*) from workspace_automation_executions where tenant_id=$1) as executions, (select count(*) from audit_logs where tenant_id=$1) as audits, (select count(*) from outbox where tenant_id=$1) as events", [tko_tenantId]);

      expect(await tko_store.listDocumentLinksForEntity(tko_tenantId, "document", tko_document.id)).toEqual([expect.objectContaining({ id: tko_link.id, documentId: tko_document.id })]);
      expect(tko_readInbox.readAt).toBeInstanceOf(Date);
      expect(tko_secondExecution.id).toBe(tko_firstExecution.id);
      expect(await tko_store.listAutomationExecutions(tko_tenantId, tko_rule.id)).toHaveLength(1);
      expect(tko_durable.rows[0]).toMatchObject({ links: "1", executions: "1", audits: "6", events: "6" });
    } finally {
      await tko_cleanup(tko_pool, tko_tenantId, tko_userId);
      await tko_store.close();
      await tko_pool.end();
    }
  });

  it("persists tenant-scoped Form submission history idempotently with audit and outbox", async () => {
    const tko_pool = new Pool({ connectionString: tko_postgresUrl });
    const tko_store = new PostgresWorkspaceStore(tko_postgresUrl!);
    const tko_tenantId = randomUUID();
    const tko_userId = randomUUID();
    const tko_actor: PlatformActor = { authSubject: `postgres-workspace-form:${tko_tenantId}`, tenantId: tko_tenantId, tenantSlug: `postgres-form-${tko_tenantId.slice(0, 8)}`, memberId: randomUUID(), role: "owner", membershipStatus: "active", correlationId: `postgres-workspace-form:${tko_tenantId}` };

    try {
      await tko_pool.query("insert into tenants (id,slug,name,status,deployment_profile) values ($1,$2,$3,'active','single_tenant')", [tko_tenantId, tko_actor.tenantSlug, "PostgreSQL Form Acceptance"]);
      await tko_pool.query("insert into users (id,auth_subject,status) values ($1,$2,'active')", [tko_userId, tko_actor.authSubject]);
      await tko_pool.query("insert into tenant_members (id,tenant_id,user_id,role,status,display_name) values ($1,$2,$3,'owner','active','PostgreSQL Form Owner')", [tko_actor.memberId, tko_tenantId, tko_userId]);

      const tko_form = await tko_store.createForm(tko_actor, { name: "PostgreSQL intake", description: "Durable submissions", fields: [{ id: "title", label: "Title", fieldType: "text", required: true }], targetType: "work_item", targetConfig: { projectId: randomUUID() }, correlationId: `${tko_actor.correlationId}:create` });
      await tko_store.activateForm(tko_actor, { formId: tko_form.id, correlationId: `${tko_actor.correlationId}:activate` });
      const tko_submissionInput = { formId: tko_form.id, values: { title: "Persisted intake" }, targetEntityType: "work_item" as const, targetEntityId: randomUUID(), idempotencyKey: randomUUID(), correlationId: `${tko_actor.correlationId}:submit` };
      const tko_first = await tko_store.recordFormSubmission(tko_actor, tko_submissionInput);
      const tko_second = await tko_store.recordFormSubmission(tko_actor, { ...tko_submissionInput, targetEntityId: randomUUID(), correlationId: `${tko_actor.correlationId}:retry` });
      const tko_durable = await tko_pool.query("select count(*) from workspace_form_submissions where tenant_id=$1 and form_id=$2", [tko_tenantId, tko_form.id]);

      expect(tko_second.id).toBe(tko_first.id);
      expect(await tko_store.listFormSubmissions(tko_tenantId, tko_form.id)).toEqual([expect.objectContaining({ id: tko_first.id, targetEntityId: tko_submissionInput.targetEntityId })]);
      expect(await tko_store.listFormSubmissions(randomUUID(), tko_form.id)).toEqual([]);
      expect(tko_durable.rows[0]?.count).toBe("1");
      expect((await tko_pool.query("select action from audit_logs where tenant_id=$1", [tko_tenantId])).rows.map(tko_row => tko_row.action)).toEqual(expect.arrayContaining(["workspace.form.created", "workspace.form.activated", "workspace.form.submitted"]));
    } finally {
      await tko_cleanup(tko_pool, tko_tenantId, tko_userId);
      await tko_store.close();
      await tko_pool.end();
    }
  });
});
