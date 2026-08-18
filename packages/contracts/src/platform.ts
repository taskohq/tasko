export type DeploymentProfile = "single_tenant" | "saas";

export type TenantRole = "owner" | "admin" | "member" | "guest" | "service_account";

export type MembershipStatus = "active" | "suspended" | "invited";

export type OutboxStatus = "pending" | "processing" | "processed" | "dead_letter";

export type Capability =
  | "workspace.read"
  | "workspace.settings.manage"
  | "workspace.members.manage"
  | "workspace.audit.read"
  | "attachment.upload"
  | "attachment.download"
  | "realtime.connect"
  | "job.enqueue"
  | "job.process"
  | "work.space.read"
  | "work.space.manage"
  | "work.project.read"
  | "work.project.manage"
  | "work.item.read"
  | "work.item.create"
  | "work.item.update"
  | "work.item.transition"
  | "work.item.archive"
  | "work.comment.create"
  | "work.comment.moderate"
  | "work.sprint.manage"
  | "work.view.manage"
  | "work.custom_field.manage";

export interface Tenant {
  id: string;
  slug: string;
  name: string;
  status: "active" | "suspended";
  deploymentProfile: DeploymentProfile;
  createdAt: Date;
}

export interface TenantMembership {
  id: string;
  tenant: Tenant;
  authSubject: string;
  role: TenantRole;
  status: MembershipStatus;
  displayName: string;
}

export interface PlatformActor {
  authSubject: string;
  tenantId: string;
  tenantSlug: string;
  memberId: string;
  role: TenantRole;
  membershipStatus: MembershipStatus;
  correlationId: string;
}

export interface TenantResource {
  tenantId: string;
  type: string;
  id: string;
  visibility?: "internal" | "private" | "guest_shared";
  explicitMemberIds?: readonly string[];
}

export interface AuthorizationDecision {
  allowed: boolean;
  reason:
    | "allowed"
    | "actor_inactive"
    | "tenant_mismatch"
    | "capability_missing"
    | "private_resource"
    | "guest_scope_missing";
}

export interface OutboxRecord {
  id: string;
  eventId: string;
  tenantId: string;
  topic: string;
  eventType: string;
  payload: Record<string, unknown>;
  actorAuthSubject: string | null;
  correlationId: string;
  status: OutboxStatus;
  attempts: number;
  availableAt: Date;
  createdAt: Date;
}

export interface AuditLogRecord {
  id: string;
  tenantId: string;
  actorAuthSubject: string | null;
  action: string;
  resourceType: string;
  resourceId: string;
  correlationId: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

export interface DurableMutationInput {
  actor: PlatformActor | null;
  tenantId: string;
  eventType: string;
  topic: string;
  payload: Record<string, unknown>;
  auditAction: string;
  resourceType: string;
  resourceId: string;
  auditMetadata?: Record<string, unknown>;
  correlationId: string;
}

export interface ChangeTenantMemberRoleInput {
  actor: PlatformActor;
  tenantId: string;
  memberId: string;
  newRole: Exclude<TenantRole, "service_account">;
  correlationId: string;
}
