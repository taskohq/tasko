import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { parse as parseCookie } from "cookie";
import { COOKIE_NAME } from "@shared/const";
import { protectedProcedure, tenantProcedure } from "./_core/trpc";
import {
  tko_hashSessionToken,
  tko_listActiveSessions,
  tko_revokeAllSessionsForSubject,
  tko_revokeSessionByTokenHash,
} from "../modules/auth/src/session-service";
import {
  addTeamMember,
  createTeam,
  deleteTeam,
  listMyTeams,
  listTenantTeams,
  listTeamMembers,
  removeTeamMember,
  renameTeam,
} from "../modules/auth/src/team-service";
import { recordAuditedEvent } from "../modules/audit/src/audit-service";
import { requireCapability } from "../modules/permissions/src/authorization";
import type { PlatformActor } from "../packages/contracts/src/platform";
import type { SessionSummary } from "../packages/contracts/src/identity";
import type { TrpcContext } from "./_core/context";

/**
 * Identity extras: session/device management (acceptance-test K) and team
 * management (spec 06). Kept out of server/routers.ts so it can be merged
 * without collisions — spread `tkoIdentityExtraProcedures` into the `platform`
 * section or (recommended) a new top-level `identity` section:
 *
 *   identity: router({ ...tkoIdentityExtraProcedures })
 */

const TKO_CURRENT_SESSION_UNKNOWN = "__current_session_unknown__";

function tko_currentSessionToken(tko_ctx: TrpcContext): string | null {
  const tko_fromCookie = parseCookie(tko_ctx.req.headers.cookie ?? "")[COOKIE_NAME];
  if (tko_fromCookie) return tko_fromCookie;
  const tko_authorization = tko_ctx.req.headers.authorization;
  return tko_authorization?.startsWith("Bearer ") ? tko_authorization.slice(7) || null : null;
}

function tko_sessionSummaries(tko_ctx: TrpcContext, tko_records: Awaited<ReturnType<typeof tko_listActiveSessions>>): SessionSummary[] {
  const tko_currentToken = tko_currentSessionToken(tko_ctx);
  const tko_currentHash = tko_currentToken ? tko_hashSessionToken(tko_currentToken) : null;
  return tko_records.map(tko_record => ({
    id: tko_record.id,
    device: tko_record.device,
    createdAt: tko_record.createdAt,
    lastSeenAt: tko_record.lastSeenAt,
    expiresAt: tko_record.expiresAt,
    isCurrent: tko_currentHash !== null && tko_record.tokenHash === tko_currentHash,
  }));
}

async function tko_auditSessionRevocation(tko_input: {
  ctx: TrpcContext;
  sessionId: string;
  tenantId: string | null;
  metadata: Record<string, unknown>;
}): Promise<void> {
  const tko_tenantId = tko_input.tenantId ?? tko_input.ctx.platform?.actor.tenantId ?? null;
  if (!tko_tenantId) {
    console.warn("[Identity] Session revocation skipped durable audit: no tenant context", { sessionId: tko_input.sessionId });
    return;
  }
  await recordAuditedEvent({
    actor: tko_input.ctx.platform?.actor ?? null,
    tenantId: tko_tenantId,
    eventType: "auth.session.revoked.v1",
    topic: "security.authentication",
    payload: { sessionId: tko_input.sessionId, ...tko_input.metadata },
    action: "auth.session.revoke",
    resourceType: "session",
    resourceId: tko_input.sessionId,
    correlationId: tko_input.ctx.correlationId,
    metadata: tko_input.metadata,
  });
}

function tko_mapTeamServiceError(tko_error: unknown): TRPCError | null {
  const tko_code = tko_error instanceof Error ? tko_error.message : "";
  if (tko_code.startsWith("TASKO_AUTHORIZATION_DENIED:")) {
    return new TRPCError({ code: "FORBIDDEN", message: "Only workspace owners and admins can manage teams." });
  }
  if (tko_code === "TASKO_TEAM_NOT_FOUND") {
    return new TRPCError({ code: "NOT_FOUND", message: "Team not found." });
  }
  if (tko_code === "TASKO_TEAM_NAME_INVALID") {
    return new TRPCError({ code: "BAD_REQUEST", message: "Team name must be between 2 and 100 characters." });
  }
  if (tko_code === "TASKO_TEAM_MEMBER_NOT_WORKSPACE_MEMBER" || tko_code === "TASKO_TEAM_MEMBER_UNKNOWN") {
    return new TRPCError({ code: "BAD_REQUEST", message: "That person is not an active member of this workspace." });
  }
  return null;
}

/** Central capability gate for every team-management surface (spec 06). */
function tko_assertTeamsManage(tko_actor: PlatformActor): void {
  requireCapability(tko_actor, "teams.manage", {
    tenantId: tko_actor.tenantId,
    type: "team",
    id: tko_actor.tenantId,
    visibility: "internal",
  });
}

/** Runs a team service call, asserting the capability and mapping errors. */
async function tko_teamManageCall<T>(tko_actor: PlatformActor, tko_run: () => Promise<T>): Promise<T> {
  try {
    tko_assertTeamsManage(tko_actor);
    return await tko_run();
  } catch (tko_error) {
    const tko_mapped = tko_mapTeamServiceError(tko_error);
    if (tko_mapped) throw tko_mapped;
    throw tko_error;
  }
}

export const tkoIdentityExtraProcedures = {
  // --- Session / device management (acceptance-test K) ---------------------
  sessions: protectedProcedure.query(async ({ ctx }) =>
    tko_sessionSummaries(ctx, await tko_listActiveSessions(ctx.user.openId)),
  ),
  sessionRevoke: protectedProcedure
    .input(z.object({ sessionId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const tko_active = await tko_listActiveSessions(ctx.user.openId);
      const tko_target = tko_active.find(tko_record => tko_record.id === input.sessionId);
      if (!tko_target) throw new TRPCError({ code: "NOT_FOUND", message: "Session not found." });
      await tko_revokeSessionByTokenHash(tko_target.tokenHash);
      await tko_auditSessionRevocation({ ctx, sessionId: tko_target.id, tenantId: tko_target.tenantId, metadata: { scope: "single" } });
      return { revoked: true } as const;
    }),
  sessionRevokeAllOthers: protectedProcedure.mutation(async ({ ctx }) => {
    const tko_currentToken = tko_currentSessionToken(ctx);
    const tko_currentHash = tko_currentToken ? tko_hashSessionToken(tko_currentToken) : null;
    const tko_revoked = await tko_revokeAllSessionsForSubject(ctx.user.openId, tko_currentHash);
    if (tko_revoked > 0) {
      await tko_auditSessionRevocation({ ctx, sessionId: TKO_CURRENT_SESSION_UNKNOWN, tenantId: ctx.platform?.actor.tenantId ?? null, metadata: { scope: "all_others", revokedCount: tko_revoked } });
    }
    return { revoked: tko_revoked } as const;
  }),

  // --- Team management ------------------------------------------------------
  teams: tenantProcedure.query(({ ctx }) => tko_teamManageCall(ctx.platform.actor, () => listTenantTeams(ctx.platform.actor))),
  myTeams: tenantProcedure.query(({ ctx }) => listMyTeams(ctx.platform.actor)),
  teamCreate: tenantProcedure
    .input(z.object({ name: z.string().trim().min(2).max(100) }))
    .mutation(({ ctx, input }) =>
      tko_teamManageCall(ctx.platform.actor, () => createTeam(ctx.platform.actor, { name: input.name, correlationId: ctx.correlationId })),
    ),
  teamRename: tenantProcedure
    .input(z.object({ teamId: z.string().uuid(), name: z.string().trim().min(2).max(100) }))
    .mutation(({ ctx, input }) =>
      tko_teamManageCall(ctx.platform.actor, () => renameTeam(ctx.platform.actor, { teamId: input.teamId, name: input.name, correlationId: ctx.correlationId })),
    ),
  teamDelete: tenantProcedure
    .input(z.object({ teamId: z.string().uuid() }))
    .mutation(({ ctx, input }) =>
      tko_teamManageCall(ctx.platform.actor, () => deleteTeam(ctx.platform.actor, { teamId: input.teamId, correlationId: ctx.correlationId })),
    ),
  teamMembers: tenantProcedure
    .input(z.object({ teamId: z.string().uuid() }))
    .query(({ ctx, input }) => tko_teamManageCall(ctx.platform.actor, () => listTeamMembers(ctx.platform.actor, input.teamId))),
  teamMemberAdd: tenantProcedure
    .input(z.object({ teamId: z.string().uuid(), authSubject: z.string().min(1).max(200) }))
    .mutation(({ ctx, input }) =>
      tko_teamManageCall(ctx.platform.actor, () =>
        addTeamMember(ctx.platform.actor, { teamId: input.teamId, authSubject: input.authSubject, correlationId: ctx.correlationId }),
      ),
    ),
  teamMemberRemove: tenantProcedure
    .input(z.object({ teamId: z.string().uuid(), authSubject: z.string().min(1).max(200) }))
    .mutation(({ ctx, input }) =>
      tko_teamManageCall(ctx.platform.actor, () =>
        removeTeamMember(ctx.platform.actor, { teamId: input.teamId, authSubject: input.authSubject, correlationId: ctx.correlationId }),
      ),
    ),
};
