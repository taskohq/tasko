import { Pool, type PoolClient } from "pg";
import { tko_config } from "../../config/src/tasko-config";
import type {
  AuditLogRecord,
  ChangeTenantMemberRoleInput,
  DurableMutationInput,
  OutboxRecord,
  Tenant,
  TenantMembership,
} from "../../contracts/src/platform";
import type { TenantProvisionInput } from "../../contracts/src/saas";

export type PlatformStoreMode = "memory" | "postgres";

export interface PlatformStoreHealth {
  name: "database";
  status: "ok" | "degraded" | "error";
  detail: string;
}

export interface SeedWorkspaceInput {
  ownerAuthSubject: string;
  tenantSlug?: string;
  tenantName?: string;
}

export interface PlatformStore {
  readonly mode: PlatformStoreMode;
  health(): Promise<PlatformStoreHealth>;
  listMemberships(tko_authSubject: string): Promise<TenantMembership[]>;
  listTenantMembers(tko_tenantId: string): Promise<TenantMembership[]>;
  findMembershipBySlug(
    tko_authSubject: string,
    tko_tenantSlug: string,
  ): Promise<TenantMembership | null>;
  seedDemoWorkspace(tko_input: SeedWorkspaceInput): Promise<Tenant>;
  provisionTenant(tko_input: TenantProvisionInput): Promise<{ tenant: Tenant; created: boolean }>;
  setTenantLifecycle(tko_input: { actor: { authSubject: string }; tenantId: string; status: Tenant["status"]; correlationId: string }): Promise<Tenant>;
  listTenants(): Promise<Tenant[]>;
  changeTenantMemberRole(tko_input: ChangeTenantMemberRoleInput): Promise<void>;
  writeDurableMutation(tko_input: DurableMutationInput): Promise<OutboxRecord>;
  listOutbox(): Promise<OutboxRecord[]>;
  reserveOutbox(tko_limit: number): Promise<OutboxRecord[]>;
  markOutboxProcessed(tko_outboxId: string): Promise<void>;
  rescheduleOutbox(tko_outboxId: string, tko_error: string, tko_maxAttempts: number): Promise<void>;
  listAuditLogs(): Promise<AuditLogRecord[]>;
}

function createTenant(tko_input: SeedWorkspaceInput): Tenant {
  const tko_slug = tko_input.tenantSlug ?? "tasko-demo";
  return {
    id: `tko-tenant-${tko_slug}`,
    slug: tko_slug,
    name: tko_input.tenantName ?? "Tasko Demo Workspace",
    status: "active",
    deploymentProfile: tko_config.deploymentProfile,
    createdAt: new Date(),
  };
}

function cloneOutbox(tko_record: OutboxRecord): OutboxRecord {
  return {
    ...tko_record,
    payload: { ...tko_record.payload },
    availableAt: new Date(tko_record.availableAt),
    createdAt: new Date(tko_record.createdAt),
  };
}

function parsePayload(tko_value: unknown): Record<string, unknown> {
  if (typeof tko_value === "object" && tko_value !== null) {
    return tko_value as Record<string, unknown>;
  }

  if (typeof tko_value === "string") {
    try {
      return JSON.parse(tko_value) as Record<string, unknown>;
    } catch {
      return {};
    }
  }

  return {};
}

function tko_mapTenant(tko_row: Record<string, unknown>): Tenant {
  return {
    id: String(tko_row.id), slug: String(tko_row.slug), name: String(tko_row.name),
    status: String(tko_row.status) as Tenant["status"],
    deploymentProfile: String(tko_row.deployment_profile) as Tenant["deploymentProfile"],
    createdAt: new Date(String(tko_row.created_at)),
  };
}

export class MemoryPlatformStore implements PlatformStore {
  readonly mode = "memory" as const;
  private readonly tko_tenants = new Map<string, Tenant>();
  private readonly tko_memberships = new Map<string, TenantMembership[]>();
  private readonly tko_outbox = new Map<string, OutboxRecord>();
  private readonly tko_auditLogs: AuditLogRecord[] = [];

  async health(): Promise<PlatformStoreHealth> {
    return { name: "database", status: "ok", detail: "in-memory development adapter" };
  }

  async listMemberships(tko_authSubject: string): Promise<TenantMembership[]> {
    return (this.tko_memberships.get(tko_authSubject) ?? []).map(tko_membership => ({
      ...tko_membership,
      tenant: { ...tko_membership.tenant },
    }));
  }

  async listTenantMembers(tko_tenantId: string): Promise<TenantMembership[]> {
    const tko_members = new Map<string, TenantMembership>();
    for (const tko_memberships of Array.from(this.tko_memberships.values())) {
      for (const tko_membership of tko_memberships) {
        if (
          tko_membership.tenant.id === tko_tenantId
          && tko_membership.tenant.status === "active"
          && tko_membership.status === "active"
          && tko_membership.role !== "service_account"
        ) {
          tko_members.set(tko_membership.id, {
            ...tko_membership,
            tenant: { ...tko_membership.tenant },
          });
        }
      }
    }
    return Array.from(tko_members.values()).sort((tko_left, tko_right) => tko_left.displayName.localeCompare(tko_right.displayName));
  }

  async findMembershipBySlug(
    tko_authSubject: string,
    tko_tenantSlug: string,
  ): Promise<TenantMembership | null> {
    const tko_memberships = await this.listMemberships(tko_authSubject);
    return tko_memberships.find(tko_membership => tko_membership.tenant.slug === tko_tenantSlug) ?? null;
  }

  async seedDemoWorkspace(tko_input: SeedWorkspaceInput): Promise<Tenant> {
    const tko_tenant = createTenant(tko_input);
    this.tko_tenants.set(tko_tenant.id, tko_tenant);
    const tko_seedMembers: Array<Pick<TenantMembership, "authSubject" | "role" | "displayName">> = [
      { authSubject: tko_input.ownerAuthSubject, role: "owner", displayName: "Demo Owner" },
      { authSubject: `demo-admin:${tko_tenant.slug}`, role: "admin", displayName: "Demo Admin" },
      { authSubject: `demo-member:${tko_tenant.slug}`, role: "member", displayName: "Demo Member" },
      { authSubject: `demo-guest:${tko_tenant.slug}`, role: "guest", displayName: "Demo Guest" },
      { authSubject: tko_config.workerServiceAuthSubject, role: "service_account", displayName: "Tasko Worker" },
    ];

    for (const tko_seedMember of tko_seedMembers) {
      const tko_existingMemberships = this.tko_memberships.get(tko_seedMember.authSubject) ?? [];
      const tko_hasMembership = tko_existingMemberships.some(
        tko_membership => tko_membership.tenant.id === tko_tenant.id,
      );
      if (!tko_hasMembership) {
        tko_existingMemberships.push({
          id: `tko-member-${tko_tenant.slug}-${tko_seedMember.role}`,
          tenant: tko_tenant,
          authSubject: tko_seedMember.authSubject,
          role: tko_seedMember.role,
          status: "active",
          displayName: tko_seedMember.displayName,
        });
        this.tko_memberships.set(tko_seedMember.authSubject, tko_existingMemberships);
      }
    }

    return { ...tko_tenant };
  }

  async provisionTenant(tko_input: TenantProvisionInput): Promise<{ tenant: Tenant; created: boolean }> {
    const tko_existing = Array.from(this.tko_tenants.values()).find(tko_tenant => tko_tenant.slug === tko_input.slug);
    if (tko_existing) return { tenant: { ...tko_existing }, created: false };
    const tko_tenant = await this.seedDemoWorkspace({ ownerAuthSubject: tko_input.ownerAuthSubject, tenantSlug: tko_input.slug, tenantName: tko_input.name });
    await this.writeDurableMutation({
      actor: null, tenantId: tko_tenant.id, topic: "tenant.lifecycle", eventType: "tenant.provisioned.v1",
      payload: { tenantId: tko_tenant.id, slug: tko_tenant.slug, planKey: tko_input.planKey ?? "starter", idempotencyKey: tko_input.idempotencyKey },
      auditAction: "tenant.provisioned", resourceType: "tenant", resourceId: tko_tenant.id, correlationId: tko_input.correlationId,
    });
    return { tenant: tko_tenant, created: true };
  }

  async setTenantLifecycle(tko_input: { actor: { authSubject: string }; tenantId: string; status: Tenant["status"]; correlationId: string }): Promise<Tenant> {
    const tko_current = this.tko_tenants.get(tko_input.tenantId);
    if (!tko_current) throw new Error("TASKO_TENANT_NOT_FOUND");
    const tko_next = { ...tko_current, status: tko_input.status };
    this.tko_tenants.set(tko_next.id, tko_next);
    for (const tko_memberships of Array.from(this.tko_memberships.values())) for (const tko_membership of tko_memberships) if (tko_membership.tenant.id === tko_next.id) tko_membership.tenant = tko_next;
    await this.writeDurableMutation({
      actor: null, tenantId: tko_next.id, topic: "tenant.lifecycle", eventType: `tenant.${tko_next.status}.v1`, payload: { tenantId: tko_next.id, status: tko_next.status },
      auditAction: "tenant.lifecycle_changed", resourceType: "tenant", resourceId: tko_next.id, auditMetadata: { actorAuthSubject: tko_input.actor.authSubject, status: tko_next.status }, correlationId: tko_input.correlationId,
    });
    return { ...tko_next };
  }

  async listTenants(): Promise<Tenant[]> { return Array.from(this.tko_tenants.values()).map(tko_tenant => ({ ...tko_tenant })); }

  async changeTenantMemberRole(tko_input: ChangeTenantMemberRoleInput): Promise<void> {
    for (const [tko_authSubject, tko_memberships] of Array.from(this.tko_memberships.entries())) {
      const tko_membership = tko_memberships.find(tko_item => tko_item.id === tko_input.memberId);
      if (!tko_membership) continue;
      if (tko_membership.tenant.id !== tko_input.tenantId) throw new Error("TASKO_AUTHORIZATION_DENIED:tenant_mismatch");
      const tko_previousRole = tko_membership.role;
      tko_membership.role = tko_input.newRole;
      this.tko_memberships.set(tko_authSubject, tko_memberships);
      await this.writeDurableMutation({
        actor: tko_input.actor,
        tenantId: tko_input.tenantId,
        eventType: "tenant.membership.role_changed.v1",
        topic: "tenant.membership",
        payload: { memberId: tko_membership.id, previousRole: tko_previousRole, newRole: tko_input.newRole },
        auditAction: "tenant.membership.role_changed",
        resourceType: "tenant_member",
        resourceId: tko_membership.id,
        correlationId: tko_input.correlationId,
      });
      return;
    }
    throw new Error("Tenant member not found");
  }

  async writeDurableMutation(tko_input: DurableMutationInput): Promise<OutboxRecord> {
    const tko_now = new Date();
    const tko_outboxRecord: OutboxRecord = {
      id: crypto.randomUUID(),
      eventId: crypto.randomUUID(),
      tenantId: tko_input.tenantId,
      topic: tko_input.topic,
      eventType: tko_input.eventType,
      payload: { ...tko_input.payload },
      actorAuthSubject: tko_input.actor?.authSubject ?? null,
      correlationId: tko_input.correlationId,
      status: "pending",
      attempts: 0,
      availableAt: tko_now,
      createdAt: tko_now,
    };
    const tko_auditRecord: AuditLogRecord = {
      id: crypto.randomUUID(),
      tenantId: tko_input.tenantId,
      actorAuthSubject: tko_input.actor?.authSubject ?? null,
      action: tko_input.auditAction,
      resourceType: tko_input.resourceType,
      resourceId: tko_input.resourceId,
      correlationId: tko_input.correlationId,
      metadata: { ...(tko_input.auditMetadata ?? {}) },
      createdAt: tko_now,
    };

    this.tko_outbox.set(tko_outboxRecord.id, tko_outboxRecord);
    this.tko_auditLogs.push(tko_auditRecord);
    return cloneOutbox(tko_outboxRecord);
  }

  async reserveOutbox(tko_limit: number): Promise<OutboxRecord[]> {
    const tko_now = new Date();
    const tko_records = Array.from(this.tko_outbox.values())
      .filter(
        tko_record =>
          tko_record.status === "pending" && tko_record.availableAt.getTime() <= tko_now.getTime(),
      )
      .slice(0, tko_limit);

    for (const tko_record of tko_records) {
      tko_record.status = "processing";
      tko_record.attempts += 1;
    }

    return tko_records.map(cloneOutbox);
  }

  async listOutbox(): Promise<OutboxRecord[]> {
    return Array.from(this.tko_outbox.values()).map(cloneOutbox);
  }

  async markOutboxProcessed(tko_outboxId: string): Promise<void> {
    const tko_record = this.tko_outbox.get(tko_outboxId);
    if (tko_record) tko_record.status = "processed";
  }

  async rescheduleOutbox(
    tko_outboxId: string,
    tko_error: string,
    tko_maxAttempts: number,
  ): Promise<void> {
    const tko_record = this.tko_outbox.get(tko_outboxId);
    if (!tko_record) return;

    if (tko_record.attempts >= tko_maxAttempts) {
      tko_record.status = "dead_letter";
      tko_record.payload = { ...tko_record.payload, lastError: tko_error };
      return;
    }

    const tko_delayMs = Math.min(60_000, 250 * 2 ** tko_record.attempts);
    tko_record.status = "pending";
    tko_record.availableAt = new Date(Date.now() + tko_delayMs);
    tko_record.payload = { ...tko_record.payload, lastError: tko_error };
  }

  async listAuditLogs(): Promise<AuditLogRecord[]> {
    return this.tko_auditLogs.map(tko_record => ({
      ...tko_record,
      metadata: { ...tko_record.metadata },
      createdAt: new Date(tko_record.createdAt),
    }));
  }
}

export class PostgresPlatformStore implements PlatformStore {
  readonly mode = "postgres" as const;
  private readonly tko_pool: Pool;

  constructor(tko_connectionString: string) {
    this.tko_pool = new Pool({ connectionString: tko_connectionString });
  }

  async provisionTenant(tko_input: TenantProvisionInput): Promise<{ tenant: Tenant; created: boolean }> {
    const tko_client = await this.tko_pool.connect();
    try {
      await tko_client.query("BEGIN");
      const tko_prior = await tko_client.query("select t.id,t.slug,t.name,t.status,t.deployment_profile,t.created_at from tenant_provisioning_requests r join tenants t on t.id=r.tenant_id where r.idempotency_key=$1 for update", [tko_input.idempotencyKey]);
      if (tko_prior.rowCount) { await tko_client.query("COMMIT"); return { tenant: tko_mapTenant(tko_prior.rows[0]), created: false }; }
      const tko_slugPrior = await tko_client.query("select id,slug,name,status,deployment_profile,created_at from tenants where slug=$1 for update", [tko_input.slug]);
      if (tko_slugPrior.rowCount) { await tko_client.query("COMMIT"); return { tenant: tko_mapTenant(tko_slugPrior.rows[0]), created: false }; }
      const tko_tenantResult = await tko_client.query("insert into tenants(id,slug,name,status,deployment_profile) values(gen_random_uuid(),$1,$2,'active','saas') returning id,slug,name,status,deployment_profile,created_at", [tko_input.slug, tko_input.name]);
      const tko_tenant = tko_mapTenant(tko_tenantResult.rows[0]);
      const tko_ownerResult = await tko_client.query("insert into users(id,auth_subject,email,status) values(gen_random_uuid(),$1,null,'active') on conflict(auth_subject) do update set status='active' returning id", [tko_input.ownerAuthSubject]);
      await tko_client.query("insert into tenant_members(id,tenant_id,user_id,role,status,display_name) values(gen_random_uuid(),$1,$2,'owner','active',$3) on conflict(tenant_id,user_id) do update set role='owner',status='active',display_name=excluded.display_name", [tko_tenant.id, tko_ownerResult.rows[0].id, tko_input.ownerDisplayName]);
      const tko_workerResult = await tko_client.query("insert into users(id,auth_subject,email,status) values(gen_random_uuid(),$1,null,'active') on conflict(auth_subject) do update set status='active' returning id", [tko_config.workerServiceAuthSubject]);
      await tko_client.query("insert into tenant_members(id,tenant_id,user_id,role,status,display_name) values(gen_random_uuid(),$1,$2,'service_account','active','Tasko Worker') on conflict(tenant_id,user_id) do update set role='service_account',status='active'", [tko_tenant.id, tko_workerResult.rows[0].id]);
      const tko_planKey = tko_input.planKey ?? "starter";
      const tko_plan = await tko_client.query("select plan_key,entitlements_json,quotas_json from saas_plans where plan_key=$1 and active=true", [tko_planKey]);
      if (!tko_plan.rowCount) throw new Error("TASKO_SAAS_PLAN_NOT_FOUND");
      await tko_client.query("insert into tenant_entitlements(tenant_id,plan_key,status,entitlements_json,quotas_json) values($1,$2,'trialing',$3::jsonb,$4::jsonb)", [tko_tenant.id, tko_planKey, JSON.stringify(tko_plan.rows[0].entitlements_json), JSON.stringify(tko_plan.rows[0].quotas_json)]);
      await tko_client.query("insert into tenant_provisioning_requests(id,tenant_id,owner_auth_subject,idempotency_key) values(gen_random_uuid(),$1,$2,$3)", [tko_tenant.id, tko_input.ownerAuthSubject, tko_input.idempotencyKey]);
      await tko_client.query("insert into audit_logs(id,tenant_id,actor_auth_subject,action,resource_type,resource_id,correlation_id,metadata_json) values(gen_random_uuid(),$1,$2,'tenant.provisioned','tenant',$1,$3,$4::jsonb)", [tko_tenant.id, tko_input.ownerAuthSubject, tko_input.correlationId, JSON.stringify({ slug: tko_tenant.slug, planKey: tko_planKey })]);
      await tko_client.query("insert into outbox(id,event_id,tenant_id,topic,event_type,payload_json,actor_auth_subject,correlation_id,status,attempts,available_at) values(gen_random_uuid(),gen_random_uuid(),$1,'tenant.lifecycle','tenant.provisioned.v1',$2::jsonb,$3,$4,'pending',0,now())", [tko_tenant.id, JSON.stringify({ tenantId: tko_tenant.id, slug: tko_tenant.slug, planKey: tko_planKey }), tko_input.ownerAuthSubject, tko_input.correlationId]);
      await tko_client.query("COMMIT"); return { tenant: tko_tenant, created: true };
    } catch (tko_error) { await tko_client.query("ROLLBACK"); throw tko_error; } finally { tko_client.release(); }
  }

  async setTenantLifecycle(tko_input: { actor: { authSubject: string }; tenantId: string; status: Tenant["status"]; correlationId: string }): Promise<Tenant> {
    const tko_client = await this.tko_pool.connect();
    try {
      await tko_client.query("BEGIN");
      const tko_result = await tko_client.query("update tenants set status=$1 where id=$2 returning id,slug,name,status,deployment_profile,created_at", [tko_input.status, tko_input.tenantId]);
      if (!tko_result.rowCount) throw new Error("TASKO_TENANT_NOT_FOUND");
      const tko_tenant = tko_mapTenant(tko_result.rows[0]);
      await tko_client.query("insert into audit_logs(id,tenant_id,actor_auth_subject,action,resource_type,resource_id,correlation_id,metadata_json) values(gen_random_uuid(),$1,$2,'tenant.lifecycle_changed','tenant',$1,$3,$4::jsonb)", [tko_tenant.id, tko_input.actor.authSubject, tko_input.correlationId, JSON.stringify({ status: tko_tenant.status })]);
      await tko_client.query("insert into outbox(id,event_id,tenant_id,topic,event_type,payload_json,actor_auth_subject,correlation_id,status,attempts,available_at) values(gen_random_uuid(),gen_random_uuid(),$1,'tenant.lifecycle',$2,$3::jsonb,$4,$5,'pending',0,now())", [tko_tenant.id, `tenant.${tko_tenant.status}.v1`, JSON.stringify({ tenantId: tko_tenant.id, status: tko_tenant.status }), tko_input.actor.authSubject, tko_input.correlationId]);
      await tko_client.query("COMMIT"); return tko_tenant;
    } catch (tko_error) { await tko_client.query("ROLLBACK"); throw tko_error; } finally { tko_client.release(); }
  }

  async listTenants(): Promise<Tenant[]> { return (await this.tko_pool.query("select id,slug,name,status,deployment_profile,created_at from tenants order by created_at asc")).rows.map(tko_mapTenant); }

  async health(): Promise<PlatformStoreHealth> {
    try {
      await this.tko_pool.query("select 1");
      return { name: "database", status: "ok", detail: "PostgreSQL reachable" };
    } catch (tko_error) {
      return {
        name: "database",
        status: "error",
        detail: tko_error instanceof Error ? tko_error.message : "PostgreSQL unavailable",
      };
    }
  }

  async listMemberships(tko_authSubject: string): Promise<TenantMembership[]> {
    const tko_result = await this.tko_pool.query(
      `select tm.id as member_id, tm.role, tm.status as membership_status, tm.display_name,
              u.auth_subject, t.id as tenant_id, t.slug, t.name, t.status as tenant_status,
              t.deployment_profile, t.created_at
         from tenant_members tm
         join users u on u.id = tm.user_id
         join tenants t on t.id = tm.tenant_id
        where u.auth_subject = $1 and tm.status = 'active' and t.status = 'active'
        order by t.created_at asc`,
      [tko_authSubject],
    );
    return tko_result.rows.map(tko_row => this.mapMembership(tko_row));
  }

  async listTenantMembers(tko_tenantId: string): Promise<TenantMembership[]> {
    const tko_result = await this.tko_pool.query(
      `select tm.id as member_id, tm.role, tm.status as membership_status, tm.display_name,
              u.auth_subject, t.id as tenant_id, t.slug, t.name, t.status as tenant_status,
              t.deployment_profile, t.created_at
         from tenant_members tm
         join users u on u.id = tm.user_id
         join tenants t on t.id = tm.tenant_id
        where tm.tenant_id = $1
          and tm.status = 'active'
          and t.status = 'active'
          and tm.role <> 'service_account'
        order by tm.display_name asc, tm.id asc`,
      [tko_tenantId],
    );
    return tko_result.rows.map(tko_row => this.mapMembership(tko_row));
  }

  async findMembershipBySlug(
    tko_authSubject: string,
    tko_tenantSlug: string,
  ): Promise<TenantMembership | null> {
    const tko_memberships = await this.listMemberships(tko_authSubject);
    return tko_memberships.find(tko_membership => tko_membership.tenant.slug === tko_tenantSlug) ?? null;
  }

  async seedDemoWorkspace(tko_input: SeedWorkspaceInput): Promise<Tenant> {
    const tko_client = await this.tko_pool.connect();
    const tko_slug = tko_input.tenantSlug ?? "tasko-demo";
    const tko_name = tko_input.tenantName ?? "Tasko Demo Workspace";

    try {
      await tko_client.query("BEGIN");
      const tko_tenantResult = await tko_client.query(
        `insert into tenants (id, slug, name, status, deployment_profile)
         values (gen_random_uuid(), $1, $2, 'active', $3)
         on conflict (slug) do update set name = excluded.name
         returning id, slug, name, status, deployment_profile, created_at`,
        [tko_slug, tko_name, tko_config.deploymentProfile],
      );
      const tko_tenant = tko_tenantResult.rows[0];
      const tko_seedMembers = [
        [tko_input.ownerAuthSubject, "owner", "Demo Owner"],
        [`demo-admin:${tko_slug}`, "admin", "Demo Admin"],
        [`demo-member:${tko_slug}`, "member", "Demo Member"],
        [`demo-guest:${tko_slug}`, "guest", "Demo Guest"],
        [tko_config.workerServiceAuthSubject, "service_account", "Tasko Worker"],
      ] as const;
      for (const [tko_authSubject, tko_role, tko_displayName] of tko_seedMembers) {
        const tko_userResult = await tko_client.query(
          `insert into users (id, auth_subject, email, status)
           values (gen_random_uuid(), $1, null, 'active')
           on conflict (auth_subject) do update set status = 'active'
           returning id`,
          [tko_authSubject],
        );
        await tko_client.query(
          `insert into tenant_members (id, tenant_id, user_id, role, status, display_name)
           values (gen_random_uuid(), $1, $2, $3, 'active', $4)
           on conflict (tenant_id, user_id) do update set role = excluded.role, status = 'active', display_name = excluded.display_name`,
          [tko_tenant.id, tko_userResult.rows[0].id, tko_role, tko_displayName],
        );
      }
      await tko_client.query("COMMIT");
      return {
        id: tko_tenant.id,
        slug: tko_tenant.slug,
        name: tko_tenant.name,
        status: tko_tenant.status,
        deploymentProfile: tko_tenant.deployment_profile,
        createdAt: new Date(tko_tenant.created_at),
      };
    } catch (tko_error) {
      await tko_client.query("ROLLBACK");
      throw tko_error;
    } finally {
      tko_client.release();
    }
  }

  async writeDurableMutation(tko_input: DurableMutationInput): Promise<OutboxRecord> {
    const tko_client = await this.tko_pool.connect();
    const tko_eventId = crypto.randomUUID();
    const tko_outboxId = crypto.randomUUID();
    try {
      await tko_client.query("BEGIN");
      await tko_client.query(
        `insert into audit_logs
          (id, tenant_id, actor_auth_subject, action, resource_type, resource_id, correlation_id, metadata_json)
         values (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7::jsonb)`,
        [
          tko_input.tenantId,
          tko_input.actor?.authSubject ?? null,
          tko_input.auditAction,
          tko_input.resourceType,
          tko_input.resourceId,
          tko_input.correlationId,
          JSON.stringify(tko_input.auditMetadata ?? {}),
        ],
      );
      const tko_outboxResult = await tko_client.query(
        `insert into outbox
          (id, event_id, tenant_id, topic, event_type, payload_json, actor_auth_subject, correlation_id, status, attempts, available_at)
         values ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, 'pending', 0, now())
         returning id, event_id, tenant_id, topic, event_type, payload_json, actor_auth_subject,
                   correlation_id, status, attempts, available_at, created_at`,
        [
          tko_outboxId,
          tko_eventId,
          tko_input.tenantId,
          tko_input.topic,
          tko_input.eventType,
          JSON.stringify(tko_input.payload),
          tko_input.actor?.authSubject ?? null,
          tko_input.correlationId,
        ],
      );
      await tko_client.query("COMMIT");
      return this.mapOutbox(tko_outboxResult.rows[0]);
    } catch (tko_error) {
      await tko_client.query("ROLLBACK");
      throw tko_error;
    } finally {
      tko_client.release();
    }
  }

  async changeTenantMemberRole(tko_input: ChangeTenantMemberRoleInput): Promise<void> {
    const tko_client = await this.tko_pool.connect();
    const tko_eventId = crypto.randomUUID();
    const tko_outboxId = crypto.randomUUID();
    try {
      await tko_client.query("BEGIN");
      await tko_client.query("select set_config('app.tenant_id', $1, true)", [tko_input.tenantId]);
      const tko_current = await tko_client.query(
        "select role from tenant_members where id = $1 and tenant_id = $2 for update",
        [tko_input.memberId, tko_input.tenantId],
      );
      if (tko_current.rowCount !== 1) throw new Error("Tenant member not found");
      await tko_client.query(
        "update tenant_members set role = $1 where id = $2 and tenant_id = $3",
        [tko_input.newRole, tko_input.memberId, tko_input.tenantId],
      );
      const tko_payload = {
        memberId: tko_input.memberId,
        previousRole: tko_current.rows[0].role as string,
        newRole: tko_input.newRole,
      };
      await tko_client.query(
        `insert into audit_logs (id, tenant_id, actor_auth_subject, action, resource_type, resource_id, correlation_id, metadata_json)
         values (gen_random_uuid(), $1, $2, 'tenant.membership.role_changed', 'tenant_member', $3, $4, $5::jsonb)`,
        [tko_input.tenantId, tko_input.actor.authSubject, tko_input.memberId, tko_input.correlationId, JSON.stringify(tko_payload)],
      );
      await tko_client.query(
        `insert into outbox (id, event_id, tenant_id, topic, event_type, payload_json, actor_auth_subject, correlation_id, status, attempts, available_at)
         values ($1, $2, $3, 'tenant.membership', 'tenant.membership.role_changed.v1', $4::jsonb, $5, $6, 'pending', 0, now())`,
        [tko_outboxId, tko_eventId, tko_input.tenantId, JSON.stringify(tko_payload), tko_input.actor.authSubject, tko_input.correlationId],
      );
      await tko_client.query("COMMIT");
    } catch (tko_error) {
      await tko_client.query("ROLLBACK");
      throw tko_error;
    } finally {
      tko_client.release();
    }
  }

  async reserveOutbox(tko_limit: number): Promise<OutboxRecord[]> {
    const tko_client = await this.tko_pool.connect();
    try {
      await tko_client.query("BEGIN");
      const tko_result = await tko_client.query(
        `with reserved as (
           select id from outbox
            where status = 'pending' and available_at <= now()
            order by created_at asc
            limit $1
            for update skip locked
         )
         update outbox o
            set status = 'processing', attempts = attempts + 1, processing_started_at = now()
           from reserved
          where o.id = reserved.id
         returning o.id, o.event_id, o.tenant_id, o.topic, o.event_type, o.payload_json,
                   o.actor_auth_subject, o.correlation_id, o.status, o.attempts, o.available_at, o.created_at`,
        [tko_limit],
      );
      await tko_client.query("COMMIT");
      return tko_result.rows.map(tko_row => this.mapOutbox(tko_row));
    } catch (tko_error) {
      await tko_client.query("ROLLBACK");
      throw tko_error;
    } finally {
      tko_client.release();
    }
  }

  async listOutbox(): Promise<OutboxRecord[]> {
    const tko_result = await this.tko_pool.query(
      `select id, event_id, tenant_id, topic, event_type, payload_json,
              actor_auth_subject, correlation_id, status, attempts, available_at, created_at
         from outbox order by created_at desc`,
    );
    return tko_result.rows.map(tko_row => this.mapOutbox(tko_row));
  }

  async markOutboxProcessed(tko_outboxId: string): Promise<void> {
    await this.tko_pool.query(
      `update outbox set status = 'processed', processed_at = now(), last_error = null where id = $1`,
      [tko_outboxId],
    );
  }

  async rescheduleOutbox(
    tko_outboxId: string,
    tko_error: string,
    tko_maxAttempts: number,
  ): Promise<void> {
    await this.tko_pool.query(
      `update outbox
          set status = case when attempts >= $3 then 'dead_letter' else 'pending' end,
              available_at = case when attempts >= $3 then available_at
                                  else now() + ((least(60000, 250 * power(2, attempts)))::text || ' milliseconds')::interval end,
              last_error = $2
        where id = $1`,
      [tko_outboxId, tko_error.slice(0, 1_000), tko_maxAttempts],
    );
  }

  async listAuditLogs(): Promise<AuditLogRecord[]> {
    const tko_result = await this.tko_pool.query(
      `select id, tenant_id, actor_auth_subject, action, resource_type, resource_id,
              correlation_id, metadata_json, created_at
         from audit_logs order by created_at desc`,
    );
    return tko_result.rows.map(tko_row => ({
      id: tko_row.id,
      tenantId: tko_row.tenant_id,
      actorAuthSubject: tko_row.actor_auth_subject,
      action: tko_row.action,
      resourceType: tko_row.resource_type,
      resourceId: tko_row.resource_id,
      correlationId: tko_row.correlation_id,
      metadata: parsePayload(tko_row.metadata_json),
      createdAt: new Date(tko_row.created_at),
    }));
  }

  private mapMembership(tko_row: Record<string, unknown>): TenantMembership {
    return {
      id: String(tko_row.member_id),
      authSubject: String(tko_row.auth_subject),
      role: String(tko_row.role) as TenantMembership["role"],
      status: String(tko_row.membership_status) as TenantMembership["status"],
      displayName: String(tko_row.display_name ?? ""),
      tenant: {
        id: String(tko_row.tenant_id),
        slug: String(tko_row.slug),
        name: String(tko_row.name),
        status: String(tko_row.tenant_status) as Tenant["status"],
        deploymentProfile: String(tko_row.deployment_profile) as Tenant["deploymentProfile"],
        createdAt: new Date(String(tko_row.created_at)),
      },
    };
  }

  private mapOutbox(tko_row: Record<string, unknown>): OutboxRecord {
    return {
      id: String(tko_row.id),
      eventId: String(tko_row.event_id),
      tenantId: String(tko_row.tenant_id),
      topic: String(tko_row.topic),
      eventType: String(tko_row.event_type),
      payload: parsePayload(tko_row.payload_json),
      actorAuthSubject: tko_row.actor_auth_subject ? String(tko_row.actor_auth_subject) : null,
      correlationId: String(tko_row.correlation_id),
      status: String(tko_row.status) as OutboxRecord["status"],
      attempts: Number(tko_row.attempts),
      availableAt: new Date(String(tko_row.available_at)),
      createdAt: new Date(String(tko_row.created_at)),
    };
  }
}

let tko_platformStore: PlatformStore | null = null;

export function getPlatformStore(): PlatformStore {
  if (!tko_platformStore) {
    tko_platformStore = tko_config.postgresUrl
      ? new PostgresPlatformStore(tko_config.postgresUrl)
      : new MemoryPlatformStore();
  }
  return tko_platformStore;
}

export function setPlatformStoreForTests(tko_store: PlatformStore | null): void {
  tko_platformStore = tko_store;
}

export type PlatformTransactionClient = PoolClient;
