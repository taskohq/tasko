import { randomBytes, randomUUID } from "node:crypto";
import type { PlatformActor } from "../../../packages/contracts/src/platform";
import { TKO_TEAM_EVENT_TYPES, type TeamSummary } from "../../../packages/contracts/src/identity";
import { Pool } from "pg";
import { tko_config } from "../../../packages/config/src/tasko-config";
import { getPlatformStore } from "../../../packages/database/src/platform-store";
import { recordAuditedEvent } from "../../audit/src/audit-service";
import { requireCapability } from "../../permissions/src/authorization";

/**
 * Team management (spec 06_AUTH_RBAC_PERMISSIONS): create/rename/delete teams,
 * add/remove members and list teams inside the caller's workspace.
 *
 * Authorization is central: every mutation requires the `teams.manage`
 * capability (owner/admin) via `requireCapability`. Every mutation is
 * persisted through the durable outbox + audit pattern (recordAuditedEvent),
 * emitting `team.created/updated/deleted.v1` and
 * `team.member_added/removed.v1`.
 */

export interface TeamRecord {
  id: string;
  tenantId: string;
  name: string;
  handle: string;
  createdAt: Date;
}

export interface TeamRecordWithCount extends TeamRecord {
  memberCount: number;
}

export interface TeamMemberRecord {
  authSubject: string;
  createdAt: Date;
}

export interface TeamStore {
  createTeam(tko_input: { tenantId: string; name: string; handle: string }): Promise<TeamRecord>;
  getTeamById(tko_tenantId: string, tko_teamId: string): Promise<TeamRecord | null>;
  renameTeam(tko_tenantId: string, tko_teamId: string, tko_name: string): Promise<TeamRecord | null>;
  deleteTeam(tko_tenantId: string, tko_teamId: string): Promise<boolean>;
  addTeamMember(tko_tenantId: string, tko_teamId: string, tko_authSubject: string): Promise<boolean>;
  removeTeamMember(tko_tenantId: string, tko_teamId: string, tko_authSubject: string): Promise<boolean>;
  listTeamMembers(tko_tenantId: string, tko_teamId: string): Promise<TeamMemberRecord[]>;
  listTeamsByTenant(tko_tenantId: string): Promise<TeamRecordWithCount[]>;
  listTeamsByMember(tko_tenantId: string, tko_authSubject: string): Promise<TeamRecordWithCount[]>;
}

const TKO_TEAM_NAME_MAX_LENGTH = 100;

function tko_slugifyHandle(tko_name: string): string {
  const tko_base = tko_name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return tko_base.length > 0 ? tko_base : "team";
}

function tko_newHandle(tko_name: string): string {
  return `${tko_slugifyHandle(tko_name)}-${randomBytes(3).toString("hex")}`;
}

export function tko_validateTeamName(tko_name: string): string {
  const tko_trimmed = tko_name.trim();
  if (tko_trimmed.length < 2 || tko_trimmed.length > TKO_TEAM_NAME_MAX_LENGTH) {
    throw new Error("TASKO_TEAM_NAME_INVALID");
  }
  return tko_trimmed;
}

function tko_cloneTeam(tko_team: TeamRecord): TeamRecord {
  return { ...tko_team, createdAt: new Date(tko_team.createdAt) };
}

export class MemoryTeamStore implements TeamStore {
  private readonly tko_teams = new Map<string, TeamRecord>();
  private readonly tko_members = new Map<string, Set<string>>(); // `${tenantId}:${teamId}` -> authSubjects

  private tko_memberKey(tko_tenantId: string, tko_teamId: string): string {
    return `${tko_tenantId}:${tko_teamId}`;
  }

  async createTeam(tko_input: { tenantId: string; name: string; handle: string }): Promise<TeamRecord> {
    for (const tko_existing of Array.from(this.tko_teams.values())) {
      if (tko_existing.tenantId === tko_input.tenantId && tko_existing.handle === tko_input.handle) {
        throw new Error("TASKO_TEAM_HANDLE_TAKEN");
      }
    }
    const tko_team: TeamRecord = { id: randomUUID(), tenantId: tko_input.tenantId, name: tko_input.name, handle: tko_input.handle, createdAt: new Date() };
    this.tko_teams.set(tko_team.id, tko_team);
    this.tko_members.set(this.tko_memberKey(tko_team.tenantId, tko_team.id), new Set());
    return tko_cloneTeam(tko_team);
  }

  async getTeamById(tko_tenantId: string, tko_teamId: string): Promise<TeamRecord | null> {
    const tko_team = this.tko_teams.get(tko_teamId);
    return tko_team && tko_team.tenantId === tko_tenantId ? tko_cloneTeam(tko_team) : null;
  }

  async renameTeam(tko_tenantId: string, tko_teamId: string, tko_name: string): Promise<TeamRecord | null> {
    const tko_team = await this.getTeamById(tko_tenantId, tko_teamId);
    if (!tko_team) return null;
    tko_team.name = tko_name;
    this.tko_teams.set(tko_teamId, tko_team);
    return tko_cloneTeam(tko_team);
  }

  async deleteTeam(tko_tenantId: string, tko_teamId: string): Promise<boolean> {
    const tko_team = await this.getTeamById(tko_tenantId, tko_teamId);
    if (!tko_team) return false;
    this.tko_members.delete(this.tko_memberKey(tko_tenantId, tko_teamId));
    this.tko_teams.delete(tko_teamId);
    return true;
  }

  async addTeamMember(tko_tenantId: string, tko_teamId: string, tko_authSubject: string): Promise<boolean> {
    const tko_team = await this.getTeamById(tko_tenantId, tko_teamId);
    if (!tko_team) throw new Error("TASKO_TEAM_NOT_FOUND");
    const tko_members = this.tko_members.get(this.tko_memberKey(tko_tenantId, tko_teamId));
    if (!tko_members) throw new Error("TASKO_TEAM_NOT_FOUND");
    if (tko_members.has(tko_authSubject)) return false;
    tko_members.add(tko_authSubject);
    return true;
  }

  async removeTeamMember(tko_tenantId: string, tko_teamId: string, tko_authSubject: string): Promise<boolean> {
    const tko_members = this.tko_members.get(this.tko_memberKey(tko_tenantId, tko_teamId));
    if (!tko_members) return false;
    return tko_members.delete(tko_authSubject);
  }

  async listTeamMembers(tko_tenantId: string, tko_teamId: string): Promise<TeamMemberRecord[]> {
    const tko_members = this.tko_members.get(this.tko_memberKey(tko_tenantId, tko_teamId));
    if (!tko_members) return [];
    return Array.from(tko_members).map(tko_authSubject => ({ authSubject: tko_authSubject, createdAt: new Date() }));
  }

  async listTeamsByTenant(tko_tenantId: string): Promise<TeamRecordWithCount[]> {
    return Array.from(this.tko_teams.values())
      .filter(tko_team => tko_team.tenantId === tko_tenantId)      .map(tko_team => ({
        ...tko_cloneTeam(tko_team),
        memberCount: this.tko_members.get(this.tko_memberKey(tko_tenantId, tko_team.id))?.size ?? 0,
      }))
      .sort((tko_a, tko_b) => tko_b.createdAt.getTime() - tko_a.createdAt.getTime());
  }

  async listTeamsByMember(tko_tenantId: string, tko_authSubject: string): Promise<TeamRecordWithCount[]> {
    const tko_result: TeamRecordWithCount[] = [];
    for (const tko_team of Array.from(this.tko_teams.values())) {
      if (tko_team.tenantId !== tko_tenantId) continue;
      if (this.tko_members.get(this.tko_memberKey(tko_tenantId, tko_team.id))?.has(tko_authSubject)) {
        tko_result.push({ ...tko_cloneTeam(tko_team), memberCount: this.tko_members.get(this.tko_memberKey(tko_tenantId, tko_team.id))?.size ?? 0 });
      }
    }
    return tko_result.sort((tko_a, tko_b) => tko_b.createdAt.getTime() - tko_a.createdAt.getTime());
  }
}

export class PostgresTeamStore implements TeamStore {
  private readonly tko_pool: Pool;
  constructor(tko_connectionString: string) {
    this.tko_pool = new Pool({ connectionString: tko_connectionString });
  }

  private tko_mapTeam(tko_row: Record<string, unknown>): TeamRecord {
    return {
      id: String(tko_row.id),
      tenantId: String(tko_row.tenant_id),
      name: String(tko_row.name),
      handle: String(tko_row.handle),
      createdAt: new Date(String(tko_row.created_at)),
    };
  }

  async createTeam(tko_input: { tenantId: string; name: string; handle: string }): Promise<TeamRecord> {
    const tko_result = await this.tko_pool.query(
      "insert into teams(id,tenant_id,name,handle) values($1,$2,$3,$4) returning id,tenant_id,name,handle,created_at",
      [randomUUID(), tko_input.tenantId, tko_input.name, tko_input.handle],
    );
    return this.tko_mapTeam(tko_result.rows[0]);
  }

  async getTeamById(tko_tenantId: string, tko_teamId: string): Promise<TeamRecord | null> {
    const tko_result = await this.tko_pool.query("select id,tenant_id,name,handle,created_at from teams where tenant_id=$1 and id=$2", [tko_tenantId, tko_teamId]);
    return tko_result.rowCount ? this.tko_mapTeam(tko_result.rows[0]) : null;
  }

  async renameTeam(tko_tenantId: string, tko_teamId: string, tko_name: string): Promise<TeamRecord | null> {
    const tko_result = await this.tko_pool.query(
      "update teams set name=$3 where tenant_id=$1 and id=$2 returning id,tenant_id,name,handle,created_at",
      [tko_tenantId, tko_teamId, tko_name],
    );
    return tko_result.rowCount ? this.tko_mapTeam(tko_result.rows[0]) : null;
  }

  async deleteTeam(tko_tenantId: string, tko_teamId: string): Promise<boolean> {
    await this.tko_pool.query("delete from team_members where tenant_id=$1 and team_id=$2", [tko_tenantId, tko_teamId]);
    const tko_result = await this.tko_pool.query("delete from teams where tenant_id=$1 and id=$2", [tko_tenantId, tko_teamId]);
    return Boolean(tko_result.rowCount);
  }

  async addTeamMember(tko_tenantId: string, tko_teamId: string, tko_authSubject: string): Promise<boolean> {
    const tko_user = await this.tko_pool.query("select id from users where auth_subject=$1", [tko_authSubject]);
    if (!tko_user.rowCount) throw new Error("TASKO_TEAM_MEMBER_UNKNOWN");
    const tko_result = await this.tko_pool.query(
      "insert into team_members(tenant_id,team_id,user_id) values($1,$2,$3) on conflict (team_id,user_id) do nothing",
      [tko_tenantId, tko_teamId, tko_user.rows[0].id],
    );
    return Boolean(tko_result.rowCount);
  }

  async removeTeamMember(tko_tenantId: string, tko_teamId: string, tko_authSubject: string): Promise<boolean> {
    const tko_result = await this.tko_pool.query(
      "delete from team_members tm using users u where tm.user_id=u.id and tm.tenant_id=$1 and tm.team_id=$2 and u.auth_subject=$3",
      [tko_tenantId, tko_teamId, tko_authSubject],
    );
    return Boolean(tko_result.rowCount);
  }

  async listTeamMembers(tko_tenantId: string, tko_teamId: string): Promise<TeamMemberRecord[]> {
    const tko_result = await this.tko_pool.query(
      "select u.auth_subject, tm.created_at from team_members tm join users u on u.id=tm.user_id where tm.tenant_id=$1 and tm.team_id=$2 order by tm.created_at",
      [tko_tenantId, tko_teamId],
    );
    return tko_result.rows.map((tko_row: Record<string, unknown>) => ({ authSubject: String(tko_row.auth_subject), createdAt: new Date(String(tko_row.created_at)) }));
  }

  async listTeamsByTenant(tko_tenantId: string): Promise<TeamRecordWithCount[]> {
    const tko_result = await this.tko_pool.query(
      "select t.id, t.tenant_id, t.name, t.handle, t.created_at, count(tm.user_id)::int as member_count from teams t left join team_members tm on tm.team_id=t.id and tm.tenant_id=t.tenant_id where t.tenant_id=$1 group by t.id, t.tenant_id, t.name, t.handle, t.created_at order by t.created_at desc",
      [tko_tenantId],
    );
    return tko_result.rows.map((tko_row: Record<string, unknown>) => ({ ...this.tko_mapTeam(tko_row), memberCount: Number(tko_row.member_count) }));
  }

  async listTeamsByMember(tko_tenantId: string, tko_authSubject: string): Promise<TeamRecordWithCount[]> {
    const tko_result = await this.tko_pool.query(
      "select t.id, t.tenant_id, t.name, t.handle, t.created_at, (select count(*)::int from team_members c where c.team_id=t.id and c.tenant_id=t.tenant_id) as member_count from teams t join team_members tm on tm.team_id=t.id and tm.tenant_id=t.tenant_id join users u on u.id=tm.user_id where t.tenant_id=$1 and u.auth_subject=$2 order by t.created_at desc",
      [tko_tenantId, tko_authSubject],
    );
    return tko_result.rows.map((tko_row: Record<string, unknown>) => ({ ...this.tko_mapTeam(tko_row), memberCount: Number(tko_row.member_count) }));
  }
}

let tko_store: TeamStore | null = null;
export function getTeamStore(): TeamStore {
  if (!tko_store) tko_store = tko_config.postgresUrl ? new PostgresTeamStore(tko_config.postgresUrl) : new MemoryTeamStore();
  return tko_store;
}
export function setTeamStoreForTests(tko_next: TeamStore | null): void {
  tko_store = tko_next;
}

function tko_teamResource(tko_actor: PlatformActor, tko_teamId: string) {
  return { tenantId: tko_actor.tenantId, type: "team", id: tko_teamId, visibility: "internal" } as const;
}

function tko_requireTeamsManage(tko_actor: PlatformActor, tko_teamId: string): void {
  requireCapability(tko_actor, "teams.manage", tko_teamResource(tko_actor, tko_teamId));
}

async function tko_recordTeamEvent(tko_input: {
  actor: PlatformActor;
  eventType: (typeof TKO_TEAM_EVENT_TYPES)[keyof typeof TKO_TEAM_EVENT_TYPES];
  action: string;
  teamId: string;
  payload: Record<string, unknown>;
  correlationId: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await recordAuditedEvent({
    actor: tko_input.actor,
    tenantId: tko_input.actor.tenantId,
    eventType: tko_input.eventType,
    topic: "identity.teams",
    payload: tko_input.payload,
    action: tko_input.action,
    resourceType: "team",
    resourceId: tko_input.teamId,
    correlationId: tko_input.correlationId,
    metadata: tko_input.metadata,
  });
}

function tko_teamPayload(tko_team: TeamRecord): Record<string, unknown> {
  return { team: { id: tko_team.id, name: tko_team.name, handle: tko_team.handle } };
}

export async function createTeam(tko_actor: PlatformActor, tko_input: { name: string; correlationId: string }): Promise<TeamRecord> {
  const tko_name = tko_validateTeamName(tko_input.name);
  tko_requireTeamsManage(tko_actor, "new");
  const tko_store = getTeamStore();
  let tko_team: TeamRecord | null = null;
  for (let tko_attempt = 0; tko_attempt < 3 && !tko_team; tko_attempt += 1) {
    try {
      tko_team = await tko_store.createTeam({ tenantId: tko_actor.tenantId, name: tko_name, handle: tko_newHandle(tko_name) });
    } catch (tko_error) {
      if (tko_attempt === 2) throw tko_error;
    }
  }
  if (!tko_team) throw new Error("TASKO_TEAM_HANDLE_TAKEN");
  await tko_store.addTeamMember(tko_actor.tenantId, tko_team.id, tko_actor.authSubject);
  await tko_recordTeamEvent({
    actor: tko_actor,
    eventType: TKO_TEAM_EVENT_TYPES.created,
    action: "team.create",
    teamId: tko_team.id,
    payload: tko_teamPayload(tko_team),
    correlationId: tko_input.correlationId,
    metadata: { handle: tko_team.handle },
  });
  return tko_team;
}

export async function renameTeam(tko_actor: PlatformActor, tko_input: { teamId: string; name: string; correlationId: string }): Promise<TeamRecord> {
  const tko_name = tko_validateTeamName(tko_input.name);
  tko_requireTeamsManage(tko_actor, tko_input.teamId);
  const tko_team = await getTeamStore().renameTeam(tko_actor.tenantId, tko_input.teamId, tko_name);
  if (!tko_team) throw new Error("TASKO_TEAM_NOT_FOUND");
  await tko_recordTeamEvent({
    actor: tko_actor,
    eventType: TKO_TEAM_EVENT_TYPES.updated,
    action: "team.rename",
    teamId: tko_team.id,
    payload: tko_teamPayload(tko_team),
    correlationId: tko_input.correlationId,
  });
  return tko_team;
}

export async function deleteTeam(tko_actor: PlatformActor, tko_input: { teamId: string; correlationId: string }): Promise<{ teamId: string }> {
  tko_requireTeamsManage(tko_actor, tko_input.teamId);
  const tko_deleted = await getTeamStore().deleteTeam(tko_actor.tenantId, tko_input.teamId);
  if (!tko_deleted) throw new Error("TASKO_TEAM_NOT_FOUND");
  await tko_recordTeamEvent({
    actor: tko_actor,
    eventType: TKO_TEAM_EVENT_TYPES.deleted,
    action: "team.delete",
    teamId: tko_input.teamId,
    payload: { team: { id: tko_input.teamId } },
    correlationId: tko_input.correlationId,
  });
  return { teamId: tko_input.teamId };
}

export async function addTeamMember(tko_actor: PlatformActor, tko_input: { teamId: string; authSubject: string; correlationId: string }): Promise<{ added: boolean }> {
  tko_requireTeamsManage(tko_actor, tko_input.teamId);
  const tko_store = getTeamStore();
  const tko_team = await tko_store.getTeamById(tko_actor.tenantId, tko_input.teamId);
  if (!tko_team) throw new Error("TASKO_TEAM_NOT_FOUND");
  const tko_isTenantMember = (await getPlatformStore().listMemberships(tko_input.authSubject)).some(
    tko_membership => tko_membership.tenant.id === tko_actor.tenantId && tko_membership.status === "active",
  );
  if (!tko_isTenantMember) throw new Error("TASKO_TEAM_MEMBER_NOT_WORKSPACE_MEMBER");
  const tko_added = await tko_store.addTeamMember(tko_actor.tenantId, tko_input.teamId, tko_input.authSubject);
  if (tko_added) {
    await tko_recordTeamEvent({
      actor: tko_actor,
      eventType: TKO_TEAM_EVENT_TYPES.memberAdded,
      action: "team.member_add",
      teamId: tko_input.teamId,
      payload: { ...tko_teamPayload(tko_team), memberAuthSubject: tko_input.authSubject },
      correlationId: tko_input.correlationId,
    });
  }
  return { added: tko_added };
}

export async function removeTeamMember(tko_actor: PlatformActor, tko_input: { teamId: string; authSubject: string; correlationId: string }): Promise<{ removed: boolean }> {
  tko_requireTeamsManage(tko_actor, tko_input.teamId);
  const tko_store = getTeamStore();
  const tko_team = await tko_store.getTeamById(tko_actor.tenantId, tko_input.teamId);
  if (!tko_team) throw new Error("TASKO_TEAM_NOT_FOUND");
  const tko_removed = await tko_store.removeTeamMember(tko_actor.tenantId, tko_input.teamId, tko_input.authSubject);
  if (tko_removed) {
    await tko_recordTeamEvent({
      actor: tko_actor,
      eventType: TKO_TEAM_EVENT_TYPES.memberRemoved,
      action: "team.member_remove",
      teamId: tko_input.teamId,
      payload: { ...tko_teamPayload(tko_team), memberAuthSubject: tko_input.authSubject },
      correlationId: tko_input.correlationId,
    });
  }
  return { removed: tko_removed };
}

export async function listTenantTeams(tko_actor: PlatformActor): Promise<TeamSummary[]> {
  tko_requireTeamsManage(tko_actor, "collection");
  const tko_teams = await getTeamStore().listTeamsByTenant(tko_actor.tenantId);
  return tko_teams.map(tko_team => ({ id: tko_team.id, tenantId: tko_team.tenantId, name: tko_team.name, handle: tko_team.handle, memberCount: tko_team.memberCount, createdAt: tko_team.createdAt }));
}

export async function listMyTeams(tko_actor: PlatformActor): Promise<TeamSummary[]> {
  const tko_teams = await getTeamStore().listTeamsByMember(tko_actor.tenantId, tko_actor.authSubject);
  return tko_teams.map(tko_team => ({ id: tko_team.id, tenantId: tko_team.tenantId, name: tko_team.name, handle: tko_team.handle, memberCount: tko_team.memberCount, createdAt: tko_team.createdAt }));
}

export async function listTeamMembers(tko_actor: PlatformActor, tko_teamId: string): Promise<TeamMemberRecord[]> {
  tko_requireTeamsManage(tko_actor, tko_teamId);
  const tko_team = await getTeamStore().getTeamById(tko_actor.tenantId, tko_teamId);
  if (!tko_team) throw new Error("TASKO_TEAM_NOT_FOUND");
  return getTeamStore().listTeamMembers(tko_actor.tenantId, tko_teamId);
}
