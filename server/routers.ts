import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router, tenantProcedure } from "./_core/trpc";
import { tko_config } from "../packages/config/src/tasko-config";
import { getPlatformStore } from "../packages/database/src/platform-store";
import { can } from "../modules/permissions/src/authorization";
import { enqueueDurableEvent } from "../modules/events/src/outbox-service";
import { z } from "zod";

export const appRouter = router({
    // if you need to use socket.io, read and register route in server/_core/index.ts, all api should start with '/api/' so that the gateway can route correctly
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),
  }),

  platform: router({
    status: publicProcedure.query(async () => {
      const tko_database = await getPlatformStore().health();
      return {
        deploymentProfile: tko_config.deploymentProfile,
        database: tko_database,
        moduleStatus: "m0_platform_skeleton",
      } as const;
    }),
    memberships: protectedProcedure.query(async ({ ctx }) => {
      const tko_memberships = await getPlatformStore().listMemberships(ctx.user.openId);
      return tko_memberships.map(tko_membership => ({
        tenant: tko_membership.tenant,
        role: tko_membership.role,
        status: tko_membership.status,
        displayName: tko_membership.displayName,
      }));
    }),
    currentTenant: tenantProcedure.query(({ ctx }) => ({
      tenant: ctx.platform.membership.tenant,
      role: ctx.platform.actor.role,
      memberId: ctx.platform.actor.memberId,
      correlationId: ctx.platform.actor.correlationId,
    })),
    authorizationProbe: tenantProcedure
      .input(
        z.object({
          action: z.enum([
            "workspace.read",
            "workspace.settings.manage",
            "workspace.members.manage",
            "workspace.audit.read",
            "attachment.upload",
            "attachment.download",
            "realtime.connect",
            "job.enqueue",
          ]),
          resourceId: z.string().min(1),
          visibility: z.enum(["internal", "private", "guest_shared"]).default("internal"),
          explicitMemberIds: z.array(z.string()).default([]),
        }),
      )
      .query(({ ctx, input }) =>
        can(ctx.platform.actor, input.action, {
          // Deliberately ignore all browser-supplied tenant identifiers.
          tenantId: ctx.platform.actor.tenantId,
          type: "authorization_probe",
          id: input.resourceId,
          visibility: input.visibility,
          explicitMemberIds: input.explicitMemberIds,
        }),
      ),
    enqueueTestEvent: tenantProcedure.mutation(async ({ ctx }) => {
      const tko_decision = can(ctx.platform.actor, "job.enqueue", {
        tenantId: ctx.platform.actor.tenantId,
        type: "outbox",
        id: "test-event",
        visibility: "internal",
      });
      if (!tko_decision.allowed) {
        throw new Error(`TASKO_AUTHORIZATION_DENIED:${tko_decision.reason}`);
      }
      return enqueueDurableEvent({
        actor: ctx.platform.actor,
        tenantId: ctx.platform.actor.tenantId,
        eventType: "platform.test_event.v1",
        topic: "platform.events",
        payload: { source: "platform.enqueueTestEvent" },
        action: "platform.test_event.queued",
        resourceType: "outbox",
        resourceId: "test-event",
        correlationId: ctx.correlationId,
      });
    }),
    seedDemo: protectedProcedure.mutation(async ({ ctx }) => {
      if (!tko_config.ownerAuthSubject || ctx.user.openId !== tko_config.ownerAuthSubject) {
        throw new Error("TASKO_AUTHORIZATION_DENIED:seed_owner_required");
      }
      return getPlatformStore().seedDemoWorkspace({ ownerAuthSubject: ctx.user.openId });
    }),
  }),

  // TODO: add feature routers here, e.g.
  // todo: router({
  //   list: protectedProcedure.query(({ ctx }) =>
  //     db.getUserTodos(ctx.user.id)
  //   ),
  // }),
});

export type AppRouter = typeof appRouter;
