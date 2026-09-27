import { describe, expect, it } from "vitest";
import {
  tko_evaluateStorageKeyAccess,
  tko_extractSessionTokenFromHeaders,
  tko_isOriginAllowed,
  tko_isPublicBrandAssetKey,
  tko_parseTrpcProcedureNames,
  tko_shouldRevokeSessionForRequest,
} from "./security";

describe("tko_isOriginAllowed (CSRF origin/referer validation)", () => {
  const tko_base = { method: "POST" };

  it("allows same-origin requests whose Origin host matches the Host header", () => {
    expect(tko_isOriginAllowed({ ...tko_base, origin: "https://app.tasko.dev", host: "app.tasko.dev" }).allowed).toBe(true);
  });

  it("matches ports and tolerates default-port omissions", () => {
    expect(tko_isOriginAllowed({ ...tko_base, origin: "http://localhost:3000", host: "localhost:3000" }).allowed).toBe(true);
    expect(tko_isOriginAllowed({ ...tko_base, origin: "https://app.tasko.dev", host: "app.tasko.dev:443" }).allowed).toBe(true);
    expect(tko_isOriginAllowed({ ...tko_base, origin: "http://app.tasko.dev:80", host: "app.tasko.dev" }).allowed).toBe(true);
  });

  it("accepts X-Forwarded-Host as the effective request host behind a proxy", () => {
    expect(
      tko_isOriginAllowed({ ...tko_base, origin: "https://app.tasko.dev", host: "internal-pod:3000", forwardedHost: "app.tasko.dev" }).allowed,
    ).toBe(true);
  });

  it("allows requests without Origin and Referer (curl, native apps, server-to-server)", () => {
    expect(tko_isOriginAllowed({ ...tko_base, origin: null, referer: null, host: "app.tasko.dev" }).allowed).toBe(true);
    expect(tko_isOriginAllowed({ ...tko_base, host: "app.tasko.dev" }).allowed).toBe(true);
  });

  it("falls back to Referer when Origin is absent and validates it the same way", () => {
    expect(
      tko_isOriginAllowed({ ...tko_base, origin: null, referer: "https://app.tasko.dev/settings", host: "app.tasko.dev" }).allowed,
    ).toBe(true);
    expect(
      tko_isOriginAllowed({ ...tko_base, origin: null, referer: "https://evil.example.net/settings", host: "app.tasko.dev" }).reason,
    ).toBe("origin_mismatch");
  });

  it("rejects cross-origin requests and malformed Origin values", () => {
    expect(tko_isOriginAllowed({ ...tko_base, origin: "https://evil.example.net", host: "app.tasko.dev" }).allowed).toBe(false);
    expect(tko_isOriginAllowed({ ...tko_base, origin: "not-a-url", host: "app.tasko.dev" }).reason).toBe("malformed_origin");
    expect(tko_isOriginAllowed({ ...tko_base, origin: "https://evil.example.net", referer: null, host: null }).allowed).toBe(false);
  });

  it("skips safe methods and is case-insensitive on the method", () => {
    expect(tko_isOriginAllowed({ method: "GET", origin: "https://evil.example.net", host: "app.tasko.dev" }).allowed).toBe(true);
    expect(tko_isOriginAllowed({ method: "delete", origin: "https://evil.example.net", host: "app.tasko.dev" }).allowed).toBe(false);
  });
});

describe("tko_evaluateStorageKeyAccess (storage proxy guard)", () => {
  it("treats root-level brand assets as public", () => {
    expect(tko_isPublicBrandAssetKey("tasko-logo_50726dd1.png")).toBe(true);
    expect(tko_isPublicBrandAssetKey("tasko-favicon_2220cdac.png")).toBe(true);
    expect(tko_isPublicBrandAssetKey("tenants/t1/tasko-logo_50726dd1.png")).toBe(false);
    expect(tko_isPublicBrandAssetKey("secret-bundle.json")).toBe(false);
    expect(tko_evaluateStorageKeyAccess({ key: "tasko-logo_50726dd1.png", callerTenantId: null })).toEqual({
      decision: "proxy",
      scope: "public_brand",
    });
  });

  it("proxies tenant keys only for the caller's own tenant", () => {
    expect(tko_evaluateStorageKeyAccess({ key: "tenants/t-1/attachments/a/b.txt", callerTenantId: "t-1" })).toEqual({
      decision: "proxy",
      scope: "tenant",
      tenantId: "t-1",
    });
    const tko_crossTenant = tko_evaluateStorageKeyAccess({ key: "tenants/t-2/attachments/a/b.txt", callerTenantId: "t-1" });
    expect(tko_crossTenant.decision).toBe("not_found");
  });

  it("collapses unauthenticated tenant-key requests into not_found", () => {
    expect(tko_evaluateStorageKeyAccess({ key: "tenants/t-1/attachments/a.txt", callerTenantId: null }).decision).toBe("not_found");
  });

  it("rejects keys outside the two known scopes without revealing existence", () => {
    expect(tko_evaluateStorageKeyAccess({ key: "internal/secret.txt", callerTenantId: "t-1" }).decision).toBe("not_found");
    expect(tko_evaluateStorageKeyAccess({ key: "backups/t-1/dump.sql", callerTenantId: null }).decision).toBe("not_found");
    expect(tko_evaluateStorageKeyAccess({ key: "", callerTenantId: "t-1" }).decision).toBe("not_found");
    expect(tko_evaluateStorageKeyAccess({ key: null, callerTenantId: "t-1" }).decision).toBe("not_found");
  });

  it("rejects traversal attempts in any position of the key", () => {
    expect(tko_evaluateStorageKeyAccess({ key: "tenants/t-1/../tenants/t-2/secret", callerTenantId: "t-1" }).decision).toBe("not_found");
    expect(tko_evaluateStorageKeyAccess({ key: "tenants/t-1/attachments/../../other", callerTenantId: "t-1" }).decision).toBe("not_found");
    expect(tko_evaluateStorageKeyAccess({ key: "tenants\\t-1\\secret", callerTenantId: "t-1" }).decision).toBe("not_found");
  });
});

describe("tRPC logout matching and session-token extraction", () => {
  it("matches the logout procedure for POST including batched paths", () => {
    expect(tko_shouldRevokeSessionForRequest({ method: "POST", path: "/auth.logout" })).toBe(true);
    expect(tko_shouldRevokeSessionForRequest({ method: "POST", path: "/auth.logout,platform.status" })).toBe(true);
    expect(tko_shouldRevokeSessionForRequest({ method: "GET", path: "/auth.logout" })).toBe(false);
    expect(tko_shouldRevokeSessionForRequest({ method: "POST", path: "/platform.status" })).toBe(false);
  });

  it("parses batched tRPC procedure names", () => {
    expect(tko_parseTrpcProcedureNames("/auth.logout,teams")).toEqual(["auth.logout", "teams"]);
    expect(tko_parseTrpcProcedureNames("/")).toEqual([]);
  });

  it("prefers the cookie token and falls back to the Bearer header", () => {
    expect(
      tko_extractSessionTokenFromHeaders({ cookieHeader: "app_session_id=abc.def.ghi", authorizationHeader: "Bearer other" }),
    ).toBe("abc.def.ghi");
    expect(tko_extractSessionTokenFromHeaders({ cookieHeader: "", authorizationHeader: "Bearer xyz" })).toBe("xyz");
    expect(tko_extractSessionTokenFromHeaders({ cookieHeader: undefined, authorizationHeader: undefined })).toBeNull();
  });
});
