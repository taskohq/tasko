import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { tko_config } from "../../packages/config/src/tasko-config";
import type { PlatformActor } from "../../packages/contracts/src/platform";
import { PostgresCRMStore } from "../../packages/database/src/postgres-crm-store";
import { processOutboxOnce } from "../worker/src/worker-service";
import { registerCRMHandoffWorker } from "./src/crm-handoff-worker";
import * as crm from "./src/crm-service";

const tko_postgresUrl = process.env.TASKO_POSTGRES_URL;
const tko_describe = tko_postgresUrl && process.env.TASKO_RUN_POSTGRES_INTEGRATION_TESTS === "1" ? describe : describe.skip;

async function tko_cleanupTenant(tko_pool: Pool, tko_tenantId: string, tko_userIds: string[]): Promise<void> {
  for (const tko_table of ["crm_deal_handoffs", "crm_entity_links", "message_reactions", "saved_messages", "messages", "channel_members", "channels", "custom_field_values", "sprint_items", "work_item_assignees", "work_item_labels", "work_item_relations", "work_comments", "work_item_history", "work_items", "sprints", "custom_field_definitions", "saved_views", "work_types", "projects", "workflow_transitions", "workflow_statuses", "workflows", "work_labels", "spaces", "crm_activities", "crm_leads", "crm_deals", "crm_pipeline_stages", "crm_pipelines", "crm_contacts", "crm_companies", "outbox", "audit_logs", "tenant_members"]) {
    await tko_pool.query(`delete from ${tko_table} where tenant_id=$1`, [tko_tenantId]);
  }
  await tko_pool.query("delete from tenants where id=$1", [tko_tenantId]);
  await tko_pool.query("delete from users where id = any($1::uuid[])", [tko_userIds]);
}

tko_describe("Slim CRM Alpha M3 on PostgreSQL", () => {
  it("persists an idempotent lead conversion with audit and transactional outbox", async () => {
    const tko_pool = new Pool({ connectionString: tko_postgresUrl });
    const tko_store = new PostgresCRMStore(tko_postgresUrl!);
    const tko_tenantId = randomUUID();
    const tko_userId = randomUUID();
    const tko_memberId = randomUUID();
    const tko_serviceMemberId = randomUUID();
    const tko_actor: PlatformActor = { authSubject: `postgres-crm-test:${tko_tenantId}`, tenantId: tko_tenantId, tenantSlug: `postgres-crm-${tko_tenantId.slice(0, 8)}`, memberId: tko_memberId, role: "owner", membershipStatus: "active", correlationId: `postgres-crm-${tko_tenantId}` };

    try {
      await tko_pool.query("insert into tenants (id,slug,name,status,deployment_profile) values ($1,$2,$3,'active','single_tenant')", [tko_tenantId, tko_actor.tenantSlug, "PostgreSQL CRM Acceptance"]);
      await tko_pool.query("insert into users (id,auth_subject,status) values ($1,$2,'active')", [tko_userId, tko_actor.authSubject]);
      const tko_serviceUser = await tko_pool.query("insert into users (id,auth_subject,status) values ($1,$2,'active') on conflict (auth_subject) do update set auth_subject=excluded.auth_subject returning id", [randomUUID(), tko_config.workerServiceAuthSubject]);
      const tko_serviceUserId = tko_serviceUser.rows[0].id as string;
      await tko_pool.query("insert into tenant_members (id,tenant_id,user_id,role,status,display_name) values ($1,$2,$3,'owner','active','PostgreSQL CRM Owner')", [tko_memberId, tko_tenantId, tko_userId]);
      await tko_pool.query("insert into tenant_members (id,tenant_id,user_id,role,status,display_name) values ($1,$2,$3,'service_account','active','PostgreSQL CRM Worker')", [tko_serviceMemberId, tko_tenantId, tko_serviceUserId]);

      const tko_pipeline = await tko_store.createPipeline(tko_actor, { name: "Sales", correlationId: tko_actor.correlationId });
      const tko_lead = await tko_store.createLead({ actor: tko_actor, firstName: "Ada", lastName: "Lovelace", companyName: "Analytical Engines", email: "ada@example.test", status: "qualified", correlationId: tko_actor.correlationId });
      const tko_input = { actor: tko_actor, leadId: tko_lead.id, conversionKey: `conversion:${tko_lead.id}`, createDeal: true, pipelineId: tko_pipeline.pipeline.id, stageId: tko_pipeline.stages[0].id, dealName: "Analytical Engines delivery", correlationId: tko_actor.correlationId };
      const tko_first = await tko_store.convertLead(tko_input);
      const tko_second = await tko_store.convertLead(tko_input);
      const tko_durableEffects = await tko_pool.query("select (select count(*) from crm_companies where tenant_id=$1) as companies, (select count(*) from crm_contacts where tenant_id=$1) as contacts, (select count(*) from crm_deals where tenant_id=$1) as deals, (select count(*) from audit_logs where tenant_id=$1 and action='crm.lead.converted') as audits, (select count(*) from outbox where tenant_id=$1 and event_type='crm.lead_converted.v1') as events", [tko_tenantId]);

      expect(tko_first).toMatchObject({ idempotent: false, lead: { status: "converted" }, company: { name: "Analytical Engines" }, deal: { name: "Analytical Engines delivery" } });
      expect(tko_second).toMatchObject({ idempotent: true, lead: { id: tko_first.lead.id }, deal: { id: tko_first.deal?.id } });
      expect(tko_durableEffects.rows[0]).toMatchObject({ companies: "1", contacts: "1", deals: "1", audits: "1", events: "1" });

      const tko_wonStage = tko_pipeline.stages.find(tko_stage => tko_stage.category === "won");
      expect(tko_wonStage).toBeDefined();
      await crm.moveDeal(tko_actor, { dealId: tko_first.deal!.id, stageId: tko_wonStage!.id, correlationId: `${tko_actor.correlationId}:won` });
      registerCRMHandoffWorker();
      await processOutboxOnce(100);
      await processOutboxOnce(100);
      const tko_handoff = await tko_pool.query(`
        select h.status, h.delivery_project_id, h.delivery_channel_id,
          (select count(*) from projects p where p.tenant_id=h.tenant_id and p.id=h.delivery_project_id) as project_exists,
          (select count(*) from channels c where c.tenant_id=h.tenant_id and c.id=h.delivery_channel_id) as channel_exists,
          (select count(*) from crm_entity_links l where l.tenant_id=h.tenant_id and l.source_type='deal' and l.source_id=h.deal_id and l.relation_type in ('delivery_project','delivery_channel')) as links
        from crm_deal_handoffs h where h.tenant_id=$1 and h.deal_id=$2
      `, [tko_tenantId, tko_first.deal!.id]);
      const tko_handoffOutbox = await tko_pool.query("select count(*) from outbox where tenant_id=$1 and event_type='crm.deal_won.v1' and status='processed'", [tko_tenantId]);
      const tko_detail = await crm.dealDetails(tko_actor, tko_first.deal!.id);

      expect(tko_handoff.rows[0]).toMatchObject({ status: "completed", delivery_project_id: expect.any(String), delivery_channel_id: expect.any(String), project_exists: "1", channel_exists: "1", links: "2" });
      expect(tko_handoffOutbox.rows[0].count).toBe("1");
      expect(tko_detail).toMatchObject({ deal: { id: tko_first.deal!.id, tenantId: tko_tenantId }, handoff: { status: "completed" }, deliveryProject: { name: "Delivery — Analytical Engines delivery" }, deliveryChannel: { name: expect.stringMatching(/^delivery-/) } });
    } finally {
      await tko_cleanupTenant(tko_pool, tko_tenantId, [tko_userId]);
      await tko_store.close();
      await tko_pool.end();
    }
  });

  it("materializes the controlled-pilot delivery handoff within the seeded tenant", async () => {
    const tko_pool = new Pool({ connectionString: tko_postgresUrl });
    try {
      const tko_seedHandoff = await tko_pool.query(`
        select h.status,
          (select count(*) from projects p where p.tenant_id=h.tenant_id and p.id=h.delivery_project_id and p.key='NORTHSTAR') as project_exists,
          (select count(*) from channels c where c.tenant_id=h.tenant_id and c.id=h.delivery_channel_id and c.name='northstar-delivery') as channel_exists,
          (select count(*) from crm_entity_links l where l.tenant_id=h.tenant_id and l.source_type='deal' and l.source_id=h.deal_id and l.relation_type in ('delivery_project','delivery_channel')) as links
        from crm_deal_handoffs h
        join tenants t on t.id=h.tenant_id
        join crm_deals d on d.id=h.deal_id and d.tenant_id=h.tenant_id
        where t.slug='tasko-demo' and d.name='Northstar delivery pilot'
        limit 1
      `);

      expect(tko_seedHandoff.rows).toHaveLength(1);
      expect(tko_seedHandoff.rows[0]).toMatchObject({ status: "completed", project_exists: "1", channel_exists: "1", links: "2" });
    } finally {
      await tko_pool.end();
    }
  });
});
