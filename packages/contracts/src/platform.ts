export type DeploymentProfile = "single_tenant" | "saas";

export type TenantRole = "owner" | "admin" | "member" | "guest" | "service_account";

export type MembershipStatus = "active" | "suspended" | "invited";

export type WorkspaceInvitationStatus = "pending" | "accepted" | "revoked" | "expired";

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
  | "work.custom_field.manage"
  | "chat.channel.read"
  | "chat.channel.manage"
  | "chat.message.read"
  | "chat.message.send"
  | "chat.message.edit_own"
  | "chat.message.delete_own"
  | "chat.message.moderate"
  | "chat.reaction.toggle"
  | "chat.read_cursor.update"
  | "chat.notification.manage"
  | "chat.saved_message.manage"
  | "chat.search"
  | "crm.read"
  | "crm.lead.manage"
  | "crm.lead.convert"
  | "crm.company.manage"
  | "crm.contact.manage"
  | "crm.pipeline.manage"
  | "crm.deal.manage"
  | "crm.activity.manage"
  | "crm.follow_up.create"
  | "crm.deal.handoff"
  | "workspace.search"
  | "workspace.inbox.manage"
  | "workspace.link.manage"
  | "workspace.document.read"
  | "workspace.document.manage"
  | "workspace.form.read"
  | "workspace.form.manage"
  | "workspace.form.submit"
  | "workspace.automation.manage"
  | "saas.entitlement.read"
  | "saas.entitlement.manage"
  | "saas.usage.read"
  | "saas.billing.manage"
  | "saas.backup.manage"
  | "saas.restore.manage"
  | "saas.metrics.read"
  | "ecosystem.import.read"
  | "ecosystem.import.manage"
  | "ecosystem.api_token.manage"
  | "ecosystem.webhook.manage"
  | "ecosystem.integration.manage"
  | "ai.context.read"
  | "ai.draft.create"
  | "ai.action.propose"
  | "ai.action.confirm"
  | "mcp.connect";

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

export interface WorkspaceInvitation {
  id: string;
  tenantId: string;
  email: string;
  role: Exclude<TenantRole, "service_account" | "owner">;
  status: WorkspaceInvitationStatus;
  createdByAuthSubject: string;
  createdAt: Date;
  expiresAt: Date;
  lastSentAt: Date;
  acceptedAt: Date | null;
  revokedAt: Date | null;
}

export type WorkspaceInvitationDeliveryStatus = "queued" | "processing" | "sent" | "retrying" | "failed" | "unavailable";
export type WorkspaceInvitationDeliveryDateRange = "7d" | "30d" | "90d" | "all";

export interface WorkspaceInvitationDeliveryFilters {
  status?: WorkspaceInvitationDeliveryStatus;
  dateRange?: WorkspaceInvitationDeliveryDateRange;
}

export interface WorkspaceInvitationDelivery {
  invitationId: string;
  email: string;
  role: WorkspaceInvitation["role"];
  invitationStatus: WorkspaceInvitation["status"];
  lastSentAt: Date;
  deliveryStatus: WorkspaceInvitationDeliveryStatus;
  attempts: number;
  lastError: string | null;
  queuedAt: Date | null;
  nextAttemptAt: Date | null;
  deliveredAt: Date | null;
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
  projectMemberRole?: "viewer" | "editor";
}

export interface AuthorizationDecision {
  allowed: boolean;
  reason:
    | "allowed"
    | "actor_inactive"
    | "tenant_mismatch"
    | "capability_missing"
    | "private_resource"
    | "guest_scope_missing"
    | "project_role_read_only";
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
  processingStartedAt?: Date | null;
  processedAt?: Date | null;
  lastError?: string | null;
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

export interface ChangeTenantMemberStatusInput {
  actor: PlatformActor;
  tenantId: string;
  memberId: string;
  newStatus: Extract<MembershipStatus, "active" | "suspended">;
  correlationId: string;
}

export interface CreateWorkspaceInvitationInput {
  actor: PlatformActor;
  tenantId: string;
  email: string;
  role: WorkspaceInvitation["role"];
  correlationId: string;
  expiresAt: Date;
}

export interface ResendWorkspaceInvitationInput {
  actor: PlatformActor;
  tenantId: string;
  invitationId: string;
  correlationId: string;
  expiresAt: Date;
}

export interface RetryWorkspaceInvitationDeliveryInput {
  actor: PlatformActor;
  tenantId: string;
  invitationId: string;
  correlationId: string;
  expiresAt: Date;
}

export interface RevokeWorkspaceInvitationInput {
  actor: PlatformActor;
  tenantId: string;
  invitationId: string;
  correlationId: string;
}

export interface RedeemWorkspaceInvitationInput {
  authSubject: string;
  email: string | null;
  displayName: string;
  token: string;
  correlationId: string;
}
