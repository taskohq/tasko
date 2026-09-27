import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PlatformActor, TenantMembership } from "../../packages/contracts/src/platform";
import { MemoryPlatformStore, getPlatformStore, setPlatformStoreForTests } from "../../packages/database/src/platform-store";
import {
  MemoryTeamStore,
  createTeam,
  addTeamMember,
  deleteTeam,
  getTeamStore,
  listMyTeams,
  listTenantTeams,
  removeTeamMember,
  renameTeam,
  setTeamStoreForTests,
} from "./src/team-service";

function tko_actorFromMembership(tko_membership: TenantMembership): PlatformActor {
  return {
    authSubject: tko_membership.authSubject,
    tenantId: tko_membership.tenant.id,
    tenantSlug: tko_membership.tenant.slug,
    memberId: tko_membership.id,
    role: tko_membership.role,
    membershipStatus: tko_membership.status,
    correlationId: "test-corr",
  };
}

async function tko_provisionWorkspace(tko_input: { ownerEmail: string; ownerDisplayName: string; slug: string }) {
  const tko_store = getPlatformStore();
  const tko_provisioned = await tko_store.provisionTenant({
    name: `${tko_input.ownerDisplayName} Workspace`,
    slug: tko_input.slug,
    ownerAuthSubject: `email:${tko_input.ownerEmail}`,
    ownerDisplayName: tko_input.ownerDisplayName,
    planKey: "starter",
    idempotencyKey: `test:${tko_input.slug}`,
    correlationId: "test-corr",
  });
  const tko_ownerMembership = (await tko_store.listMemberships(`email:${tko_input.ownerEmail}`)).find(
    tko_membership => tko_membership.tenant.id === tko_provisioned.tenant.id && tko_membership.status === "active",
  );
  if (!tko_ownerMembership) throw new Error("owner membership missing");
  return { tenant: tko_provisioned.tenant, owner: tko_actorFromMembership(tko_ownerMembership), ownerMembership: tko_ownerMembership };
}

async function tko_inviteMember(tko_input: { owner: PlatformActor; tenantId: string; memberEmail: string; memberSubject: string }) {
  const tko_store = getPlatformStore();
  const tko_invitation = await tko_store.createWorkspaceInvitation({
    actor: tko_input.owner,
    tenantId: tko_input.tenantId,
    email: tko_input.memberEmail,
    role: "member",
    correlationId: "test-corr",
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  });
  await tko_store.redeemWorkspaceInvitation({
    authSubject: tko_input.memberSubject,
    email: tko_input.memberEmail,
    displayName: "Team Member",
    token: tko_invitation.token,
    correlationId: "test-corr",
  });
  const tko_membership = (await tko_store.listMemberships(tko_input.memberSubject)).find(
    tko_membership => tko_membership.tenant.id === tko_input.tenantId && tko_membership.status === "active",
  );
  if (!tko_membership) throw new Error("member membership missing");
  return tko_actorFromMembership(tko_membership);
}

describe("team service", () => {
  let tko_workspace: Awaited<ReturnType<typeof tko_provisionWorkspace>>;
  let tko_member: PlatformActor;

  beforeEach(async () => {
    setPlatformStoreForTests(new MemoryPlatformStore());
    setTeamStoreForTests(new MemoryTeamStore());
    tko_workspace = await tko_provisionWorkspace({ ownerEmail: "owner@test.dev", ownerDisplayName: "Owner", slug: `ws-${Date.now()}` });
    tko_member = await tko_inviteMember({
      owner: tko_workspace.owner,
      tenantId: tko_workspace.tenant.id,
      memberEmail: "member@test.dev",
      memberSubject: "email:member@test.dev",
    });
  });

  afterEach(() => {
    setPlatformStoreForTests(null);
    setTeamStoreForTests(null);
  });

  it("creates a team, enrolls the creator and emits team.created.v1 with an audit entry", async () => {
    const tko_team = await createTeam(tko_workspace.owner, { name: "Platform Crew", correlationId: "test-create" });
    expect(tko_team.name).toBe("Platform Crew");
    expect(tko_team.handle).toMatch(/^platform-crew-[0-9a-f]{6}$/);
    const tko_members = await getTeamStore().listTeamMembers(tko_workspace.tenant.id, tko_team.id);
    expect(tko_members.map(tko_item => tko_item.authSubject)).toEqual([tko_workspace.owner.authSubject]);
    const tko_events = (await getPlatformStore().listOutbox()).filter(tko_event => tko_event.eventType === "team.created.v1");
    expect(tko_events).toHaveLength(1);
    expect((await getPlatformStore().listAuditLogs()).some(tko_log => tko_log.action === "team.create")).toBe(true);
  });

  it("denies team management to non-privileged members", async () => {
    await expect(createTeam(tko_member, { name: "Shadow Team", correlationId: "test-denied" })).rejects.toThrow(
      "TASKO_AUTHORIZATION_DENIED:capability_missing",
    );
    const tko_team = await createTeam(tko_workspace.owner, { name: "Real Team", correlationId: "test-real" });
    await expect(renameTeam(tko_member, { teamId: tko_team.id, name: "Hijacked", correlationId: "test-denied" })).rejects.toThrow(
      "TASKO_AUTHORIZATION_DENIED",
    );
    await expect(deleteTeam(tko_member, { teamId: tko_team.id, correlationId: "test-denied" })).rejects.toThrow(
      "TASKO_AUTHORIZATION_DENIED",
    );
    await expect(
      addTeamMember(tko_member, { teamId: tko_team.id, authSubject: tko_member.authSubject, correlationId: "test-denied" }),
    ).rejects.toThrow("TASKO_AUTHORIZATION_DENIED");
    await expect(
      removeTeamMember(tko_member, { teamId: tko_team.id, authSubject: tko_workspace.owner.authSubject, correlationId: "test-denied" }),
    ).rejects.toThrow("TASKO_AUTHORIZATION_DENIED");
    await expect(listTenantTeams(tko_member)).rejects.toThrow("TASKO_AUTHORIZATION_DENIED"); // capability-gated listing
  });

  it("renames and deletes teams with audit events, and rejects unknown teams", async () => {
    const tko_team = await createTeam(tko_workspace.owner, { name: "Old Name", correlationId: "test-rename" });
    const tko_renamed = await renameTeam(tko_workspace.owner, { teamId: tko_team.id, name: "New Name", correlationId: "test-rename" });
    expect(tko_renamed.name).toBe("New Name");
    expect((await getPlatformStore().listOutbox()).some(tko_event => tko_event.eventType === "team.updated.v1")).toBe(true);

    await expect(
      renameTeam(tko_workspace.owner, { teamId: "00000000-0000-4000-8000-000000000000", name: "Ghost", correlationId: "test-rename" }),
    ).rejects.toThrow("TASKO_TEAM_NOT_FOUND");

    const tko_deleted = await deleteTeam(tko_workspace.owner, { teamId: tko_team.id, correlationId: "test-delete" });
    expect(tko_deleted.teamId).toBe(tko_team.id);
    expect((await getPlatformStore().listOutbox()).some(tko_event => tko_event.eventType === "team.deleted.v1")).toBe(true);
    expect(await getTeamStore().getTeamById(tko_workspace.tenant.id, tko_team.id)).toBeNull();
  });

  it("adds and removes workspace members, refusing outsiders", async () => {
    const tko_team = await createTeam(tko_workspace.owner, { name: "Squad", correlationId: "test-squad" });
    expect(
      (await addTeamMember(tko_workspace.owner, { teamId: tko_team.id, authSubject: tko_member.authSubject, correlationId: "test-squad" })).added,
    ).toBe(true);
    expect((await getTeamStore().listTeamMembers(tko_workspace.tenant.id, tko_team.id)).map(tko_item => tko_item.authSubject)).toContain(
      tko_member.authSubject,
    );
    expect((await getPlatformStore().listOutbox()).some(tko_event => tko_event.eventType === "team.member_added.v1")).toBe(true);

    // Adding the same member twice is idempotent and emits no duplicate event.
    expect(
      (await addTeamMember(tko_workspace.owner, { teamId: tko_team.id, authSubject: tko_member.authSubject, correlationId: "test-squad" })).added,
    ).toBe(false);
    const tko_addedEvents = (await getPlatformStore().listOutbox()).filter(tko_event => tko_event.eventType === "team.member_added.v1");
    expect(tko_addedEvents).toHaveLength(1);

    await expect(
      addTeamMember(tko_workspace.owner, { teamId: tko_team.id, authSubject: "email:outsider@test.dev", correlationId: "test-squad" }),
    ).rejects.toThrow("TASKO_TEAM_MEMBER_NOT_WORKSPACE_MEMBER");

    expect(
      (await removeTeamMember(tko_workspace.owner, { teamId: tko_team.id, authSubject: tko_member.authSubject, correlationId: "test-squad" })).removed,
    ).toBe(true);
    expect((await getPlatformStore().listOutbox()).some(tko_event => tko_event.eventType === "team.member_removed.v1")).toBe(true);
    expect((await getTeamStore().listTeamMembers(tko_workspace.tenant.id, tko_team.id)).map(tko_item => tko_item.authSubject)).not.toContain(
      tko_member.authSubject,
    );
  });

  it("lists tenant teams with member counts and personal teams for members", async () => {
    const tko_team = await createTeam(tko_workspace.owner, { name: "Counted", correlationId: "test-count" });
    await addTeamMember(tko_workspace.owner, { teamId: tko_team.id, authSubject: tko_member.authSubject, correlationId: "test-count" });
    const tko_tenantTeams = await listTenantTeams(tko_workspace.owner);
    expect(tko_tenantTeams).toHaveLength(1);
    expect(tko_tenantTeams[0]?.memberCount).toBe(2);
    const tko_memberTeams = await listMyTeams(tko_member);
    expect(tko_memberTeams.map(tko_team => tko_team.id)).toEqual([tko_team.id]);
  });

  it("rejects invalid team names", async () => {
    await expect(createTeam(tko_workspace.owner, { name: "x", correlationId: "test-name" })).rejects.toThrow("TASKO_TEAM_NAME_INVALID");
    await expect(createTeam(tko_workspace.owner, { name: "   ", correlationId: "test-name" })).rejects.toThrow("TASKO_TEAM_NAME_INVALID");
  });
});
