import { beforeEach, describe, expect, it } from "vitest";
import type { PlatformActor } from "../../packages/contracts/src/platform";
import { MemoryPlatformStore, setPlatformStoreForTests } from "../../packages/database/src/platform-store";
import * as tko_membership from "./src/workspace-membership-service";

const tko_primaryTenantId = "tko-tenant-tasko-demo";

function tko_actor(tko_overrides: Partial<PlatformActor> = {}): PlatformActor {
  return {
    authSubject: "workspace-owner",
    tenantId: tko_primaryTenantId,
    tenantSlug: "tasko-demo",
    memberId: "tko-member-demo-owner",
    role: "owner",
    membershipStatus: "active",
    correlationId: "workspace-membership-test",
    ...tko_overrides,
  };
}

describe("Workspace membership and email invitation", () => {
  let tko_store: MemoryPlatformStore;

  beforeEach(async () => {
    tko_store = new MemoryPlatformStore();
    setPlatformStoreForTests(tko_store);
    await tko_store.seedDemoWorkspace({ ownerAuthSubject: "workspace-owner", tenantSlug: "tasko-demo" });
  });

  it("issues, resends, accepts and audits a single-use email invitation", async () => {
    const tko_owner = tko_actor();
    const tko_initial = await tko_membership.createWorkspaceInvitation({ actor: tko_owner, email: "new.member@example.test", role: "member", correlationId: "workspace-invite-issued" });
    expect(tko_initial.invitation).toMatchObject({ tenantId: tko_primaryTenantId, email: "new.member@example.test", role: "member", status: "pending" });
    expect(tko_initial.token).toHaveLength(43);

    const tko_resent = await tko_membership.resendWorkspaceInvitation({ actor: tko_owner, invitationId: tko_initial.invitation.id, correlationId: "workspace-invite-resent" });
    expect(tko_resent.token).not.toBe(tko_initial.token);
    await expect(tko_membership.redeemWorkspaceInvitation({ authSubject: "new-member", email: "new.member@example.test", displayName: "New member", token: tko_initial.token, correlationId: "workspace-invite-old-token" })).rejects.toThrow("TASKO_WORKSPACE_INVITATION_INVALID");

    const tko_accepted = await tko_membership.redeemWorkspaceInvitation({ authSubject: "new-member", email: "new.member@example.test", displayName: "New member", token: tko_resent.token, correlationId: "workspace-invite-accepted" });
    expect(tko_accepted.membership).toMatchObject({ tenant: { id: tko_primaryTenantId }, authSubject: "new-member", role: "member", status: "active" });
    await expect(tko_membership.redeemWorkspaceInvitation({ authSubject: "new-member", email: "new.member@example.test", displayName: "New member", token: tko_resent.token, correlationId: "workspace-invite-replay" })).rejects.toThrow("TASKO_WORKSPACE_INVITATION_INVALID");

    expect(await tko_membership.listWorkspaceInvitations(tko_owner)).toEqual(expect.arrayContaining([expect.objectContaining({ id: tko_initial.invitation.id, status: "accepted" })]));
    expect((await tko_store.listAuditLogs()).map(tko_entry => tko_entry.action)).toEqual(expect.arrayContaining(["workspace.invitation.issued", "workspace.invitation.resent", "workspace.invitation.accepted"]));
    expect((await tko_store.listOutbox()).map(tko_entry => tko_entry.eventType)).toEqual(expect.arrayContaining(["workspace.invitation.issued.v1", "workspace.invitation.resent.v1", "workspace.invitation.accepted.v1"]));
    const tko_issuedEvent = (await tko_store.listOutbox()).find(tko_entry => tko_entry.eventType === "workspace.invitation.issued.v1");
    const tko_resentEvent = (await tko_store.listOutbox()).find(tko_entry => tko_entry.eventType === "workspace.invitation.resent.v1");
    expect(tko_issuedEvent?.payload.deliveryToken).toBe(tko_initial.token);
    expect(tko_resentEvent?.payload.deliveryToken).toBe(tko_resent.token);
    expect(JSON.stringify(await tko_store.listAuditLogs())).not.toContain(tko_initial.token);
    expect(JSON.stringify(await tko_store.listAuditLogs())).not.toContain(tko_resent.token);
  });

  it("exposes invitation delivery telemetry without exposing one-time tokens", async () => {
    const tko_owner = tko_actor();
    const tko_invite = await tko_membership.createWorkspaceInvitation({ actor: tko_owner, email: "delivery@example.test", role: "member", correlationId: "workspace-delivery-read" });
    const tko_delivery = await tko_membership.listWorkspaceInvitationDeliveries(tko_owner);
    expect(tko_delivery).toEqual(expect.arrayContaining([expect.objectContaining({ invitationId: tko_invite.invitation.id, email: "delivery@example.test", deliveryStatus: "queued", attempts: 0 })]));
    expect(JSON.stringify(tko_delivery)).not.toContain(tko_invite.token);

    const tko_guest = tko_actor({ authSubject: "workspace-guest", memberId: "tko-member-demo-guest", role: "guest" });
    await expect(tko_membership.listWorkspaceInvitationDeliveries(tko_guest)).rejects.toThrow("AUTHORIZATION_DENIED");
  });

  it("filters delivery telemetry and queues a fresh token only when a failed pending invitation is manually retried", async () => {
    const tko_owner = tko_actor();
    const tko_invite = await tko_membership.createWorkspaceInvitation({ actor: tko_owner, email: "retry@example.test", role: "member", correlationId: "workspace-delivery-retry-issued" });
    const tko_issued = (await tko_store.listOutbox()).find(tko_event => tko_event.eventType === "workspace.invitation.issued.v1" && tko_event.payload.invitationId === tko_invite.invitation.id);
    expect(tko_issued).toBeDefined();
    await tko_store.rescheduleOutbox(tko_issued!.id, "Resend delivery failed", 0);

    const tko_failed = await tko_membership.listWorkspaceInvitationDeliveries(tko_owner, { status: "failed", dateRange: "30d" });
    expect(tko_failed).toEqual([expect.objectContaining({ invitationId: tko_invite.invitation.id, deliveryStatus: "failed", lastError: "Resend delivery failed" })]);
    expect(await tko_membership.listWorkspaceInvitationDeliveries(tko_owner, { status: "sent" })).toEqual([]);

    const tko_retried = await tko_membership.retryWorkspaceInvitationDelivery({ actor: tko_owner, invitationId: tko_invite.invitation.id, correlationId: "workspace-delivery-retry-manual" });
    expect(tko_retried.token).not.toBe(tko_invite.token);
    const tko_afterRetry = await tko_membership.listWorkspaceInvitationDeliveries(tko_owner, { status: "queued" });
    expect(tko_afterRetry).toEqual(expect.arrayContaining([expect.objectContaining({ invitationId: tko_invite.invitation.id, deliveryStatus: "queued", attempts: 0 })]));
    expect((await tko_store.listAuditLogs()).map(tko_entry => tko_entry.action)).toContain("workspace.invitation.delivery_retried");
    expect(JSON.stringify(await tko_membership.listWorkspaceInvitationDeliveries(tko_owner))).not.toContain(tko_retried.token);

    await expect(tko_membership.retryWorkspaceInvitationDelivery({ actor: tko_owner, invitationId: tko_invite.invitation.id, correlationId: "workspace-delivery-retry-twice" })).rejects.toThrow("DELIVERY_NOT_FAILED");
    const tko_guest = tko_actor({ authSubject: "workspace-guest", memberId: "tko-member-demo-guest", role: "guest" });
    await expect(tko_membership.retryWorkspaceInvitationDelivery({ actor: tko_guest, invitationId: tko_invite.invitation.id, correlationId: "workspace-delivery-retry-guest" })).rejects.toThrow("AUTHORIZATION_DENIED");
  });

  it("allows an owner to manage a non-owner member state and role with durable history", async () => {
    const tko_owner = tko_actor();
    const tko_invite = await tko_membership.createWorkspaceInvitation({ actor: tko_owner, email: "operator@example.test", role: "guest", correlationId: "workspace-member-create" });
    const tko_accepted = await tko_membership.redeemWorkspaceInvitation({ authSubject: "operator", email: "operator@example.test", displayName: "Operator", token: tko_invite.token, correlationId: "workspace-member-accept" });

    await tko_membership.changeWorkspaceMemberRole({ actor: tko_owner, memberId: tko_accepted.membership.id, newRole: "member", correlationId: "workspace-member-role" });
    await tko_membership.changeWorkspaceMemberStatus({ actor: tko_owner, memberId: tko_accepted.membership.id, newStatus: "suspended", correlationId: "workspace-member-suspend" });
    expect(await tko_membership.listWorkspaceMembers(tko_owner)).toEqual(expect.arrayContaining([expect.objectContaining({ id: tko_accepted.membership.id, role: "member", status: "suspended" })]));
    expect((await tko_store.listAuditLogs()).map(tko_entry => tko_entry.action)).toEqual(expect.arrayContaining(["tenant.membership.role_changed", "tenant.membership.status_changed"]));
  });

  it("denies guest management, admin escalation and tenant cross-read", async () => {
    const tko_guest = tko_actor({ authSubject: "workspace-guest", memberId: "tko-member-demo-guest", role: "guest" });
    await expect(tko_membership.listWorkspaceMembers(tko_guest)).rejects.toThrow("AUTHORIZATION_DENIED");

    const tko_admin = tko_actor({ authSubject: "demo-admin:tasko-demo", memberId: "tko-member-demo-admin", role: "admin" });
    await expect(tko_membership.createWorkspaceInvitation({ actor: tko_admin, email: "admin@example.test", role: "admin", correlationId: "workspace-admin-escalation" })).rejects.toThrow("TASKO_WORKSPACE_ROLE_ESCALATION_DENIED");

    const tko_other = await tko_store.seedDemoWorkspace({ ownerAuthSubject: "other-owner", tenantSlug: "other-workspace" });
    const tko_otherOwner = tko_actor({ authSubject: "other-owner", tenantId: tko_other.id, tenantSlug: tko_other.slug, memberId: "tko-member-demo-owner", role: "owner" });
    expect(await tko_membership.listWorkspaceInvitations(tko_otherOwner)).toEqual([]);
  });
});
