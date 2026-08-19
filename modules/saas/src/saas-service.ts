import type { PlatformActor, Tenant } from "../../../packages/contracts/src/platform";
import { createHash } from "node:crypto";
import type { BackupManifest, BillingIntent, PlatformOperationalSnapshot, PlatformRecoveryProbe, SaaSQuotaDecision, TenantEntitlement, TenantExportManifest, TenantProvisionInput, TenantProvisionResult } from "../../../packages/contracts/src/saas";
import { tko_config } from "../../../packages/config/src/tasko-config";
import { getPlatformStore } from "../../../packages/database/src/platform-store";
import { getSaaSStore } from "../../../packages/database/src/saas-store";
import { getRedisAdapter } from "../../../packages/redis/src/redis-adapter";
import { storagePut } from "../../../server/storage";
import { requireCapability } from "../../permissions/src/authorization";
import { getWorkerStatus, processOutboxOnce } from "../../worker/src/worker-service";

function tko_resource(tko_actor: PlatformActor): { tenantId: string; type: string; id: string } { return { tenantId: tko_actor.tenantId, type: "tenant", id: tko_actor.tenantId }; }
function tko_require(tko_actor: PlatformActor, tko_capability: Parameters<typeof requireCapability>[1]): void { requireCapability(tko_actor, tko_capability, tko_resource(tko_actor)); }
function tko_platformAdmin(tko_authSubject: string): void { if (!tko_config.platformAdminSubjects.includes(tko_authSubject)) throw new Error("TASKO_PLATFORM_ADMIN_REQUIRED"); }
const tko_searchIndexEventTypes = new Set(["work.work_item_created.v1", "crm.lead_created.v1", "chat.channel_created.v1", "chat.message_created.v1", "workspace.document_created.v1"]);

export class SaaSService {
  private async tko_takeAbuseControl(tko_subject: string, tko_action: string, tko_tenantId?: string): Promise<void> {
    const tko_result = await getRedisAdapter().takeRateLimit(`saas:${tko_action}:${tko_subject}:${tko_tenantId ?? "platform"}`, 10, 60_000);
    if (!tko_result.allowed) throw new Error(`TASKO_RATE_LIMITED:${tko_result.retryAfterMs}`);
  }
  async entitlement(tko_actor: PlatformActor): Promise<TenantEntitlement> { tko_require(tko_actor, "saas.entitlement.read"); const tko_entitlement = await getSaaSStore().getEntitlement(tko_actor.tenantId); if (!tko_entitlement) throw new Error("TASKO_ENTITLEMENT_NOT_FOUND"); return tko_entitlement; }
  async quota(tko_actor: PlatformActor, tko_metric: string, tko_amount = 0, tko_feature?: string): Promise<SaaSQuotaDecision> {
    tko_require(tko_actor, "saas.usage.read"); const tko_entitlement = await this.entitlement(tko_actor);
    if (tko_feature && !tko_entitlement.entitlements[tko_feature]) return { allowed: false, metric: tko_metric, limit: null, current: 0, remaining: null, reason: "feature_disabled" };
    const tko_usage = await getSaaSStore().listUsage(tko_actor.tenantId, tko_metric); const tko_current = tko_usage.reduce((tko_sum, tko_row) => tko_sum + tko_row.amount, 0); const tko_limit = tko_entitlement.quotas[tko_metric] ?? null;
    if (tko_limit !== null && tko_current + tko_amount > tko_limit) return { allowed: false, metric: tko_metric, limit: tko_limit, current: tko_current, remaining: Math.max(0, tko_limit - tko_current), reason: "quota_exceeded" };
    return { allowed: true, metric: tko_metric, limit: tko_limit, current: tko_current, remaining: tko_limit === null ? null : tko_limit - tko_current, reason: "allowed" };
  }
  async consumeUsage(tko_actor: PlatformActor, tko_input: { metric: string; amount: number; idempotencyKey: string; correlationId: string; feature?: string }): Promise<SaaSQuotaDecision> {
    if (tko_config.deploymentProfile !== "saas") return { allowed: true, metric: tko_input.metric, limit: null, current: 0, remaining: null, reason: "allowed" };
    const tko_existing = (await getSaaSStore().listUsage(tko_actor.tenantId, tko_input.metric)).find(tko_row => tko_row.idempotencyKey === tko_input.idempotencyKey);
    if (tko_existing) return this.quota(tko_actor, tko_input.metric, 0, tko_input.feature);
    const tko_decision = await this.quota(tko_actor, tko_input.metric, tko_input.amount, tko_input.feature); if (!tko_decision.allowed) return tko_decision;
    await getSaaSStore().recordUsage(tko_actor, tko_input); return this.quota(tko_actor, tko_input.metric, 0, tko_input.feature);
  }
  async requireFeature(tko_actor: PlatformActor, tko_feature: string): Promise<void> {
    if (tko_config.deploymentProfile !== "saas") return;
    const tko_decision = await this.quota(tko_actor, `feature:${tko_feature}`, 0, tko_feature);
    if (!tko_decision.allowed) throw new Error(`TASKO_SAAS_${tko_decision.reason.toUpperCase()}`);
  }
  async enforceFeatureUsage(tko_actor: PlatformActor, tko_input: { feature: string; metric: string; amount: number; idempotencyKey: string; correlationId: string }): Promise<void> {
    const tko_decision = await this.consumeUsage(tko_actor, tko_input);
    if (!tko_decision.allowed) throw new Error(`TASKO_SAAS_${tko_decision.reason.toUpperCase()}`);
  }
  async provision(tko_adminAuthSubject: string, tko_input: TenantProvisionInput): Promise<TenantProvisionResult> {
    tko_platformAdmin(tko_adminAuthSubject); await this.tko_takeAbuseControl(tko_adminAuthSubject, "provision"); const tko_result = await getPlatformStore().provisionTenant(tko_input); const tko_entitlement = await getSaaSStore().getEntitlement(tko_result.tenant.id); if (!tko_entitlement) throw new Error("TASKO_ENTITLEMENT_NOT_FOUND"); return { tenant: tko_result.tenant, membershipRole: "owner", entitlement: tko_entitlement, created: tko_result.created };
  }
  async lifecycle(tko_adminAuthSubject: string, tko_tenantId: string, tko_status: Tenant["status"], tko_correlationId: string): Promise<Tenant> { tko_platformAdmin(tko_adminAuthSubject); await this.tko_takeAbuseControl(tko_adminAuthSubject, "lifecycle", tko_tenantId); return getPlatformStore().setTenantLifecycle({ actor: { authSubject: tko_adminAuthSubject }, tenantId: tko_tenantId, status: tko_status, correlationId: tko_correlationId }); }
  async listTenants(tko_adminAuthSubject: string): Promise<Tenant[]> { tko_platformAdmin(tko_adminAuthSubject); return getPlatformStore().listTenants(); }
  async backup(tko_actor: PlatformActor, tko_input: { schemaVersion: string; checksum: string; objectKey: string | null; resourceCounts: Record<string, number>; correlationId: string }): Promise<BackupManifest> { tko_require(tko_actor, "saas.backup.manage"); await this.tko_takeAbuseControl(tko_actor.authSubject, "backup", tko_actor.tenantId); return getSaaSStore().createBackupManifest(tko_actor, tko_input); }
  async backups(tko_actor: PlatformActor): Promise<BackupManifest[]> { tko_require(tko_actor, "saas.backup.manage"); return getSaaSStore().listBackupManifests(tko_actor.tenantId); }
  async restoreDrill(tko_actor: PlatformActor, tko_input: { backupManifestId: string; validation: Record<string, unknown>; correlationId: string }) { tko_require(tko_actor, "saas.restore.manage"); await this.tko_takeAbuseControl(tko_actor.authSubject, "restore_drill", tko_actor.tenantId); return getSaaSStore().createRestoreDrill(tko_actor, tko_input); }
  async operations(tko_adminAuthSubject: string): Promise<PlatformOperationalSnapshot> { tko_platformAdmin(tko_adminAuthSubject); return getSaaSStore().getOperationalSnapshot(); }
  async recoveryProbe(tko_adminAuthSubject: string): Promise<PlatformRecoveryProbe> {
    tko_platformAdmin(tko_adminAuthSubject);
    await this.tko_takeAbuseControl(tko_adminAuthSubject, "recovery_probe");
    const tko_before = await getPlatformStore().listOutbox();
    const tko_pendingBefore = tko_before.filter(tko_row => tko_row.status === "pending");
    const tko_processedThisRun = await processOutboxOnce(100);
    const tko_after = await getPlatformStore().listOutbox();
    const tko_pendingAfter = tko_after.filter(tko_row => tko_row.status === "pending");
    const tko_worker = getWorkerStatus();
    return {
      generatedAt: new Date(),
      outbox: { pendingBefore: tko_pendingBefore.length, processedThisRun: tko_processedThisRun, pendingAfter: tko_pendingAfter.length, deadLetterAfter: tko_after.filter(tko_row => tko_row.status === "dead_letter").length },
      search: { pendingIndexEventsBefore: tko_pendingBefore.filter(tko_row => tko_searchIndexEventTypes.has(tko_row.eventType)).length, pendingIndexEventsAfter: tko_pendingAfter.filter(tko_row => tko_searchIndexEventTypes.has(tko_row.eventType)).length },
      worker: tko_worker,
    };
  }
  async exportTenantManifest(tko_adminAuthSubject: string, tko_tenantId: string, tko_correlationId: string): Promise<TenantExportManifest> {
    tko_platformAdmin(tko_adminAuthSubject); await this.tko_takeAbuseControl(tko_adminAuthSubject, "export_manifest", tko_tenantId);
    const tko_tenant = (await getPlatformStore().listTenants()).find(tko_candidate => tko_candidate.id === tko_tenantId);
    if (!tko_tenant) throw new Error("TASKO_TENANT_NOT_FOUND");
    const [tko_entitlement, tko_audit, tko_outbox, tko_backups] = await Promise.all([getSaaSStore().getEntitlement(tko_tenantId), getPlatformStore().listAuditLogs(), getPlatformStore().listOutbox(), getSaaSStore().listBackupManifests(tko_tenantId)]);
    const tko_resourceCounts = { audit_events: tko_audit.filter(tko_row => tko_row.tenantId === tko_tenantId).length, outbox_events: tko_outbox.filter(tko_row => tko_row.tenantId === tko_tenantId).length, prior_backup_manifests: tko_backups.length };
    const tko_export = { format: "tasko-tenant-export-manifest/v1" as const, generatedAt: new Date().toISOString(), tenant: tko_tenant, entitlement: tko_entitlement, resourceCounts: tko_resourceCounts, correlationId: tko_correlationId };
    const tko_serialized = JSON.stringify(tko_export, null, 2);
    const tko_object = await storagePut(`tasko/tenant-exports/${tko_tenant.id}/manifest-${Date.now()}.json`, tko_serialized, "application/json");
    const tko_actor: PlatformActor = { authSubject: tko_adminAuthSubject, tenantId: tko_tenant.id, tenantSlug: tko_tenant.slug, memberId: `platform-export:${tko_tenant.id}`, role: "owner", membershipStatus: "active", correlationId: tko_correlationId };
    const tko_manifest = await getSaaSStore().createBackupManifest(tko_actor, { schemaVersion: "m5-export-manifest-v1", checksum: `sha256:${createHash("sha256").update(tko_serialized).digest("hex")}`, objectKey: tko_object.key, resourceCounts: tko_resourceCounts, correlationId: tko_correlationId });
    return { format: "tasko-tenant-export-manifest/v1", manifest: tko_manifest, downloadUrl: tko_object.url, generatedBy: tko_adminAuthSubject };
  }
  async billing(tko_actor: PlatformActor, tko_kind: BillingIntent["kind"]): Promise<BillingIntent> { tko_require(tko_actor, "saas.billing.manage"); await this.tko_takeAbuseControl(tko_actor.authSubject, "billing", tko_actor.tenantId); return { status: tko_config.billingProvider ? "ready" : "provider_not_configured", kind: tko_kind, tenantId: tko_actor.tenantId, provider: tko_config.billingProvider, url: null }; }
}

let tko_saasService: SaaSService | null = null;
export function getSaaSService(): SaaSService { if (!tko_saasService) tko_saasService = new SaaSService(); return tko_saasService; }
