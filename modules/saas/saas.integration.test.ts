import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PlatformActor } from "../../packages/contracts/src/platform";
import { tko_config } from "../../packages/config/src/tasko-config";
import { MemoryPlatformStore, setPlatformStoreForTests } from "../../packages/database/src/platform-store";
import { MemorySaaSStore, setSaaSStoreForTests } from "../../packages/database/src/saas-store";
import { createInMemoryRedisAdapter, setRedisAdapterForTests } from "../../packages/redis/src/redis-adapter";
import { SaaSService } from "./src/saas-service";

const tko_adminSubject = tko_config.platformAdminSubjects[0] || "owner-a";
function tko_actor(tko_overrides: Partial<PlatformActor> = {}): PlatformActor {
  return { authSubject: tko_adminSubject, tenantId: "tko-tenant-tasko-demo", tenantSlug: "tasko-demo", memberId: "tko-member-tasko-demo-owner", role: "owner", membershipStatus: "active", correlationId: "saas-test", ...tko_overrides };
}

describe("Tasko M5 SaaS readiness", () => {
  let tko_platform: MemoryPlatformStore;
  let tko_saas: SaaSService;
  let tko_previousProfile: "single_tenant" | "saas";
  beforeEach(async () => { const tko_runtimeConfig = tko_config as unknown as { deploymentProfile: "single_tenant" | "saas" }; tko_previousProfile = tko_runtimeConfig.deploymentProfile; tko_runtimeConfig.deploymentProfile = "saas"; tko_platform = new MemoryPlatformStore(); setPlatformStoreForTests(tko_platform); setSaaSStoreForTests(new MemorySaaSStore()); setRedisAdapterForTests(createInMemoryRedisAdapter()); await tko_platform.seedDemoWorkspace({ ownerAuthSubject: tko_adminSubject, tenantSlug: "tasko-demo" }); tko_saas = new SaaSService(); });
  afterEach(() => { const tko_runtimeConfig = tko_config as unknown as { deploymentProfile: "single_tenant" | "saas" }; tko_runtimeConfig.deploymentProfile = tko_previousProfile; setPlatformStoreForTests(null); setSaaSStoreForTests(null); setRedisAdapterForTests(null); });

  it("provisions a tenant idempotently with owner bootstrap and starter entitlement", async () => {
    const tko_input = { slug: "northstar", name: "Northstar", ownerAuthSubject: "northstar-owner", idempotencyKey: "provision-northstar", correlationId: "provision-test" };
    const tko_first = await tko_saas.provision(tko_adminSubject, tko_input); const tko_second = await tko_saas.provision(tko_adminSubject, tko_input);
    expect(tko_first.created).toBe(true); expect(tko_second.created).toBe(false); expect(tko_first.tenant.id).toBe(tko_second.tenant.id); expect(tko_first.entitlement.planKey).toBe("starter"); expect((await tko_platform.listMemberships("northstar-owner"))[0]?.role).toBe("owner");
  });

  it("denies non-platform admins, writes lifecycle audit/outbox, and does not trust tenant actor for admin actions", async () => {
    await expect(tko_saas.provision("not-platform-admin", { slug: "denied", name: "Denied", ownerAuthSubject: "denied-owner", idempotencyKey: "denied", correlationId: "denied" })).rejects.toThrow("TASKO_PLATFORM_ADMIN_REQUIRED");
    await expect(tko_saas.operations("not-platform-admin")).rejects.toThrow("TASKO_PLATFORM_ADMIN_REQUIRED");
    await expect(tko_saas.exportTenantManifest("not-platform-admin", "tko-tenant-tasko-demo", "denied-export")).rejects.toThrow("TASKO_PLATFORM_ADMIN_REQUIRED");
    const tko_created = await tko_saas.provision(tko_adminSubject, { slug: "suspend-me", name: "Suspend Me", ownerAuthSubject: "suspend-owner", idempotencyKey: "suspend", correlationId: "suspend" });
    const tko_suspended = await tko_saas.lifecycle(tko_adminSubject, tko_created.tenant.id, "suspended", "suspend-lifecycle");
    expect(tko_suspended.status).toBe("suspended"); expect((await tko_platform.listAuditLogs()).some(tko_row => tko_row.action.includes("lifecycle"))).toBe(true); expect((await tko_platform.reserveOutbox(20)).some(tko_row => tko_row.eventType === "tenant.suspended.v1")).toBe(true);
  });

  it("enforces quota decisions with idempotent usage and keeps backup/restore tenant-scoped", async () => {
    const tko_owner = tko_actor(); const tko_first = await tko_saas.consumeUsage(tko_owner, { metric: "automation_executions", amount: 2, idempotencyKey: "usage-1", correlationId: "usage-1", feature: "automation" }); const tko_replay = await tko_saas.consumeUsage(tko_owner, { metric: "automation_executions", amount: 2, idempotencyKey: "usage-1", correlationId: "usage-1", feature: "automation" });
    expect(tko_first.current).toBe(2); expect(tko_replay.current).toBe(2);
    const tko_backup = await tko_saas.backup(tko_owner, { schemaVersion: "0008", checksum: "sha256:controlled-pilot", objectKey: null, resourceCounts: { work_items: 2, crm_deals: 1 }, correlationId: "backup-1" }); const tko_drill = await tko_saas.restoreDrill(tko_owner, { backupManifestId: tko_backup.id, validation: { checksum: true, tenantScope: true }, correlationId: "restore-1" });
    expect(tko_drill.status).toBe("verified"); expect((await tko_saas.backups(tko_owner)).map(tko_manifest => tko_manifest.id)).toEqual([tko_backup.id]); await expect(tko_saas.backups(tko_actor({ role: "guest", memberId: "guest" }))).rejects.toThrow("TASKO_AUTHORIZATION_DENIED"); await expect(tko_saas.backup(tko_actor({ role: "guest", memberId: "guest" }), { schemaVersion: "0008", checksum: "nope", objectKey: null, resourceCounts: {}, correlationId: "guest-backup" })).rejects.toThrow("TASKO_AUTHORIZATION_DENIED");
  });

  it("applies a Redis-backed abuse limit before repeated SaaS provisioning mutations", async () => {
    for (let tko_index = 0; tko_index < 10; tko_index += 1) {
      await tko_saas.provision(tko_adminSubject, { slug: `rate-${tko_index}`, name: `Rate ${tko_index}`, ownerAuthSubject: `rate-owner-${tko_index}`, idempotencyKey: `rate-${tko_index}`, correlationId: `rate-${tko_index}` });
    }
    await expect(tko_saas.provision(tko_adminSubject, { slug: "rate-blocked", name: "Rate blocked", ownerAuthSubject: "rate-owner-blocked", idempotencyKey: "rate-blocked", correlationId: "rate-blocked" })).rejects.toThrow("TASKO_RATE_LIMITED");
    expect((await tko_platform.listTenants()).some(tko_tenant => tko_tenant.slug === "rate-blocked")).toBe(false);
  });

  it("exposes a platform-admin-only recovery probe for outbox and search indexing backlog", async () => {
    const tko_owner = tko_actor();
    await tko_platform.writeDurableMutation({ actor: tko_owner, tenantId: tko_owner.tenantId, eventType: "work.work_item_created.v1", topic: "work.work_item", payload: { workItemId: "recovery-probe-work-item" }, auditAction: "work.work_item.created", resourceType: "work_item", resourceId: "recovery-probe-work-item", correlationId: "recovery-probe" });
    await expect(tko_saas.recoveryProbe("not-platform-admin")).rejects.toThrow("TASKO_PLATFORM_ADMIN_REQUIRED");
    const tko_probe = await tko_saas.recoveryProbe(tko_adminSubject);
    expect(tko_probe.outbox.pendingBefore).toBeGreaterThan(0);
    expect(tko_probe.outbox.processedThisRun).toBeGreaterThan(0);
    expect(tko_probe.outbox.pendingAfter).toBeLessThan(tko_probe.outbox.pendingBefore);
    expect(tko_probe.search.pendingIndexEventsBefore).toBeGreaterThan(0);
    expect(tko_probe.search.pendingIndexEventsAfter).toBe(0);
    expect(tko_probe.worker.status).toBe("healthy");
  });
});
