import type { PlatformActor, TenantMembership, TenantRole, WorkspaceInvitation } from "../../../packages/contracts/src/platform";
import { getPlatformStore } from "../../../packages/database/src/platform-store";
import { requireCapability } from "../../permissions/src/authorization";

const tko_invitationLifetimeMs = 7 * 24 * 60 * 60 * 1000;
type TkoInviteRole = Exclude<TenantRole, "service_account" | "owner">;

function tko_requireManager(tko_actor: PlatformActor, tko_resourceId: string) {
  requireCapability(tko_actor, "workspace.members.manage", {
    tenantId: tko_actor.tenantId,
    type: "workspace_member",
    id: tko_resourceId,
    visibility: "internal",
  });
}

function tko_assertRoleChangeAllowed(tko_actor: PlatformActor, tko_member: TenantMembership, tko_nextRole: TenantRole) {
  if (tko_member.id === tko_actor.memberId) throw new Error("TASKO_WORKSPACE_SELF_MANAGEMENT_DENIED");
  if (tko_member.role === "owner" && tko_actor.role !== "owner") throw new Error("TASKO_WORKSPACE_OWNER_PROTECTED");
  if ((tko_nextRole === "owner" || tko_nextRole === "admin") && tko_actor.role !== "owner") throw new Error("TASKO_WORKSPACE_ROLE_ESCALATION_DENIED");
}

async function tko_memberById(tko_actor: PlatformActor, tko_memberId: string): Promise<TenantMembership> {
  const tko_member = (await getPlatformStore().listTenantMembers(tko_actor.tenantId)).find(tko_candidate => tko_candidate.id === tko_memberId);
  if (!tko_member) throw new Error("TASKO_WORKSPACE_MEMBER_NOT_FOUND");
  return tko_member;
}

export async function listWorkspaceMembers(tko_actor: PlatformActor) {
  tko_requireManager(tko_actor, "workspace-members");
  return getPlatformStore().listTenantMembers(tko_actor.tenantId, { includeSuspended: true });
}

export async function listWorkspaceInvitations(tko_actor: PlatformActor) {
  tko_requireManager(tko_actor, "workspace-invitations");
  return getPlatformStore().listWorkspaceInvitations(tko_actor.tenantId);
}

export async function createWorkspaceInvitation(tko_input: { actor: PlatformActor; email: string; role: TkoInviteRole; correlationId: string }) {
  tko_requireManager(tko_input.actor, "workspace-invitation-create");
  if (tko_input.actor.role !== "owner" && tko_input.role === "admin") throw new Error("TASKO_WORKSPACE_ROLE_ESCALATION_DENIED");
  return getPlatformStore().createWorkspaceInvitation({
    actor: tko_input.actor,
    tenantId: tko_input.actor.tenantId,
    email: tko_input.email.trim().toLowerCase(),
    role: tko_input.role,
    correlationId: tko_input.correlationId,
    expiresAt: new Date(Date.now() + tko_invitationLifetimeMs),
  });
}

export async function resendWorkspaceInvitation(tko_input: { actor: PlatformActor; invitationId: string; correlationId: string }) {
  tko_requireManager(tko_input.actor, tko_input.invitationId);
  return getPlatformStore().resendWorkspaceInvitation({
    actor: tko_input.actor,
    tenantId: tko_input.actor.tenantId,
    invitationId: tko_input.invitationId,
    correlationId: tko_input.correlationId,
    expiresAt: new Date(Date.now() + tko_invitationLifetimeMs),
  });
}

export async function revokeWorkspaceInvitation(tko_input: { actor: PlatformActor; invitationId: string; correlationId: string }): Promise<void> {
  tko_requireManager(tko_input.actor, tko_input.invitationId);
  await getPlatformStore().revokeWorkspaceInvitation({ actor: tko_input.actor, tenantId: tko_input.actor.tenantId, invitationId: tko_input.invitationId, correlationId: tko_input.correlationId });
}

export async function changeWorkspaceMemberRole(tko_input: { actor: PlatformActor; memberId: string; newRole: Exclude<TenantRole, "service_account">; correlationId: string }): Promise<void> {
  tko_requireManager(tko_input.actor, tko_input.memberId);
  const tko_member = await tko_memberById(tko_input.actor, tko_input.memberId);
  tko_assertRoleChangeAllowed(tko_input.actor, tko_member, tko_input.newRole);
  await getPlatformStore().changeTenantMemberRole({ actor: tko_input.actor, tenantId: tko_input.actor.tenantId, memberId: tko_input.memberId, newRole: tko_input.newRole, correlationId: tko_input.correlationId });
}

export async function changeWorkspaceMemberStatus(tko_input: { actor: PlatformActor; memberId: string; newStatus: "active" | "suspended"; correlationId: string }): Promise<void> {
  tko_requireManager(tko_input.actor, tko_input.memberId);
  const tko_member = await tko_memberById(tko_input.actor, tko_input.memberId);
  tko_assertRoleChangeAllowed(tko_input.actor, tko_member, tko_member.role);
  await getPlatformStore().changeTenantMemberStatus({ actor: tko_input.actor, tenantId: tko_input.actor.tenantId, memberId: tko_input.memberId, newStatus: tko_input.newStatus, correlationId: tko_input.correlationId });
}

export async function redeemWorkspaceInvitation(tko_input: { authSubject: string; email: string | null; displayName: string; token: string; correlationId: string }) {
  if (!tko_input.email) throw new Error("TASKO_WORKSPACE_INVITATION_EMAIL_REQUIRED");
  return getPlatformStore().redeemWorkspaceInvitation({ ...tko_input, email: tko_input.email.trim().toLowerCase(), displayName: tko_input.displayName.trim() || "Tasko member" });
}

export type { WorkspaceInvitation };
