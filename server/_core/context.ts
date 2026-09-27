import type { CreateFastifyContextOptions } from "@trpc/server/adapters/fastify";
import type { User } from "../../drizzle/schema";
import { sdk } from "./sdk";
import type { TenantRequestContext } from "../../modules/tenancy/src/tenant-context";
import { resolveTenantRequestContext } from "../../modules/tenancy/src/tenant-context";
import { createCorrelationId } from "../../packages/observability/src/logger";

export type TrpcContext = {
  req: CreateFastifyContextOptions["req"];
  res: CreateFastifyContextOptions["res"];
  user: User | null;
  platform: TenantRequestContext | null;
  correlationId: string;
};

function tko_headerValue(tko_raw: string | string[] | undefined): string | undefined {
  if (Array.isArray(tko_raw)) return tko_raw[0];
  return tko_raw;
}

export async function createContext(
  opts: CreateFastifyContextOptions
): Promise<TrpcContext> {
  let user: User | null = null;
  let tko_platform: TenantRequestContext | null = null;
  const tko_candidateHeader = tko_headerValue(opts.req.headers["x-tasko-workspace"]);
  const tko_correlationId = createCorrelationId(tko_headerValue(opts.req.headers["x-correlation-id"]));

  try {
    user = await sdk.authenticateRequest(opts.req);
    tko_platform = await resolveTenantRequestContext({
      authSubject: user.openId,
      candidateTenantSlug: tko_candidateHeader,
      correlationId: tko_correlationId,
    });
  } catch {
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
