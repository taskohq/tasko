import { NOT_ADMIN_ERR_MSG, UNAUTHED_ERR_MSG } from '@shared/const';
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";
import type { Capability, TenantResource } from "../../packages/contracts/src/platform";
import { can } from "../../modules/permissions/src/authorization";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
});

export const router = t.router;
export const publicProcedure = t.procedure;

const requireUser = t.middleware(async opts => {
  const { ctx, next } = opts;

  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }

  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
    },
  });
});

export const protectedProcedure = t.procedure.use(requireUser);

const requireTenant = t.middleware(async opts => {
    const { ctx, next } = opts;

    if (!ctx.user || !ctx.platform) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Active workspace membership is required" });
    }

    return next({
      ctx: {
        ...ctx,
        user: ctx.user,
        platform: ctx.platform,
      },
    });
  });

export const tenantProcedure = protectedProcedure.use(requireTenant);

export function procedureWithCapability(tko_action: Capability, tko_resourceType: string) {
  return tenantProcedure.use(
    t.middleware(async opts => {
      const { ctx, next } = opts;
      const tko_platform = ctx.platform;
      if (!tko_platform) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Active workspace membership is required" });
      }
      const tko_resource: TenantResource = {
        tenantId: tko_platform.actor.tenantId,
        type: tko_resourceType,
        id: tko_platform.actor.tenantId,
        visibility: "internal",
      };
      const tko_decision = can(tko_platform.actor, tko_action, tko_resource);
      if (!tko_decision.allowed) {
        throw new TRPCError({ code: "FORBIDDEN", message: `Authorization denied: ${tko_decision.reason}` });
      }
      return next({ ctx });
    }),
  );
}

export const adminProcedure = procedureWithCapability("workspace.members.manage", "tenant");
