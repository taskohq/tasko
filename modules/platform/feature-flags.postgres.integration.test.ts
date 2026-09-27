import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { describe, expect, it } from "vitest";
import type { PlatformActor } from "../../packages/contracts/src/platform";
import { MemoryFeatureFlagStore, PostgresFeatureFlagStore } from "../../packages/database/src/flag-store";
import { MemoryPlatformStore, setPlatformStoreForTests } from "../../packages/database/src/platform-store";

const tko_postgresUrl = process.env.TASKO_POSTGRES_URL;
const tko_describe = tko_postgresUrl && process.env.TASKO_RUN_POSTGRES_INTEGRATION_TESTS === "1" ? describe : describe.skip;

/** Memory/postgres store twins must behave identically (rule 4). Runs only when a PostgreSQL
 * instance is explicitly provided via TASKO_POSTGRES_URL + TASKO_RUN_POSTGRES_INTEGRATION_TESTS=1. */
tko_describe("Tenant feature-flag store twins", () => {
  it("persists tenant overrides, audits and re-reads them exactly like the memory twin", async () => {
    const tko_pool = new Pool({ connectionString: tko_postgresUrl });
    const tko_tenantId = randomUUID();
    const tko_actor: PlatformActor = { authSubject: `postgres-flags-test:${tko_tenantId}`, tenantId: tko_tenantId, tenantSlug: `postgres-flags-${tko_tenantId.slice(0, 8)}`, memberId: randomUUID(), role: "owner", membershipStatus: "active", correlationId: `postgres-flags-${tko_tenantId}` };
    const tko_postgres = new PostgresFeatureFlagStore(tko_postgresUrl!);
    const tko_memory = new MemoryFeatureFlagStore();
    const tko_memoryPlatform = new MemoryPlatformStore();
    setPlatformStoreForTests(tko_memoryPlatform);
    await tko_pool.query("insert into tenants (id,slug,name,status,deployment_profile) values ($1,$2,$3,'active','single_tenant')", [tko_tenantId, tko_actor.tenantSlug, "PostgreSQL Feature Flags Acceptance"]);
    try {
      await tko_memory.setTenantFlagOverride(tko_actor, { flagKey: "publicForms", enabled: false, correlationId: "twin-memory" });
      await tko_postgres.setTenantFlagOverride(tko_actor, { flagKey: "publicForms", enabled: false, correlationId: "twin-postgres" });
      expect(await tko_memory.listTenantFlagOverrides(tko_tenantId)).toEqual(await tko_postgres.listTenantFlagOverrides(tko_tenantId));
      expect(await tko_postgres.listTenantFlagOverrides(tko_tenantId)).toEqual({ publicForms: false });
      await tko_postgres.setTenantFlagOverride(tko_actor, { flagKey: "publicForms", enabled: true, correlationId: "twin-postgres-2" });
      const tko_rows = await tko_postgres.listTenantFlagOverrideRows(tko_tenantId);
      expect(tko_rows).toHaveLength(1);
      expect(tko_rows[0]).toMatchObject({ flagKey: "publicForms", enabled: true, setByAuthSubject: tko_actor.authSubject });
      expect((await tko_memoryPlatform.listAuditLogs()).some(tko_row => tko_row.action === "platform.feature_flag.set")).toBe(true);
      const tko_durable = await tko_pool.query("select count(*)::int as audits, (select count(*)::int from outbox where tenant_id=$1 and event_type='platform.feature_flag_set.v1') as events from audit_logs where tenant_id=$1 and action='platform.feature_flag.set'", [tko_tenantId]);
      expect(tko_durable.rows[0]).toMatchObject({ audits: 2, events: 2 });
      // The persisted override must flip the shared service resolution for this tenant.
      const { isFeatureEnabled } = await import("../../modules/platform/src/feature-flags");
      expect(await isFeatureEnabled(tko_tenantId, "publicForms")).toBe(true);
    } finally {
      await tko_pool.query("delete from tenant_feature_flags where tenant_id=$1", [tko_tenantId]);
      await tko_pool.query("delete from audit_logs where tenant_id=$1", [tko_tenantId]);
      await tko_pool.query("delete from outbox where tenant_id=$1", [tko_tenantId]);
      await tko_pool.query("delete from tenants where id=$1", [tko_tenantId]);
      await tko_pool.end();
      setPlatformStoreForTests(null);
    }
  });
});
