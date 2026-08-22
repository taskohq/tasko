import { Pool, type PoolClient } from "pg";
import { createHash, randomBytes } from "node:crypto";
import { tko_config } from "../../config/src/tasko-config";
import type {
  AuditLogRecord,
  ChangeTenantMemberRoleInput,
  ChangeTenantMemberStatusInput,
  CreateWorkspaceInvitationInput,
  DurableMutationInput,
  OutboxRecord,
  RedeemWorkspaceInvitationInput,
  ResendWorkspaceInvitationInput,
  RetryWorkspaceInvitationDeliveryInput,
  RevokeWorkspaceInvitationInput,
  Tenant,
  TenantMembership,
  TenantRole,
  WorkspaceInvitation,
  WorkspaceInvitationDelivery,
  WorkspaceInvitationDeliveryFilters,
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
  listTenantMembers(tko_tenantId: string, tko_options?: { includeSuspended?: boolean }): Promise<TenantMembership[]>;
  findMembershipBySlug(
    tko_authSubject: string,
    tko_tenantSlug: string,
  ): Promise<TenantMembership | null>;
  seedDemoWorkspace(tko_input: SeedWorkspaceInput): Promise<Tenant>;
  provisionTenant(tko_input: TenantProvisionInput): Promise<{ tenant: Tenant; created: boolean }>;
  setTenantLifecycle(tko_input: { actor: { authSubject: string }; tenantId: string; status: Tenant["status"]; correlationId: string }): Promise<Tenant>;
  listTenants(): Promise<Tenant[]>;
  changeTenantMemberRole(tko_input: ChangeTenantMemberRoleInput): Promise<void>;
  changeTenantMemberStatus(tko_input: ChangeTenantMemberStatusInput): Promise<void>;
  listWorkspaceInvitations(tko_tenantId: string): Promise<WorkspaceInvitation[]>;
  listWorkspaceInvitationDeliveries(tko_tenantId: string, tko_filters?: WorkspaceInvitationDeliveryFilters): Promise<WorkspaceInvitationDelivery[]>;
  createWorkspaceInvitation(tko_input: CreateWorkspaceInvitationInput): Promise<{ invitation: WorkspaceInvitation; token: string }>;
  resendWorkspaceInvitation(tko_input: ResendWorkspaceInvitationInput): Promise<{ invitation: WorkspaceInvitation; token: string }>;
  retryWorkspaceInvitationDelivery(tko_input: RetryWorkspaceInvitationDeliveryInput): Promise<{ invitation: WorkspaceInvitation; token: string }>;
  revokeWorkspaceInvitation(tko_input: RevokeWorkspaceInvitationInput): Promise<void>;
  redeemWorkspaceInvitation(tko_input: RedeemWorkspaceInvitationInput): Promise<{ tenant: Tenant; membership: TenantMembership }>;
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
    processingStartedAt: tko_record.processingStartedAt ? new Date(tko_record.processingStartedAt) : null,
    processedAt: tko_record.processedAt ? new Date(tko_record.processedAt) : null,
  };
}

type TkoStoredWorkspaceInvitation = WorkspaceInvitation & { tokenHash: string };

function tko_hashInvitationToken(tko_token: string) {
  return createHash("sha256").update(tko_token).digest("hex");
}

function tko_createInvitationToken() {
  return randomBytes(32).toString("base64url");
}

function tko_cloneWorkspaceInvitation(tko_invitation: WorkspaceInvitation): WorkspaceInvitation {
  return {
    ...tko_invitation,
    createdAt: new Date(tko_invitation.createdAt),
    expiresAt: new Date(tko_invitation.expiresAt),
    lastSentAt: new Date(tko_invitation.lastSentAt),
    acceptedAt: tko_invitation.acceptedAt ? new Date(tko_invitation.acceptedAt) : null,
    revokedAt: tko_invitation.revokedAt ? new Date(tko_invitation.revokedAt) : null,
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

function tko_mapWorkspaceInvitation(tko_row: Record<string, unknown>): WorkspaceInvitation {
  return {
    id: String(tko_row.id),
    tenantId: String(tko_row.tenant_id),
    email: String(tko_row.email),
    role: String(tko_row.role) as WorkspaceInvitation["role"],
    status: String(tko_row.status) as WorkspaceInvitation["status"],
    createdByAuthSubject: String(tko_row.created_by_auth_subject),
    createdAt: new Date(String(tko_row.created_at)),
    expiresAt: new Date(String(tko_row.expires_at)),
    lastSentAt: new Date(String(tko_row.last_sent_at)),
    acceptedAt: tko_row.accepted_at ? new Date(String(tko_row.accepted_at)) : null,
    revokedAt: tko_row.revoked_at ? new Date(String(tko_row.revoked_at)) : null,
  };
}

function tko_invitationDeliveryFromOutbox(tko_invitation: WorkspaceInvitation, tko_outbox: OutboxRecord | null): WorkspaceInvitationDelivery {
  if (!tko_outbox) {
    return { invitationId: tko_invitation.id, email: tko_invitation.email, role: tko_invitation.role, invitationStatus: tko_invitation.status, lastSentAt: tko_invitation.lastSentAt, deliveryStatus: "unavailable", attempts: 0, lastError: null, queuedAt: null, nextAttemptAt: null, deliveredAt: null };
  }
  const tko_deliveryStatus: WorkspaceInvitationDelivery["deliveryStatus"] = tko_outbox.status === "processed" ? "sent" : tko_outbox.status === "processing" ? "processing" : tko_outbox.status === "dead_letter" ? "failed" : tko_outbox.attempts > 0 ? "retrying" : "queued";
  return {
    invitationId: tko_invitation.id,
    email: tko_invitation.email,
    role: tko_invitation.role,
    invitationStatus: tko_invitation.status,
    lastSentAt: tko_invitation.lastSentAt,
    deliveryStatus: tko_deliveryStatus,
    attempts: tko_outbox.attempts,
    lastError: tko_outbox.lastError ?? null,
    queuedAt: tko_outbox.createdAt,
    nextAttemptAt: tko_outbox.status === "pending" ? tko_outbox.availableAt : null,
    deliveredAt: tko_outbox.processedAt ?? null,
  };
}

function tko_filterInvitationDeliveries(tko_deliveries: WorkspaceInvitationDelivery[], tko_filters?: WorkspaceInvitationDeliveryFilters): WorkspaceInvitationDelivery[] {
  const tko_dateRange = tko_filters?.dateRange ?? "all";
  const tko_threshold = tko_dateRange === "7d" ? Date.now() - 7 * 24 * 60 * 60 * 1_000
    : tko_dateRange === "30d" ? Date.now() - 30 * 24 * 60 * 60 * 1_000
      : tko_dateRange === "90d" ? Date.now() - 90 * 24 * 60 * 60 * 1_000
        : 0;
  return tko_deliveries.filter(tko_delivery => (
    (!tko_filters?.status || tko_delivery.deliveryStatus === tko_filters.status)
    && (!tko_threshold || tko_delivery.lastSentAt.getTime() >= tko_threshold)
  ));
}

export class MemoryPlatformStore implements PlatformStore {
  readonly mode = "memory" as const;
  private readonly tko_tenants = new Map<string, Tenant>();
  private readonly tko_memberships = new Map<string, TenantMembership[]>();
  private readonly tko_outbox = new Map<string, OutboxRecord>();
  private readonly tko_auditLogs: AuditLogRecord[] = [];
  private readonly tko_workspaceInvitations = new Map<string, TkoStoredWorkspaceInvitation>();

  async health(): Promise<PlatformStoreHealth> {
    return { name: "database", status: "ok", detail: "in-memory development adapter" };
  }

  async listMemberships(tko_authSubject: string): Promise<TenantMembership[]> {
    return (this.tko_memberships.get(tko_authSubject) ?? []).map(tko_membership => ({
      ...tko_membership,
      tenant: { ...tko_membership.tenant },
    }));
  }

  async listTenantMembers(tko_tenantId: string, tko_options?: { includeSuspended?: boolean }): Promise<TenantMembership[]> {
    const tko_members = new Map<string, TenantMembership>();
    for (const tko_memberships of Array.from(this.tko_memberships.values())) {
      for (const tko_membership of tko_memberships) {
        if (
          tko_membership.tenant.id === tko_tenantId
          && tko_membership.tenant.status === "active"
          && (tko_options?.includeSuspended || tko_membership.status === "active")
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

  async changeTenantMemberStatus(tko_input: ChangeTenantMemberStatusInput): Promise<void> {
    for (const [tko_authSubject, tko_memberships] of Array.from(this.tko_memberships.entries())) {
      const tko_membership = tko_memberships.find(tko_item => tko_item.id === tko_input.memberId);
      if (!tko_membership) continue;
      if (tko_membership.tenant.id !== tko_input.tenantId) throw new Error("TASKO_AUTHORIZATION_DENIED:tenant_mismatch");
      const tko_previousStatus = tko_membership.status;
      tko_membership.status = tko_input.newStatus;
      this.tko_memberships.set(tko_authSubject, tko_memberships);
      await this.writeDurableMutation({ actor: tko_input.actor, tenantId: tko_input.tenantId, topic: "tenant.membership", eventType: "tenant.membership.status_changed.v1", payload: { memberId: tko_membership.id, previousStatus: tko_previousStatus, newStatus: tko_input.newStatus }, auditAction: "tenant.membership.status_changed", resourceType: "tenant_member", resourceId: tko_membership.id, correlationId: tko_input.correlationId });
      return;
    }
    throw new Error("Tenant member not found");
  }

  async listWorkspaceInvitations(tko_tenantId: string): Promise<WorkspaceInvitation[]> {
    const tko_now = Date.now();
    for (const tko_invitation of Array.from(this.tko_workspaceInvitations.values())) if (tko_invitation.tenantId === tko_tenantId && tko_invitation.status === "pending" && tko_invitation.expiresAt.getTime() <= tko_now) tko_invitation.status = "expired";
    return Array.from(this.tko_workspaceInvitations.values()).filter(tko_invitation => tko_invitation.tenantId === tko_tenantId).sort((tko_left, tko_right) => tko_right.createdAt.getTime() - tko_left.createdAt.getTime()).map(tko_cloneWorkspaceInvitation);
  }

  async listWorkspaceInvitationDeliveries(tko_tenantId: string, tko_filters?: WorkspaceInvitationDeliveryFilters): Promise<WorkspaceInvitationDelivery[]> {
    const tko_invitations = await this.listWorkspaceInvitations(tko_tenantId);
    return tko_filterInvitationDeliveries(tko_invitations.map(tko_invitation => {
      const tko_latest = Array.from(this.tko_outbox.values())
        .filter(tko_outbox => tko_outbox.tenantId === tko_tenantId && tko_outbox.topic === "workspace.invitation" && (tko_outbox.eventType === "workspace.invitation.issued.v1" || tko_outbox.eventType === "workspace.invitation.resent.v1" || tko_outbox.eventType === "workspace.invitation.delivery_retried.v1") && tko_outbox.payload.invitationId === tko_invitation.id)
        .sort((tko_left, tko_right) => tko_right.createdAt.getTime() - tko_left.createdAt.getTime())[0] ?? null;
      return tko_invitationDeliveryFromOutbox(tko_invitation, tko_latest);
    }), tko_filters);
  }

  async createWorkspaceInvitation(tko_input: CreateWorkspaceInvitationInput): Promise<{ invitation: WorkspaceInvitation; token: string }> {
    const tko_duplicate = Array.from(this.tko_workspaceInvitations.values()).find(tko_invitation => tko_invitation.tenantId === tko_input.tenantId && tko_invitation.email === tko_input.email && tko_invitation.status === "pending" && tko_invitation.expiresAt.getTime() > Date.now());
    if (tko_duplicate) throw new Error("TASKO_WORKSPACE_INVITATION_ALREADY_PENDING");
    const tko_now = new Date(); const tko_token = tko_createInvitationToken();
    const tko_invitation: TkoStoredWorkspaceInvitation = { id: crypto.randomUUID(), tenantId: tko_input.tenantId, email: tko_input.email, role: tko_input.role, status: "pending", createdByAuthSubject: tko_input.actor.authSubject, createdAt: tko_now, expiresAt: tko_input.expiresAt, lastSentAt: tko_now, acceptedAt: null, revokedAt: null, tokenHash: tko_hashInvitationToken(tko_token) };
    this.tko_workspaceInvitations.set(tko_invitation.id, tko_invitation);
    const tko_auditPayload = { invitationId: tko_invitation.id, email: tko_invitation.email, role: tko_invitation.role, expiresAt: tko_invitation.expiresAt.toISOString() };
    await this.writeDurableMutation({ actor: tko_input.actor, tenantId: tko_input.tenantId, topic: "workspace.invitation", eventType: "workspace.invitation.issued.v1", payload: { ...tko_auditPayload, deliveryToken: tko_token }, auditAction: "workspace.invitation.issued", resourceType: "workspace_invitation", resourceId: tko_invitation.id, auditMetadata: tko_auditPayload, correlationId: tko_input.correlationId });
    return { invitation: tko_cloneWorkspaceInvitation(tko_invitation), token: tko_token };
  }

  async resendWorkspaceInvitation(tko_input: ResendWorkspaceInvitationInput): Promise<{ invitation: WorkspaceInvitation; token: string }> {
    const tko_invitation = this.tko_workspaceInvitations.get(tko_input.invitationId);
    if (!tko_invitation || tko_invitation.tenantId !== tko_input.tenantId || tko_invitation.status !== "pending") throw new Error("TASKO_WORKSPACE_INVITATION_NOT_PENDING");
    const tko_token = tko_createInvitationToken(); tko_invitation.tokenHash = tko_hashInvitationToken(tko_token); tko_invitation.expiresAt = tko_input.expiresAt; tko_invitation.lastSentAt = new Date();
    const tko_auditPayload = { invitationId: tko_invitation.id, email: tko_invitation.email, role: tko_invitation.role, expiresAt: tko_invitation.expiresAt.toISOString() };
    await this.writeDurableMutation({ actor: tko_input.actor, tenantId: tko_input.tenantId, topic: "workspace.invitation", eventType: "workspace.invitation.resent.v1", payload: { ...tko_auditPayload, deliveryToken: tko_token }, auditAction: "workspace.invitation.resent", resourceType: "workspace_invitation", resourceId: tko_invitation.id, auditMetadata: tko_auditPayload, correlationId: tko_input.correlationId });
    return { invitation: tko_cloneWorkspaceInvitation(tko_invitation), token: tko_token };
  }

  async retryWorkspaceInvitationDelivery(tko_input: RetryWorkspaceInvitationDeliveryInput): Promise<{ invitation: WorkspaceInvitation; token: string }> {
    const tko_invitation = this.tko_workspaceInvitations.get(tko_input.invitationId);
    if (!tko_invitation || tko_invitation.tenantId !== tko_input.tenantId || tko_invitation.status !== "pending" || tko_invitation.expiresAt.getTime() <= Date.now()) throw new Error("TASKO_WORKSPACE_INVITATION_NOT_PENDING");
    const tko_latest = Array.from(this.tko_outbox.values())
      .filter(tko_outbox => tko_outbox.tenantId === tko_input.tenantId && tko_outbox.topic === "workspace.invitation" && (tko_outbox.eventType === "workspace.invitation.issued.v1" || tko_outbox.eventType === "workspace.invitation.resent.v1" || tko_outbox.eventType === "workspace.invitation.delivery_retried.v1") && tko_outbox.payload.invitationId === tko_invitation.id)
      .sort((tko_left, tko_right) => tko_right.createdAt.getTime() - tko_left.createdAt.getTime())[0];
    if (!tko_latest || tko_latest.status !== "dead_letter") throw new Error("TASKO_WORKSPACE_INVITATION_DELIVERY_NOT_FAILED");
    const tko_token = tko_createInvitationToken();
    tko_invitation.tokenHash = tko_hashInvitationToken(tko_token);
    tko_invitation.expiresAt = tko_input.expiresAt;
    tko_invitation.lastSentAt = new Date();
    const tko_auditPayload = { invitationId: tko_invitation.id, email: tko_invitation.email, role: tko_invitation.role, expiresAt: tko_invitation.expiresAt.toISOString(), retryOfEventId: tko_latest.eventId };
    await this.writeDurableMutation({ actor: tko_input.actor, tenantId: tko_input.tenantId, topic: "workspace.invitation", eventType: "workspace.invitation.delivery_retried.v1", payload: { ...tko_auditPayload, deliveryToken: tko_token }, auditAction: "workspace.invitation.delivery_retried", resourceType: "workspace_invitation", resourceId: tko_invitation.id, auditMetadata: tko_auditPayload, correlationId: tko_input.correlationId });
    return { invitation: tko_cloneWorkspaceInvitation(tko_invitation), token: tko_token };
  }

  async revokeWorkspaceInvitation(tko_input: RevokeWorkspaceInvitationInput): Promise<void> {
    const tko_invitation = this.tko_workspaceInvitations.get(tko_input.invitationId);
    if (!tko_invitation || tko_invitation.tenantId !== tko_input.tenantId || tko_invitation.status !== "pending") throw new Error("TASKO_WORKSPACE_INVITATION_NOT_PENDING");
    tko_invitation.status = "revoked"; tko_invitation.revokedAt = new Date();
    await this.writeDurableMutation({ actor: tko_input.actor, tenantId: tko_input.tenantId, topic: "workspace.invitation", eventType: "workspace.invitation.revoked.v1", payload: { invitationId: tko_invitation.id, email: tko_invitation.email }, auditAction: "workspace.invitation.revoked", resourceType: "workspace_invitation", resourceId: tko_invitation.id, correlationId: tko_input.correlationId });
  }

  async redeemWorkspaceInvitation(tko_input: RedeemWorkspaceInvitationInput): Promise<{ tenant: Tenant; membership: TenantMembership }> {
    const tko_invitation = Array.from(this.tko_workspaceInvitations.values()).find(tko_candidate => tko_candidate.tokenHash === tko_hashInvitationToken(tko_input.token));
    if (!tko_invitation || tko_invitation.status !== "pending" || tko_invitation.expiresAt.getTime() <= Date.now()) throw new Error("TASKO_WORKSPACE_INVITATION_INVALID");
    if (tko_invitation.email !== tko_input.email) throw new Error("TASKO_WORKSPACE_INVITATION_EMAIL_MISMATCH");
    const tko_tenant = this.tko_tenants.get(tko_invitation.tenantId); if (!tko_tenant) throw new Error("TASKO_TENANT_NOT_FOUND");
    const tko_memberships = this.tko_memberships.get(tko_input.authSubject) ?? [];
    let tko_membership = tko_memberships.find(tko_member => tko_member.tenant.id === tko_tenant.id);
    if (tko_membership?.status === "suspended") throw new Error("TASKO_WORKSPACE_MEMBER_SUSPENDED");
    if (!tko_membership) { tko_membership = { id: crypto.randomUUID(), tenant: tko_tenant, authSubject: tko_input.authSubject, role: tko_invitation.role, status: "active", displayName: tko_input.displayName }; tko_memberships.push(tko_membership); this.tko_memberships.set(tko_input.authSubject, tko_memberships); }
    tko_invitation.status = "accepted"; tko_invitation.acceptedAt = new Date();
    await this.writeDurableMutation({ actor: null, tenantId: tko_tenant.id, topic: "workspace.invitation", eventType: "workspace.invitation.accepted.v1", payload: { invitationId: tko_invitation.id, memberId: tko_membership.id }, auditAction: "workspace.invitation.accepted", resourceType: "workspace_invitation", resourceId: tko_invitation.id, correlationId: tko_input.correlationId });
    return { tenant: { ...tko_tenant }, membership: { ...tko_membership, tenant: { ...tko_tenant } } };
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
      processingStartedAt: null,
      processedAt: null,
      lastError: null,
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
      tko_record.processingStartedAt = tko_now;
    }

    return tko_records.map(cloneOutbox);
  }

  async listOutbox(): Promise<OutboxRecord[]> {
    return Array.from(this.tko_outbox.values()).map(cloneOutbox);
  }

  async markOutboxProcessed(tko_outboxId: string): Promise<void> {
    const tko_record = this.tko_outbox.get(tko_outboxId);
    if (tko_record) {
      tko_record.status = "processed";
      tko_record.processedAt = new Date();
      tko_record.lastError = null;
    }
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
      tko_record.lastError = tko_error.slice(0, 1_000);
      return;
    }

    const tko_delayMs = Math.min(60_000, 250 * 2 ** tko_record.attempts);
    tko_record.status = "pending";
    tko_record.availableAt = new Date(Date.now() + tko_delayMs);
    tko_record.lastError = tko_error.slice(0, 1_000);
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

  async listTenantMembers(tko_tenantId: string, tko_options?: { includeSuspended?: boolean }): Promise<TenantMembership[]> {
    const tko_result = await this.tko_pool.query(
      `select tm.id as member_id, tm.role, tm.status as membership_status, tm.display_name,
              u.auth_subject, t.id as tenant_id, t.slug, t.name, t.status as tenant_status,
              t.deployment_profile, t.created_at
         from tenant_members tm
         join users u on u.id = tm.user_id
         join tenants t on t.id = tm.tenant_id
        where tm.tenant_id = $1
          and ($2::boolean = true or tm.status = 'active')
          and t.status = 'active'
          and tm.role <> 'service_account'
        order by tm.display_name asc, tm.id asc`,
      [tko_tenantId, tko_options?.includeSuspended ?? false],
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

  async changeTenantMemberStatus(tko_input: ChangeTenantMemberStatusInput): Promise<void> {
    const tko_client = await this.tko_pool.connect();
    try {
      await tko_client.query("BEGIN");
      await tko_client.query("select set_config('app.tenant_id', $1, true)", [tko_input.tenantId]);
      const tko_current = await tko_client.query("select status from tenant_members where id = $1 and tenant_id = $2 for update", [tko_input.memberId, tko_input.tenantId]);
      if (tko_current.rowCount !== 1) throw new Error("Tenant member not found");
      await tko_client.query("update tenant_members set status = $1 where id = $2 and tenant_id = $3", [tko_input.newStatus, tko_input.memberId, tko_input.tenantId]);
      const tko_payload = { memberId: tko_input.memberId, previousStatus: String(tko_current.rows[0].status), newStatus: tko_input.newStatus };
      await tko_client.query(`insert into audit_logs (id, tenant_id, actor_auth_subject, action, resource_type, resource_id, correlation_id, metadata_json) values (gen_random_uuid(), $1, $2, 'tenant.membership.status_changed', 'tenant_member', $3, $4, $5::jsonb)`, [tko_input.tenantId, tko_input.actor.authSubject, tko_input.memberId, tko_input.correlationId, JSON.stringify(tko_payload)]);
      await tko_client.query(`insert into outbox (id, event_id, tenant_id, topic, event_type, payload_json, actor_auth_subject, correlation_id, status, attempts, available_at) values (gen_random_uuid(), gen_random_uuid(), $1, 'tenant.membership', 'tenant.membership.status_changed.v1', $2::jsonb, $3, $4, 'pending', 0, now())`, [tko_input.tenantId, JSON.stringify(tko_payload), tko_input.actor.authSubject, tko_input.correlationId]);
      await tko_client.query("COMMIT");
    } catch (tko_error) {
      await tko_client.query("ROLLBACK");
      throw tko_error;
    } finally {
      tko_client.release();
    }
  }

  async listWorkspaceInvitations(tko_tenantId: string): Promise<WorkspaceInvitation[]> {
    const tko_client = await this.tko_pool.connect();
    try {
      await tko_client.query("BEGIN");
      await tko_client.query("select set_config('app.tenant_id', $1, true)", [tko_tenantId]);
      await tko_client.query("update workspace_invitations set status = 'expired', updated_at = now() where tenant_id = $1 and status = 'pending' and expires_at <= now()", [tko_tenantId]);
      const tko_result = await tko_client.query("select id, tenant_id, email, role, status, created_by_auth_subject, created_at, expires_at, last_sent_at, accepted_at, revoked_at from workspace_invitations where tenant_id = $1 order by created_at desc", [tko_tenantId]);
      await tko_client.query("COMMIT");
      return tko_result.rows.map(tko_mapWorkspaceInvitation);
    } catch (tko_error) {
      await tko_client.query("ROLLBACK");
      throw tko_error;
    } finally {
      tko_client.release();
    }
  }

  async listWorkspaceInvitationDeliveries(tko_tenantId: string, tko_filters?: WorkspaceInvitationDeliveryFilters): Promise<WorkspaceInvitationDelivery[]> {
    const tko_client = await this.tko_pool.connect();
    try {
      await tko_client.query("BEGIN");
      await tko_client.query("select set_config('app.tenant_id', $1, true)", [tko_tenantId]);
      await tko_client.query("update workspace_invitations set status = 'expired', updated_at = now() where tenant_id = $1 and status = 'pending' and expires_at <= now()", [tko_tenantId]);
      const tko_result = await tko_client.query(
        `with latest_delivery as (
           select distinct on ((payload_json->>'invitationId'))
                  payload_json->>'invitationId' as invitation_id,
                  status, attempts, last_error, created_at, available_at, processed_at
             from outbox
            where tenant_id = $1
              and topic = 'workspace.invitation'
              and event_type in ('workspace.invitation.issued.v1', 'workspace.invitation.resent.v1', 'workspace.invitation.delivery_retried.v1')
            order by (payload_json->>'invitationId'), created_at desc
         )
         select i.id, i.tenant_id, i.email, i.role, i.status, i.created_by_auth_subject,
                i.created_at, i.expires_at, i.last_sent_at, i.accepted_at, i.revoked_at,
                d.status as delivery_status, d.attempts as delivery_attempts,
                d.last_error as delivery_last_error, d.created_at as delivery_queued_at,
                d.available_at as delivery_next_attempt_at, d.processed_at as delivery_processed_at
           from workspace_invitations i
           left join latest_delivery d on d.invitation_id = i.id::text
          where i.tenant_id = $1
          order by i.created_at desc`,
        [tko_tenantId],
      );
      await tko_client.query("COMMIT");
      return tko_filterInvitationDeliveries(tko_result.rows.map(tko_row => {
        const tko_invitation = tko_mapWorkspaceInvitation(tko_row);
        const tko_outbox: OutboxRecord | null = tko_row.delivery_status ? {
          id: "delivery-read-model", eventId: "delivery-read-model", tenantId: tko_invitation.tenantId, topic: "workspace.invitation", eventType: "workspace.invitation.issued.v1", payload: {}, actorAuthSubject: null, correlationId: "delivery-read-model", status: String(tko_row.delivery_status) as OutboxRecord["status"], attempts: Number(tko_row.delivery_attempts), availableAt: new Date(String(tko_row.delivery_next_attempt_at)), createdAt: new Date(String(tko_row.delivery_queued_at)), processedAt: tko_row.delivery_processed_at ? new Date(String(tko_row.delivery_processed_at)) : null, lastError: tko_row.delivery_last_error ? String(tko_row.delivery_last_error) : null,
        } : null;
        return tko_invitationDeliveryFromOutbox(tko_invitation, tko_outbox);
      }), tko_filters);
    } catch (tko_error) {
      await tko_client.query("ROLLBACK");
      throw tko_error;
    } finally {
      tko_client.release();
    }
  }

  async createWorkspaceInvitation(tko_input: CreateWorkspaceInvitationInput): Promise<{ invitation: WorkspaceInvitation; token: string }> {
    const tko_client = await this.tko_pool.connect();
    const tko_token = tko_createInvitationToken();
    try {
      await tko_client.query("BEGIN");
      await tko_client.query("select set_config('app.tenant_id', $1, true)", [tko_input.tenantId]);
      await tko_client.query("update workspace_invitations set status = 'expired', updated_at = now() where tenant_id = $1 and status = 'pending' and expires_at <= now()", [tko_input.tenantId]);
      const tko_existing = await tko_client.query("select id from workspace_invitations where tenant_id = $1 and lower(email) = lower($2) and status = 'pending' for update", [tko_input.tenantId, tko_input.email]);
      if (tko_existing.rowCount) throw new Error("TASKO_WORKSPACE_INVITATION_ALREADY_PENDING");
      const tko_result = await tko_client.query(`insert into workspace_invitations (id, tenant_id, email, role, token_hash, status, created_by_auth_subject, expires_at, last_sent_at) values (gen_random_uuid(), $1, $2, $3, $4, 'pending', $5, $6, now()) returning id, tenant_id, email, role, status, created_by_auth_subject, created_at, expires_at, last_sent_at, accepted_at, revoked_at`, [tko_input.tenantId, tko_input.email, tko_input.role, tko_hashInvitationToken(tko_token), tko_input.actor.authSubject, tko_input.expiresAt]);
      const tko_invitation = tko_mapWorkspaceInvitation(tko_result.rows[0]);
      const tko_auditPayload = { invitationId: tko_invitation.id, email: tko_invitation.email, role: tko_invitation.role, expiresAt: tko_invitation.expiresAt.toISOString() };
      const tko_outboxPayload = { ...tko_auditPayload, deliveryToken: tko_token };
      await tko_client.query(`insert into audit_logs (id, tenant_id, actor_auth_subject, action, resource_type, resource_id, correlation_id, metadata_json) values (gen_random_uuid(), $1, $2, 'workspace.invitation.issued', 'workspace_invitation', $3, $4, $5::jsonb)`, [tko_input.tenantId, tko_input.actor.authSubject, tko_invitation.id, tko_input.correlationId, JSON.stringify(tko_auditPayload)]);
      await tko_client.query(`insert into outbox (id, event_id, tenant_id, topic, event_type, payload_json, actor_auth_subject, correlation_id, status, attempts, available_at) values (gen_random_uuid(), gen_random_uuid(), $1, 'workspace.invitation', 'workspace.invitation.issued.v1', $2::jsonb, $3, $4, 'pending', 0, now())`, [tko_input.tenantId, JSON.stringify(tko_outboxPayload), tko_input.actor.authSubject, tko_input.correlationId]);
      await tko_client.query("COMMIT");
      return { invitation: tko_invitation, token: tko_token };
    } catch (tko_error) {
      await tko_client.query("ROLLBACK");
      throw tko_error;
    } finally {
      tko_client.release();
    }
  }

  async resendWorkspaceInvitation(tko_input: ResendWorkspaceInvitationInput): Promise<{ invitation: WorkspaceInvitation; token: string }> {
    const tko_client = await this.tko_pool.connect();
    const tko_token = tko_createInvitationToken();
    try {
      await tko_client.query("BEGIN");
      await tko_client.query("select set_config('app.tenant_id', $1, true)", [tko_input.tenantId]);
      const tko_result = await tko_client.query(`update workspace_invitations set token_hash = $1, expires_at = $2, last_sent_at = now(), updated_at = now() where id = $3 and tenant_id = $4 and status = 'pending' and expires_at > now() returning id, tenant_id, email, role, status, created_by_auth_subject, created_at, expires_at, last_sent_at, accepted_at, revoked_at`, [tko_hashInvitationToken(tko_token), tko_input.expiresAt, tko_input.invitationId, tko_input.tenantId]);
      if (!tko_result.rowCount) throw new Error("TASKO_WORKSPACE_INVITATION_NOT_PENDING");
      const tko_invitation = tko_mapWorkspaceInvitation(tko_result.rows[0]);
      const tko_auditPayload = { invitationId: tko_invitation.id, email: tko_invitation.email, role: tko_invitation.role, expiresAt: tko_invitation.expiresAt.toISOString() };
      const tko_outboxPayload = { ...tko_auditPayload, deliveryToken: tko_token };
      await tko_client.query(`insert into audit_logs (id, tenant_id, actor_auth_subject, action, resource_type, resource_id, correlation_id, metadata_json) values (gen_random_uuid(), $1, $2, 'workspace.invitation.resent', 'workspace_invitation', $3, $4, $5::jsonb)`, [tko_input.tenantId, tko_input.actor.authSubject, tko_invitation.id, tko_input.correlationId, JSON.stringify(tko_auditPayload)]);
      await tko_client.query(`insert into outbox (id, event_id, tenant_id, topic, event_type, payload_json, actor_auth_subject, correlation_id, status, attempts, available_at) values (gen_random_uuid(), gen_random_uuid(), $1, 'workspace.invitation', 'workspace.invitation.resent.v1', $2::jsonb, $3, $4, 'pending', 0, now())`, [tko_input.tenantId, JSON.stringify(tko_outboxPayload), tko_input.actor.authSubject, tko_input.correlationId]);
      await tko_client.query("COMMIT");
      return { invitation: tko_invitation, token: tko_token };
    } catch (tko_error) {
      await tko_client.query("ROLLBACK");
      throw tko_error;
    } finally {
      tko_client.release();
    }
  }

  async retryWorkspaceInvitationDelivery(tko_input: RetryWorkspaceInvitationDeliveryInput): Promise<{ invitation: WorkspaceInvitation; token: string }> {
    const tko_client = await this.tko_pool.connect();
    const tko_token = tko_createInvitationToken();
    try {
      await tko_client.query("BEGIN");
      await tko_client.query("select set_config('app.tenant_id', $1, true)", [tko_input.tenantId]);
      const tko_invitationResult = await tko_client.query("select id, tenant_id, email, role, status, created_by_auth_subject, created_at, expires_at, last_sent_at, accepted_at, revoked_at from workspace_invitations where id = $1 and tenant_id = $2 and status = 'pending' and expires_at > now() for update", [tko_input.invitationId, tko_input.tenantId]);
      if (!tko_invitationResult.rowCount) throw new Error("TASKO_WORKSPACE_INVITATION_NOT_PENDING");
      const tko_latestDelivery = await tko_client.query("select event_id, status from outbox where tenant_id = $1 and topic = 'workspace.invitation' and event_type in ('workspace.invitation.issued.v1', 'workspace.invitation.resent.v1', 'workspace.invitation.delivery_retried.v1') and payload_json->>'invitationId' = $2 order by created_at desc limit 1 for update", [tko_input.tenantId, tko_input.invitationId]);
      if (!tko_latestDelivery.rowCount || tko_latestDelivery.rows[0].status !== "dead_letter") throw new Error("TASKO_WORKSPACE_INVITATION_DELIVERY_NOT_FAILED");
      const tko_updated = await tko_client.query("update workspace_invitations set token_hash = $1, expires_at = $2, last_sent_at = now(), updated_at = now() where id = $3 and tenant_id = $4 returning id, tenant_id, email, role, status, created_by_auth_subject, created_at, expires_at, last_sent_at, accepted_at, revoked_at", [tko_hashInvitationToken(tko_token), tko_input.expiresAt, tko_input.invitationId, tko_input.tenantId]);
      const tko_invitation = tko_mapWorkspaceInvitation(tko_updated.rows[0]);
      const tko_auditPayload = { invitationId: tko_invitation.id, email: tko_invitation.email, role: tko_invitation.role, expiresAt: tko_invitation.expiresAt.toISOString(), retryOfEventId: String(tko_latestDelivery.rows[0].event_id) };
      const tko_outboxPayload = { ...tko_auditPayload, deliveryToken: tko_token };
      await tko_client.query("insert into audit_logs (id, tenant_id, actor_auth_subject, action, resource_type, resource_id, correlation_id, metadata_json) values (gen_random_uuid(), $1, $2, 'workspace.invitation.delivery_retried', 'workspace_invitation', $3, $4, $5::jsonb)", [tko_input.tenantId, tko_input.actor.authSubject, tko_invitation.id, tko_input.correlationId, JSON.stringify(tko_auditPayload)]);
      await tko_client.query("insert into outbox (id, event_id, tenant_id, topic, event_type, payload_json, actor_auth_subject, correlation_id, status, attempts, available_at) values (gen_random_uuid(), gen_random_uuid(), $1, 'workspace.invitation', 'workspace.invitation.delivery_retried.v1', $2::jsonb, $3, $4, 'pending', 0, now())", [tko_input.tenantId, JSON.stringify(tko_outboxPayload), tko_input.actor.authSubject, tko_input.correlationId]);
      await tko_client.query("COMMIT");
      return { invitation: tko_invitation, token: tko_token };
    } catch (tko_error) {
      await tko_client.query("ROLLBACK");
      throw tko_error;
    } finally {
      tko_client.release();
    }
  }

  async revokeWorkspaceInvitation(tko_input: RevokeWorkspaceInvitationInput): Promise<void> {
    const tko_client = await this.tko_pool.connect();
    try {
      await tko_client.query("BEGIN");
      await tko_client.query("select set_config('app.tenant_id', $1, true)", [tko_input.tenantId]);
      const tko_result = await tko_client.query("update workspace_invitations set status = 'revoked', revoked_at = now(), updated_at = now() where id = $1 and tenant_id = $2 and status = 'pending' returning email", [tko_input.invitationId, tko_input.tenantId]);
      if (!tko_result.rowCount) throw new Error("TASKO_WORKSPACE_INVITATION_NOT_PENDING");
      const tko_payload = { invitationId: tko_input.invitationId, email: String(tko_result.rows[0].email) };
      await tko_client.query(`insert into audit_logs (id, tenant_id, actor_auth_subject, action, resource_type, resource_id, correlation_id, metadata_json) values (gen_random_uuid(), $1, $2, 'workspace.invitation.revoked', 'workspace_invitation', $3, $4, $5::jsonb)`, [tko_input.tenantId, tko_input.actor.authSubject, tko_input.invitationId, tko_input.correlationId, JSON.stringify(tko_payload)]);
      await tko_client.query(`insert into outbox (id, event_id, tenant_id, topic, event_type, payload_json, actor_auth_subject, correlation_id, status, attempts, available_at) values (gen_random_uuid(), gen_random_uuid(), $1, 'workspace.invitation', 'workspace.invitation.revoked.v1', $2::jsonb, $3, $4, 'pending', 0, now())`, [tko_input.tenantId, JSON.stringify(tko_payload), tko_input.actor.authSubject, tko_input.correlationId]);
      await tko_client.query("COMMIT");
    } catch (tko_error) {
      await tko_client.query("ROLLBACK");
      throw tko_error;
    } finally {
      tko_client.release();
    }
  }

  async redeemWorkspaceInvitation(tko_input: RedeemWorkspaceInvitationInput): Promise<{ tenant: Tenant; membership: TenantMembership }> {
    const tko_client = await this.tko_pool.connect();
    try {
      await tko_client.query("BEGIN");
      const tko_invitationResult = await tko_client.query("select id, tenant_id, email, role, status, created_by_auth_subject, created_at, expires_at, last_sent_at, accepted_at, revoked_at from workspace_invitations where token_hash = $1 for update", [tko_hashInvitationToken(tko_input.token)]);
      if (tko_invitationResult.rowCount !== 1) throw new Error("TASKO_WORKSPACE_INVITATION_INVALID");
      const tko_invitation = tko_mapWorkspaceInvitation(tko_invitationResult.rows[0]);
      await tko_client.query("select set_config('app.tenant_id', $1, true)", [tko_invitation.tenantId]);
      if (tko_invitation.status !== "pending" || tko_invitation.expiresAt.getTime() <= Date.now()) throw new Error("TASKO_WORKSPACE_INVITATION_INVALID");
      if (!tko_input.email || tko_invitation.email.toLowerCase() !== tko_input.email.toLowerCase()) throw new Error("TASKO_WORKSPACE_INVITATION_EMAIL_MISMATCH");
      const tko_tenantResult = await tko_client.query("select id, slug, name, status, deployment_profile, created_at from tenants where id = $1", [tko_invitation.tenantId]);
      if (tko_tenantResult.rowCount !== 1) throw new Error("TASKO_TENANT_NOT_FOUND");
      const tko_tenant = tko_mapTenant(tko_tenantResult.rows[0]);
      const tko_user = await tko_client.query(`insert into users (id, auth_subject, email, display_name, status) values (gen_random_uuid(), $1, $2, $3, 'active') on conflict (auth_subject) do update set email = coalesce(users.email, excluded.email), display_name = coalesce(excluded.display_name, users.display_name), status = 'active' returning id`, [tko_input.authSubject, tko_input.email, tko_input.displayName]);
      const tko_existing = await tko_client.query("select id, role, status, display_name from tenant_members where tenant_id = $1 and user_id = $2 for update", [tko_tenant.id, tko_user.rows[0].id]);
      if (tko_existing.rowCount && String(tko_existing.rows[0].status) === "suspended") throw new Error("TASKO_WORKSPACE_MEMBER_SUSPENDED");
      const tko_memberResult = tko_existing.rowCount
        ? tko_existing
        : await tko_client.query("insert into tenant_members (id, tenant_id, user_id, role, status, display_name) values (gen_random_uuid(), $1, $2, $3, 'active', $4) returning id, role, status, display_name", [tko_tenant.id, tko_user.rows[0].id, tko_invitation.role, tko_input.displayName]);
      await tko_client.query("update workspace_invitations set status = 'accepted', accepted_at = now(), accepted_by_auth_subject = $1, updated_at = now() where id = $2 and tenant_id = $3", [tko_input.authSubject, tko_invitation.id, tko_tenant.id]);
      const tko_payload = { invitationId: tko_invitation.id, memberId: String(tko_memberResult.rows[0].id) };
      await tko_client.query(`insert into audit_logs (id, tenant_id, actor_auth_subject, action, resource_type, resource_id, correlation_id, metadata_json) values (gen_random_uuid(), $1, $2, 'workspace.invitation.accepted', 'workspace_invitation', $3, $4, $5::jsonb)`, [tko_tenant.id, tko_input.authSubject, tko_invitation.id, tko_input.correlationId, JSON.stringify(tko_payload)]);
      await tko_client.query(`insert into outbox (id, event_id, tenant_id, topic, event_type, payload_json, actor_auth_subject, correlation_id, status, attempts, available_at) values (gen_random_uuid(), gen_random_uuid(), $1, 'workspace.invitation', 'workspace.invitation.accepted.v1', $2::jsonb, $3, $4, 'pending', 0, now())`, [tko_tenant.id, JSON.stringify(tko_payload), tko_input.authSubject, tko_input.correlationId]);
      await tko_client.query("COMMIT");
      return { tenant: tko_tenant, membership: { id: String(tko_memberResult.rows[0].id), tenant: tko_tenant, authSubject: tko_input.authSubject, role: String(tko_memberResult.rows[0].role) as TenantRole, status: String(tko_memberResult.rows[0].status) as TenantMembership["status"], displayName: String(tko_memberResult.rows[0].display_name) } };
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
