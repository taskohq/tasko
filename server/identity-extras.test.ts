import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse as parseCookie } from "cookie";
import { COOKIE_NAME } from "../shared/const";
import type { PlatformActor, TenantMembership } from "../packages/contracts/src/platform";
import type { TrpcContext } from "./_core/context";
import { router } from "./_core/trpc";
import { MemoryEmailPasswordStore, setEmailPasswordStoreForTests, getEmailPasswordStore } from "../packages/database/src/email-password-store";
import { MemoryPlatformStore, getPlatformStore, setPlatformStoreForTests } from "../packages/database/src/platform-store";
import { MemorySessionStore, getSessionStore, setSessionStoreForTests } from "../packages/database/src/session-store";
import { MemoryTeamStore, setTeamStoreForTests } from "../modules/auth/src/team-service";
import { createInMemoryRedisAdapter, setRedisAdapterForTests } from "../packages/redis/src/redis-adapter";
import { tkoIdentityExtraProcedures } from "./routers.identity-extras";
import { sdk } from "./_core/sdk";
import { tko_hashSessionToken, tko_revokeSessionByTokenHash } from "../modules/auth/src/session-service";

const tko_identityRouter = router(tkoIdentityExtraProcedures);

type IdentityCaller = ReturnType<typeof tko_identityRouter.createCaller>;

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
  return { tenant: tko_provisioned.tenant, ownerMembership: tko_ownerMembership };
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
  return tko_membership;
}

function tko_createContext(tko_input: {
  authSubject: string;
  membership: TenantMembership | null;
  sessionToken?: string;
}): TrpcContext {
  const tko_user = {
    id: -2,
    openId: tko_input.authSubject,
    name: "Identity Tester",
    email: "identity@test.dev",
    loginMethod: "email_password",
    role: "user",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  } as TrpcContext["user"];
  const tko_headers: Record<string, string> = {};
  if (tko_input.sessionToken) tko_headers.cookie = `${COOKIE_NAME}=${tko_input.sessionToken}`;
  return {
    user: tko_user,
    platform: tko_input.membership ? { actor: tko_actorFromMembership(tko_input.membership), membership: tko_input.membership } : null,
    correlationId: "test-corr",
    req: {
      headers: tko_headers,
      header: (tko_name: string) => tko_headers[tko_name.toLowerCase()],
    } as TrpcContext["req"],
    res: {
      cookie: () => undefined,
      clearCookie: () => undefined,
    } as TrpcContext["res"],
  } as TrpcContext;
}

describe("identity extras (sessions + teams)", () => {
  let tko_ownerSubject: string;
  let tko_ownerSessionToken: string;
  let tko_ownerMembership: TenantMembership;
  let tko_memberMembership: TenantMembership;

  beforeEach(async () => {
    setEmailPasswordStoreForTests(new MemoryEmailPasswordStore());
    setPlatformStoreForTests(new MemoryPlatformStore());
    setSessionStoreForTests(new MemorySessionStore());
    setTeamStoreForTests(new MemoryTeamStore());
    setRedisAdapterForTests(createInMemoryRedisAdapter());

    const tko_workspace = await tko_provisionWorkspace({
      ownerEmail: "identity-owner@test.dev",
      ownerDisplayName: "Owner",
      slug: `ws-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    });
    tko_ownerMembership = tko_workspace.ownerMembership;
    tko_ownerSubject = tko_ownerMembership.authSubject;
    tko_memberMembership = await tko_inviteMember({
      owner: tko_actorFromMembership(tko_ownerMembership),
      tenantId: tko_workspace.tenant.id,
      memberEmail: "identity-member@test.dev",
      memberSubject: "email:identity-member@test.dev",
    });
    // authenticateRequest resolves email subjects through the credential store,
    // so both principals need credential rows even though no password is used.
    for (const [tko_subject, tko_email] of [
      [tko_ownerSubject, "identity-owner@test.dev"],
      [tko_memberMembership.authSubject, "identity-member@test.dev"],
    ] as const) {
      await getEmailPasswordStore().create({
        authSubject: tko_subject,
        email: tko_email,
        displayName: "Identity Tester",
        passwordHash: "scrypt$16384$8$1$dGVzdA$dGVzdGhhc2g",
      });
    }
    tko_ownerSessionToken = await sdk.createSessionToken(tko_ownerSubject, { name: "Owner", device: "Owner Laptop" });
  });

  afterEach(() => {
    setEmailPasswordStoreForTests(null);
    setPlatformStoreForTests(null);
    setSessionStoreForTests(null);
    setTeamStoreForTests(null);
    setRedisAdapterForTests(null);
  });

  it("lists my active sessions and marks the current one", async () => {
    const tko_caller: IdentityCaller = tko_identityRouter.createCaller(
      tko_createContext({ authSubject: tko_ownerSubject, membership: tko_ownerMembership, sessionToken: tko_ownerSessionToken }),
    );
    const tko_sessions = await tko_caller.sessions();
    expect(tko_sessions).toHaveLength(1);
    expect(tko_sessions[0]?.device).toBe("Owner Laptop");
    expect(tko_sessions[0]?.isCurrent).toBe(true);
  });

  it("revokes one session by id and revokes all others, auditing both", async () => {
    const tko_otherToken = await sdk.createSessionToken(tko_ownerSubject, { name: "Owner", device: "Other Phone" });
    const tko_caller: IdentityCaller = tko_identityRouter.createCaller(
      tko_createContext({ authSubject: tko_ownerSubject, membership: tko_ownerMembership, sessionToken: tko_ownerSessionToken }),
    );

    const tko_sessions = await tko_caller.sessions();
    const tko_other = tko_sessions.find(tko_session => !tko_session.isCurrent);
    expect(tko_other).toBeDefined();

    const tko_revokeResult = await tko_caller.sessionRevoke({ sessionId: tko_other?.id as string });
    expect(tko_revokeResult.revoked).toBe(true);
    await expect(sdk.authenticateRequest({ headers: { cookie: `${COOKIE_NAME}=${tko_otherToken}` } } as never)).rejects.toThrow(
      "Session is no longer active",
    );
    expect((await getPlatformStore().listAuditLogs()).some(tko_log => tko_log.action === "auth.session.revoke")).toBe(true);

    const tko_thirdToken = await sdk.createSessionToken(tko_ownerSubject, { name: "Owner", device: "Third Tablet" });
    const tko_revokeAll = await tko_caller.sessionRevokeAllOthers();
    expect(tko_revokeAll.revoked).toBe(1);
    await expect(sdk.authenticateRequest({ headers: { cookie: `${COOKIE_NAME}=${tko_thirdToken}` } } as never)).rejects.toThrow(
      "Session is no longer active",
    );
    await expect(sdk.authenticateRequest({ headers: { cookie: `${COOKIE_NAME}=${tko_ownerSessionToken}` } } as never)).resolves.toMatchObject({
      openId: tko_ownerSubject,
    });
  });

  it("refuses to revoke a session that does not belong to the caller", async () => {
    const tko_caller: IdentityCaller = tko_identityRouter.createCaller(
      tko_createContext({ authSubject: tko_ownerSubject, membership: tko_ownerMembership, sessionToken: tko_ownerSessionToken }),
    );
    await expect(
      tko_caller.sessionRevoke({ sessionId: "00000000-0000-4000-8000-000000000000" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("creates, lists and deletes teams through the tRPC surface", async () => {
    const tko_ownerCaller: IdentityCaller = tko_identityRouter.createCaller(
      tko_createContext({ authSubject: tko_ownerSubject, membership: tko_ownerMembership, sessionToken: tko_ownerSessionToken }),
    );
    const tko_team = await tko_ownerCaller.teamCreate({ name: "Identity Crew" });
    expect(tko_team.name).toBe("Identity Crew");

    const tko_teams = await tko_ownerCaller.teams();
    expect(tko_teams).toHaveLength(1);
    expect(tko_teams[0]?.memberCount).toBe(1);

    const tko_memberCaller: IdentityCaller = tko_identityRouter.createCaller(
      tko_createContext({ authSubject: tko_memberMembership.authSubject, membership: tko_memberMembership }),
    );
    const tko_myTeams = await tko_memberCaller.myTeams();
    expect(tko_myTeams).toHaveLength(0); // not yet a team member

    await tko_ownerCaller.teamMemberAdd({ teamId: tko_team.id, authSubject: tko_memberMembership.authSubject });
    expect((await tko_memberCaller.myTeams()).map(tko_team => tko_team.id)).toEqual([tko_team.id]);
    expect((await tko_ownerCaller.teams())[0]?.memberCount).toBe(2);

    // Negative test: a plain member cannot manage teams.
    await expect(tko_memberCaller.teamCreate({ name: "Nope" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(tko_memberCaller.teamDelete({ teamId: tko_team.id })).rejects.toMatchObject({ code: "FORBIDDEN" });

    await tko_ownerCaller.teamMemberRemove({ teamId: tko_team.id, authSubject: tko_memberMembership.authSubject });
    expect((await tko_memberCaller.myTeams())).toHaveLength(0);

    const tko_deleted = await tko_ownerCaller.teamDelete({ teamId: tko_team.id });
    expect(tko_deleted.teamId).toBe(tko_team.id);
    expect(await tko_ownerCaller.teams()).toHaveLength(0);
    expect((await getPlatformStore().listOutbox()).filter(tko_event => tko_event.eventType === "team.created.v1")).toHaveLength(1);
    expect((await getPlatformStore().listOutbox()).filter(tko_event => tko_event.eventType === "team.deleted.v1")).toHaveLength(1);
  });

  it("renames teams through the tRPC surface and rejects unknown ids", async () => {
    const tko_ownerCaller: IdentityCaller = tko_identityRouter.createCaller(
      tko_createContext({ authSubject: tko_ownerSubject, membership: tko_ownerMembership, sessionToken: tko_ownerSessionToken }),
    );
    const tko_team = await tko_ownerCaller.teamCreate({ name: "Before" });
    const tko_renamed = await tko_ownerCaller.teamRename({ teamId: tko_team.id, name: "After" });
    expect(tko_renamed.name).toBe("After");
    await expect(tko_ownerCaller.teamRename({ teamId: "00000000-0000-4000-8000-000000000000", name: "Ghost" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("stores only token hashes in the session store", async () => {
    const tko_all = await getSessionStore().listActiveBySubject(tko_ownerSubject);
    expect(tko_all).toHaveLength(1);
    expect(tko_all[0]?.tokenHash).toBe(tko_hashSessionToken(tko_ownerSessionToken));
    expect(JSON.stringify(tko_all[0])).not.toContain(tko_ownerSessionToken);
    await tko_revokeSessionByTokenHash(tko_all[0]?.tokenHash as string);
  });
});
