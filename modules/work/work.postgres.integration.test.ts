import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { PostgresWorkStore } from "../../packages/database/src/postgres-work-store";
import type { PlatformActor } from "../../packages/contracts/src/platform";

const tko_postgresUrl = process.env.TASKO_POSTGRES_URL;
const tko_describe = tko_postgresUrl && process.env.TASKO_RUN_POSTGRES_INTEGRATION_TESTS === "1" ? describe : describe.skip;

async function tko_cleanupTenant(tko_pool: Pool, tko_tenantId: string, tko_userId: string): Promise<void> {
  for (const tko_table of [
    "work_item_assignees",
    "work_item_labels",
    "work_item_history",
    "work_item_relations",
    "work_comments",
    "custom_field_values",
    "custom_field_definitions",
    "sprint_items",
    "work_items",
    "sprints",
    "work_labels",
    "workflow_transitions",
    "workflow_statuses",
    "work_types",
    "saved_views",
    "projects",
    "workflows",
    "spaces",
    "outbox",
    "audit_logs",
    "tenant_members",
  ]) {
    await tko_pool.query(`delete from ${tko_table} where tenant_id=$1`, [tko_tenantId]);
  }
  await tko_pool.query("delete from tenants where id=$1", [tko_tenantId]);
  await tko_pool.query("delete from users where id=$1", [tko_userId]);
}

tko_describe("Work Sprint planning on PostgreSQL", () => {
  it("carries unfinished work into the selected next sprint with tenant-scoped audit and outbox effects", async () => {
    const tko_pool = new Pool({ connectionString: tko_postgresUrl });
    const tko_store = new PostgresWorkStore(tko_postgresUrl!);
    const tko_tenantId = randomUUID();
    const tko_userId = randomUUID();
    const tko_memberId = randomUUID();
    const tko_actor: PlatformActor = {
      authSubject: `postgres-sprint-test:${tko_tenantId}`,
      tenantId: tko_tenantId,
      tenantSlug: `postgres-sprint-${tko_tenantId.slice(0, 8)}`,
      memberId: tko_memberId,
      role: "owner",
      membershipStatus: "active",
      correlationId: `postgres-sprint-${tko_tenantId}`,
    };

    try {
      await tko_pool.query("insert into tenants (id,slug,name,status,deployment_profile) values ($1,$2,$3,'active','single_tenant')", [tko_tenantId, tko_actor.tenantSlug, "PostgreSQL Sprint Acceptance"]);
      await tko_pool.query("insert into users (id,auth_subject,status) values ($1,$2,'active')", [tko_userId, tko_actor.authSubject]);
      await tko_pool.query("insert into tenant_members (id,tenant_id,user_id,role,status,display_name) values ($1,$2,$3,'owner','active','PostgreSQL Sprint Owner')", [tko_memberId, tko_tenantId, tko_userId]);

      const tko_space = await tko_store.createSpace(tko_actor, { name: "Product", slug: `product-${tko_tenantId.slice(0, 6)}`, visibility: "internal", correlationId: tko_actor.correlationId });
      const tko_project = await tko_store.createProject({ actor: tko_actor, spaceId: tko_space.id, name: "Sprint Delivery", key: `S${tko_tenantId.replaceAll("-", "").slice(0, 7)}`, methodology: "scrum", visibility: "internal", correlationId: tko_actor.correlationId });
      const tko_doneItem = await tko_store.createWorkItem({ actor: tko_actor, projectId: tko_project.id, title: "Completed", correlationId: tko_actor.correlationId });
      const tko_openItem = await tko_store.createWorkItem({ actor: tko_actor, projectId: tko_project.id, title: "Carry over", correlationId: tko_actor.correlationId });
      const tko_doneStatus = (await tko_store.listStatuses(tko_tenantId, tko_project.workflowId)).find(tko_status => tko_status.category === "done");
      if (!tko_doneStatus) throw new Error("TEST_DONE_STATUS_MISSING");
      await tko_store.transitionWorkItem({ actor: tko_actor, workItemId: tko_doneItem.id, targetStatusId: tko_doneStatus.id, expectedVersion: tko_doneItem.version, correlationId: tko_actor.correlationId });

      const tko_current = await tko_store.createSprint({ actor: tko_actor, projectId: tko_project.id, name: "Sprint current", correlationId: tko_actor.correlationId });
      const tko_next = await tko_store.createSprint({ actor: tko_actor, projectId: tko_project.id, name: "Sprint next", correlationId: tko_actor.correlationId });
      await tko_store.addItemsToSprint(tko_actor, { sprintId: tko_current.id, workItemIds: [tko_doneItem.id, tko_openItem.id], correlationId: tko_actor.correlationId });
      await tko_store.completeSprint(tko_actor, { sprintId: tko_current.id, incompleteDisposition: "next_sprint", nextSprintId: tko_next.id, correlationId: tko_actor.correlationId });

      const tko_items = await tko_pool.query("select id,sprint_id from work_items where tenant_id=$1 and id=any($2::uuid[])", [tko_tenantId, [tko_doneItem.id, tko_openItem.id]]);
      const tko_sprintByWorkItem = new Map(tko_items.rows.map(tko_row => [String(tko_row.id), String(tko_row.sprint_id)]));
      const tko_effects = await tko_pool.query(
        "select (select count(*) from audit_logs where tenant_id=$1 and action='work.sprint.completed' and metadata_json->>'nextSprintId'=$2) as audits, (select count(*) from outbox where tenant_id=$1 and event_type='work.sprint_completed.v1' and payload_json->>'nextSprintId'=$2) as events",
        [tko_tenantId, tko_next.id],
      );

      expect(tko_sprintByWorkItem.get(tko_doneItem.id)).toBe(tko_current.id);
      expect(tko_sprintByWorkItem.get(tko_openItem.id)).toBe(tko_next.id);
      expect(tko_effects.rows[0]).toMatchObject({ audits: "1", events: "1" });
    } finally {
      await tko_cleanupTenant(tko_pool, tko_tenantId, tko_userId);
      await tko_pool.end();
    }
  });
});
