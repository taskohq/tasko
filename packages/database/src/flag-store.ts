import pg, { type PoolClient } from "pg";
import { tko_config } from "../../config/src/tasko-config";
import type { PlatformActor } from "../../contracts/src/platform";
import { getPlatformStore } from "./platform-store";

/** Tenant-scoped feature-flag overrides (spec 03 P0, spec 22 §10). The flag registry itself lives
 * in modules/platform/src/feature-flags.ts; this store only persists per-tenant overrides. */

type TkoRow = Record<string, unknown>;

export interface TenantFeatureFlagOverride {
  flagKey: string;
  enabled: boolean;
  setByAuthSubject: string | null;
  updatedAt: Date;
}

export interface SetTenantFlagOverrideInput {
  flagKey: string;
  enabled: boolean;
  correlationId: string;
}

export interface FeatureFlagStore {
  readonly mode: "memory" | "postgres";
  listTenantFlagOverrides(tko_tenantId: string): Promise<Record<string, boolean>>;
  listTenantFlagOverrideRows(tko_tenantId: string): Promise<TenantFeatureFlagOverride[]>;
  setTenantFlagOverride(tko_actor: PlatformActor, tko_input: SetTenantFlagOverrideInput): Promise<void>;
}

export class MemoryFeatureFlagStore implements FeatureFlagStore {
  readonly mode = "memory" as const;
  /** Keyed by `${tenantId}:${flagKey}`; entries keep the bare flagKey. */
  private readonly tko_overrides = new Map<string, TenantFeatureFlagOverride & { tenantId: string }>();

  async listTenantFlagOverrides(tko_tenantId: string): Promise<Record<string, boolean>> {
    const tko_result: Record<string, boolean> = {};
    for (const tko_override of Array.from(this.tko_overrides.values())) if (tko_override.tenantId === tko_tenantId) tko_result[tko_override.flagKey] = tko_override.enabled;
    return tko_result;
  }
  async listTenantFlagOverrideRows(tko_tenantId: string): Promise<TenantFeatureFlagOverride[]> {
    return Array.from(this.tko_overrides.values()).filter(tko_override => tko_override.tenantId === tko_tenantId).map(tko_override => ({ flagKey: tko_override.flagKey, enabled: tko_override.enabled, setByAuthSubject: tko_override.setByAuthSubject, updatedAt: tko_override.updatedAt }));
  }
  async setTenantFlagOverride(tko_actor: PlatformActor, tko_input: SetTenantFlagOverrideInput): Promise<void> {
    const tko_key = `${tko_actor.tenantId}:${tko_input.flagKey}`;
    const tko_previous = this.tko_overrides.get(tko_key);
    this.tko_overrides.set(tko_key, { tenantId: tko_actor.tenantId, flagKey: tko_input.flagKey, enabled: tko_input.enabled, setByAuthSubject: tko_actor.authSubject, updatedAt: new Date() });
    await this.tko_emit(tko_actor, tko_input.flagKey, tko_input.enabled, tko_previous?.enabled ?? null, tko_input.correlationId);
  }
  private async tko_emit(tko_actor: PlatformActor, tko_flagKey: string, tko_enabled: boolean, tko_previous: boolean | null, tko_correlationId: string): Promise<void> {
    await getPlatformStore().writeDurableMutation({
      actor: tko_actor,
      tenantId: tko_actor.tenantId,
      eventType: "platform.feature_flag_set.v1",
      topic: "platform.feature_flags",
      payload: { flagKey: tko_flagKey, enabled: tko_enabled, previousEnabled: tko_previous },
      auditAction: "platform.feature_flag.set",
      resourceType: "tenant",
      resourceId: tko_actor.tenantId,
      correlationId: tko_correlationId,
    });
  }
}

export class PostgresFeatureFlagStore implements FeatureFlagStore {
  readonly mode = "postgres" as const;
  private readonly tko_pool: pg.Pool;
  constructor(tko_url: string) { this.tko_pool = new pg.Pool({ connectionString: tko_url, max: 5 }); }
  async listTenantFlagOverrides(tko_tenantId: string): Promise<Record<string, boolean>> {
    const tko_rows = (await this.tko_pool.query("select flag_key,enabled from tenant_feature_flags where tenant_id=$1", [tko_tenantId])).rows;
    return Object.fromEntries(tko_rows.map(tko_row => [String(tko_row.flag_key), Boolean(tko_row.enabled)]));
  }
  async listTenantFlagOverrideRows(tko_tenantId: string): Promise<TenantFeatureFlagOverride[]> {
    return (await this.tko_pool.query("select flag_key,enabled,set_by_auth_subject,updated_at from tenant_feature_flags where tenant_id=$1 order by flag_key", [tko_tenantId])).rows.map(tko_row => ({ flagKey: String(tko_row.flag_key), enabled: Boolean(tko_row.enabled), setByAuthSubject: tko_row.set_by_auth_subject ? String(tko_row.set_by_auth_subject) : null, updatedAt: new Date(String(tko_row.updated_at)) }));
  }
  async setTenantFlagOverride(tko_actor: PlatformActor, tko_input: SetTenantFlagOverrideInput): Promise<void> {
    const tko_client = await this.tko_pool.connect();
    try {
      await tko_client.query("begin");
      await tko_client.query("select set_config('app.tenant_id',$1,true)", [tko_actor.tenantId]);
      const tko_previous = await tko_client.query("select enabled from tenant_feature_flags where tenant_id=$1 and flag_key=$2", [tko_actor.tenantId, tko_input.flagKey]);
      await tko_client.query("insert into tenant_feature_flags(id,tenant_id,flag_key,enabled,set_by_auth_subject) values(gen_random_uuid(),$1,$2,$3,$4) on conflict(tenant_id,flag_key) do update set enabled=excluded.enabled,set_by_auth_subject=excluded.set_by_auth_subject,updated_at=now()", [tko_actor.tenantId, tko_input.flagKey, tko_input.enabled, tko_actor.authSubject]);
      await this.tko_emit(tko_client, tko_actor, tko_input.flagKey, tko_input.enabled, tko_previous.rowCount ? Boolean(tko_previous.rows[0].enabled) : null, tko_input.correlationId);
      await tko_client.query("commit");
    } catch (tko_error) { await tko_client.query("rollback"); throw tko_error; } finally { tko_client.release(); }
  }
  private async tko_emit(tko_client: PoolClient, tko_actor: PlatformActor, tko_flagKey: string, tko_enabled: boolean, tko_previous: boolean | null, tko_correlationId: string): Promise<void> {
    await tko_client.query("insert into audit_logs(id,tenant_id,actor_auth_subject,action,resource_type,resource_id,correlation_id,metadata_json) values(gen_random_uuid(),$1::uuid,$2,'platform.feature_flag.set','tenant',$3,$4,$5::jsonb)", [tko_actor.tenantId, tko_actor.authSubject, tko_actor.tenantId, tko_correlationId, JSON.stringify({ flagKey: tko_flagKey, enabled: tko_enabled, previousEnabled: tko_previous })]);
    await tko_client.query("insert into outbox(id,event_id,tenant_id,topic,event_type,payload_json,actor_auth_subject,correlation_id,status,attempts,available_at) values(gen_random_uuid(),gen_random_uuid(),$1::uuid,'platform.feature_flags','platform.feature_flag_set.v1',$2::jsonb,$3,$4,'pending',0,now())", [tko_actor.tenantId, JSON.stringify({ flagKey: tko_flagKey, enabled: tko_enabled, previousEnabled: tko_previous }), tko_actor.authSubject, tko_correlationId]);
  }
}

let tko_flagStore: FeatureFlagStore | null = null;
export function getFeatureFlagStore(): FeatureFlagStore { if (!tko_flagStore) tko_flagStore = tko_config.postgresUrl ? new PostgresFeatureFlagStore(tko_config.postgresUrl) : new MemoryFeatureFlagStore(); return tko_flagStore; }
export function setFeatureFlagStoreForTests(tko_store: FeatureFlagStore | null): void { tko_flagStore = tko_store; }
