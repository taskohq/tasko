import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema";
import { sdk } from "./sdk";
import type { TenantRequestContext } from "../../modules/tenancy/src/tenant-context";
import { resolveTenantRequestContext } from "../../modules/tenancy/src/tenant-context";
import { createCorrelationId } from "../../packages/observability/src/logger";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
  platform: TenantRequestContext | null;
  correlationId: string;
};

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  let user: User | null = null;
  let tko_platform: TenantRequestContext | null = null;
  const tko_candidateHeader = opts.req.header("x-tasko-workspace");
  const tko_correlationId = createCorrelationId(opts.req.header("x-correlation-id"));

  try {
    user = await sdk.authenticateRequest(opts.req);
    tko_platform = await resolveTenantRequestContext({
      authSubject: user.openId,
      candidateTenantSlug: tko_candidateHeader,
      correlationId: tko_correlationId,
    });
  } catch (error) {
    // Authentication is optional for public procedures.
    user = null;
  }

  return {
    req: opts.req,
    res: opts.res,
    user,
    platform: tko_platform,
    correlationId: tko_correlationId,
  };
}
