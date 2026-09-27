import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { storageGetSignedUrl } from "../storage";
import { sdk } from "./sdk";
import { tko_evaluateStorageKeyAccess, type TkoStorageAccessVerdict } from "./security";
import { can } from "../../modules/permissions/src/authorization";
import { resolveTenantRequestContext, type TenantRequestContext } from "../../modules/tenancy/src/tenant-context";
import type { PlatformActor } from "../../packages/contracts/src/platform";

/**
 * /manus-storage proxy.
 *
 * Previously this route 307-redirected ANY caller to a signed URL for ANY
 * storage key. It is now guarded (acceptance-tests A and K):
 *  - the key shape must be a public brand asset or `tenants/<caller tenant>/…`
 *    (pure decision in ./security.ts),
 *  - tenant-scoped keys additionally require an authenticated session whose
 *    resolved workspace matches the key's tenant AND an `attachment.download`
 *    capability,
 *  - every rejected request collapses into 404 so nothing about key existence
 *    is revealed.
 *
 * The Fastify registration stays thin; the decisions live in pure modules.
 */

export type TkoStorageProxyDependencies = {
  authenticate: typeof sdk.authenticateRequest;
  resolveTenant: typeof resolveTenantRequestContext;
  getSignedUrl: typeof storageGetSignedUrl;
};

const tko_defaultStorageProxyDependencies: TkoStorageProxyDependencies = {
  authenticate: tko_req => sdk.authenticateRequest(tko_req),
  resolveTenant: tko_input => resolveTenantRequestContext(tko_input),
  getSignedUrl: tko_key => storageGetSignedUrl(tko_key),
};

function tko_headerValue(tko_raw: string | string[] | undefined): string | undefined {
  if (Array.isArray(tko_raw)) return tko_raw[0];
  return tko_raw;
}

export async function tko_handleStorageProxyRequest(
  tko_req: FastifyRequest,
  tko_reply: FastifyReply,
  tko_key: string | undefined,
  tko_dependencies: TkoStorageProxyDependencies = tko_defaultStorageProxyDependencies,
): Promise<void> {
  const tko_notFound = () => {
    void tko_reply.code(404).send("Not found");
  };

  const tko_verdict: TkoStorageAccessVerdict = tko_evaluateStorageKeyAccess({
    key: tko_key,
    callerTenantId: null,
  });

  if (tko_verdict.decision === "proxy" && tko_verdict.scope === "public_brand") {
    await tko_proxySignedUrl(tko_key as string, tko_reply, tko_dependencies);
    return;
  }

  // Everything else requires an authenticated caller with a resolved workspace.
  let tko_user;
  try {
    tko_user = await tko_dependencies.authenticate(tko_req);
  } catch {
    tko_notFound();
    return;
  }

  let tko_platform: TenantRequestContext | null = null;
  try {
    tko_platform = await tko_dependencies.resolveTenant({
      authSubject: tko_user.openId,
      candidateTenantSlug: tko_headerValue(tko_req.headers["x-tasko-workspace"]),
      correlationId: tko_headerValue(tko_req.headers["x-correlation-id"]) ?? undefined,
    });
  } catch {
    tko_platform = null;
  }
  if (!tko_platform) {
    tko_notFound();
    return;
  }

  const tko_finalVerdict = tko_evaluateStorageKeyAccess({
    key: tko_key,
    callerTenantId: tko_platform.actor.tenantId,
  });

  if (tko_finalVerdict.decision !== "proxy") {
    tko_notFound();
    return;
  }

  if (tko_finalVerdict.scope === "tenant") {
    const tko_actor: PlatformActor = tko_platform.actor;
    const tko_decision = can(tko_actor, "attachment.download", {
      tenantId: tko_actor.tenantId,
      type: "attachment",
      id: tko_key as string,
      visibility: "internal",
    });
    if (!tko_decision.allowed) {
      tko_notFound();
      return;
    }
  }

  await tko_proxySignedUrl(tko_key as string, tko_reply, tko_dependencies);
}

async function tko_proxySignedUrl(
  tko_key: string,
  tko_reply: FastifyReply,
  tko_dependencies: TkoStorageProxyDependencies,
): Promise<void> {
  try {
    const tko_url = await tko_dependencies.getSignedUrl(tko_key);
    if (!tko_url) {
      void tko_reply.code(502).send("Empty signed URL from backend");
      return;
    }
    void tko_reply.header("cache-control", "no-store");
    void tko_reply.code(307).redirect(tko_url);
  } catch (tko_error) {
    console.error("[StorageProxy] failed:", tko_error);
    void tko_reply.code(502).send("Storage proxy error");
  }
}

export function registerStorageProxy(tko_fastify: FastifyInstance, tko_dependencies: TkoStorageProxyDependencies = tko_defaultStorageProxyDependencies) {
  tko_fastify.get("/manus-storage/*", async (tko_req, tko_reply) => {
    const tko_key = (tko_req.params as Record<string, string>)["*"];
    await tko_handleStorageProxyRequest(tko_req, tko_reply, tko_key, tko_dependencies);
  });
}
