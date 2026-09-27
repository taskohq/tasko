import { describe, expect, it, vi } from "vitest";
import type { FastifyReply, FastifyRequest } from "fastify";
import { tko_handleStorageProxyRequest, type TkoStorageProxyDependencies } from "./storageProxy";
import type { TenantRequestContext } from "../../modules/tenancy/src/tenant-context";

function tko_createMockRes() {
  const tko_state = { status: 0, redirectUrl: null as string | null, redirectStatus: 0, body: null as unknown };
  const tko_res = {
    code(tko_code: number) {
      tko_state.status = tko_code;
      tko_state.redirectStatus = tko_code;
      return tko_res;
    },
    header() {
      return tko_res;
    },
    redirect(tko_url: string) {
      tko_state.redirectUrl = tko_url;
      return tko_res;
    },
    send(tko_payload: unknown) {
      tko_state.body = tko_payload;
      return tko_res;
    },
  };
  return { tko_res: tko_res as unknown as FastifyReply, tko_state };
}

function tko_createMockReq(tko_input: { key?: string; cookie?: string; userAgent?: string } = {}) {
  return {
    params: { "*": tko_input.key ?? "" },
    headers: {
      ...(tko_input.cookie ? { cookie: tko_input.cookie } : {}),
      ...(tko_input.userAgent ? { "user-agent": tko_input.userAgent } : {}),
    },
  } as unknown as FastifyRequest;
}

function tko_createDependencies(tko_overrides: Partial<TkoStorageProxyDependencies> = {}): TkoStorageProxyDependencies & { tko_getSignedUrl: ReturnType<typeof vi.fn>; authenticate: ReturnType<typeof vi.fn> } {
  const tko_getSignedUrl = vi.fn(async (tko_key: string) => `https://signed.example/${tko_key}`);
  const tko_authenticate = vi.fn(async () => {
    throw Object.assign(new Error("Invalid session cookie"), { name: "ForbiddenError" });
  });
  return {
    tko_getSignedUrl,
    authenticate: tko_authenticate,
    resolveTenant: async () => null,
    getSignedUrl: tko_getSignedUrl,
    ...tko_overrides,
  } as TkoStorageProxyDependencies & { tko_getSignedUrl: ReturnType<typeof vi.fn>; authenticate: ReturnType<typeof vi.fn> };
}

function tko_tenantContext(tko_input: { tenantId: string; role?: string; membershipStatus?: string }): TenantRequestContext {
  return {
    actor: {
      authSubject: "email:member",
      tenantId: tko_input.tenantId,
      tenantSlug: "workspace",
      memberId: "member-1",
      role: (tko_input.role ?? "member") as TenantRequestContext["actor"]["role"],
      membershipStatus: (tko_input.membershipStatus ?? "active") as TenantRequestContext["actor"]["membershipStatus"],
      correlationId: "corr",
    },
    membership: {
      id: "member-1",
      authSubject: "email:member",
      role: (tko_input.role ?? "member") as TenantRequestContext["membership"]["role"],
      status: (tko_input.membershipStatus ?? "active") as TenantRequestContext["membership"]["status"],
      displayName: "Member",
      tenant: {
        id: tko_input.tenantId,
        slug: "workspace",
        name: "Workspace",
        status: "active",
        deploymentProfile: "saas",
        settings: { chatChannelCreationRoles: ["owner"] },
        createdAt: new Date(),
      },
    },
  };
}

describe("storage proxy guard", () => {
  it("404s unauthenticated callers for tenant keys without touching storage", async () => {
    const tko_deps = tko_createDependencies();
    const { tko_res, tko_state } = tko_createMockRes();
    await tko_handleStorageProxyRequest(tko_createMockReq({ key: "tenants/t-1/attachments/a.txt" }), tko_res, "tenants/t-1/attachments/a.txt", tko_deps);
    expect(tko_state.status).toBe(404);
    expect(tko_deps.tko_getSignedUrl).not.toHaveBeenCalled();
  });

  it("404s authenticated callers requesting another tenant's keys", async () => {
    const tko_deps = tko_createDependencies({
      authenticate: async () => ({ openId: "email:member" }) as Awaited<ReturnType<TkoStorageProxyDependencies["authenticate"]>>,
      resolveTenant: (async () => tko_tenantContext({ tenantId: "t-1" })) as TkoStorageProxyDependencies["resolveTenant"],
    });
    const { tko_res, tko_state } = tko_createMockRes();
    await tko_handleStorageProxyRequest(tko_createMockReq({ key: "tenants/t-2/attachments/a.txt" }), tko_res, "tenants/t-2/attachments/a.txt", tko_deps);
    expect(tko_state.status).toBe(404);
    expect(tko_deps.tko_getSignedUrl).not.toHaveBeenCalled();
  });

  it("404s callers without an active workspace membership (capability denied)", async () => {
    const tko_deps = tko_createDependencies({
      authenticate: async () => ({ openId: "email:member" }) as Awaited<ReturnType<TkoStorageProxyDependencies["authenticate"]>>,
      resolveTenant: (async () => tko_tenantContext({ tenantId: "t-1", membershipStatus: "suspended" })) as TkoStorageProxyDependencies["resolveTenant"],
    });
    const { tko_res, tko_state } = tko_createMockRes();
    await tko_handleStorageProxyRequest(tko_createMockReq({ key: "tenants/t-1/attachments/a.txt" }), tko_res, "tenants/t-1/attachments/a.txt", tko_deps);
    expect(tko_state.status).toBe(404);
    expect(tko_deps.tko_getSignedUrl).not.toHaveBeenCalled();
  });

  it("307-redirects authorized callers to a signed URL for their own tenant keys", async () => {
    const tko_deps = tko_createDependencies({
      authenticate: async () => ({ openId: "email:member" }) as Awaited<ReturnType<TkoStorageProxyDependencies["authenticate"]>>,
      resolveTenant: (async () => tko_tenantContext({ tenantId: "t-1" })) as TkoStorageProxyDependencies["resolveTenant"],
    });
    const { tko_res, tko_state } = tko_createMockRes();
    await tko_handleStorageProxyRequest(tko_createMockReq({ key: "tenants/t-1/attachments/a.txt" }), tko_res, "tenants/t-1/attachments/a.txt", tko_deps);
    expect(tko_state.redirectStatus).toBe(307);
    expect(tko_state.redirectUrl).toBe("https://signed.example/tenants/t-1/attachments/a.txt");
    expect(tko_deps.tko_getSignedUrl).toHaveBeenCalledWith("tenants/t-1/attachments/a.txt");
  });

  it("serves public brand assets without authentication (login shell needs them)", async () => {
    const tko_deps = tko_createDependencies();
    const { tko_res, tko_state } = tko_createMockRes();
    await tko_handleStorageProxyRequest(tko_createMockReq({ key: "tasko-logo_50726dd1.png" }), tko_res, "tasko-logo_50726dd1.png", tko_deps);
    expect(tko_state.redirectStatus).toBe(307);
    expect(tko_state.redirectUrl).toBe("https://signed.example/tasko-logo_50726dd1.png");
    expect(tko_deps.authenticate).not.toHaveBeenCalled();
  });

  it("404s unknown key shapes even for authenticated callers", async () => {
    const tko_deps = tko_createDependencies({
      authenticate: async () => ({ openId: "email:member" }) as Awaited<ReturnType<TkoStorageProxyDependencies["authenticate"]>>,
      resolveTenant: (async () => tko_tenantContext({ tenantId: "t-1" })) as TkoStorageProxyDependencies["resolveTenant"],
    });
    const { tko_res, tko_state } = tko_createMockRes();
    await tko_handleStorageProxyRequest(tko_createMockReq({ key: "internal/secret.txt" }), tko_res, "internal/secret.txt", tko_deps);
    expect(tko_state.status).toBe(404);
    expect(tko_deps.tko_getSignedUrl).not.toHaveBeenCalled();
  });
});
