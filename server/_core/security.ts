import { COOKIE_NAME } from "@shared/const";

/**
 * Framework-agnostic security decision logic.
 *
 * Everything here is pure: no Express, no database, no I/O. The HTTP layer
 * (Express today, Fastify after the planned migration) only adapts requests
 * into these functions and adapts the verdicts into responses, so the security
 * decisions survive the migration untouched.
 */

// ---------------------------------------------------------------------------
// Origin / Referer validation (CSRF hardening for cookie-authenticated routes)
// ---------------------------------------------------------------------------

const TKO_UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export type TkoOriginVerdict = {
  allowed: boolean;
  reason:
    | "unsafe_method_not_applicable"
    | "no_session_cookie"
    | "no_origin_native_client"
    | "same_origin"
    | "origin_mismatch"
    | "malformed_origin"
    | "malformed_referer";
};

function tko_normalizeHost(tko_rawHost: string): string {
  let tko_host = tko_rawHost.trim().toLowerCase();
  // Strip a trailing dot from fully-qualified names (example.com.).
  if (tko_host.endsWith(".")) tko_host = tko_host.slice(0, -1);
  // Strip IPv6 brackets for comparison.
  if (tko_host.startsWith("[") && tko_host.includes("]:")) {
    const tko_end = tko_host.indexOf("]:");
    return `${tko_host.slice(1, tko_end)}${tko_host.slice(tko_end + 1)}`;
  }
  return tko_host;
}

function tko_normalizeAuthority(tko_rawAuthority: string, tko_scheme: string | null): string {
  const tko_normalized = tko_normalizeHost(tko_rawAuthority);
  // Browsers omit default ports in Host but include them in Origin (and vice
  // versa); treat explicit default ports as equivalent to their absence. With
  // an unknown scheme (raw Host header) both default ports are stripped — the
  // port alone identifies the default-route case unambiguously here.
  if ((tko_scheme === null || tko_scheme === "https") && tko_normalized.endsWith(":443")) return tko_normalized.slice(0, -4);
  if ((tko_scheme === null || tko_scheme === "http") && tko_normalized.endsWith(":80")) return tko_normalized.slice(0, -3);
  return tko_normalized;
}

function tko_authorityOf(tko_urlString: string): { authority: string; scheme: string } | null {
  try {
    const tko_url = new URL(tko_urlString);
    if (tko_url.protocol !== "http:" && tko_url.protocol !== "https:") return null;
    return { authority: tko_normalizeAuthority(tko_url.host, tko_url.protocol.replace(":", "")), scheme: tko_url.protocol.replace(":", "") };
  } catch {
    return null;
  }
}

export function tko_isUnsafeMethod(tko_method: string): boolean {
  return TKO_UNSAFE_METHODS.has(tko_method.toUpperCase());
}

/**
 * Origin/Referer check for unsafe methods on cookie-authenticated routes.
 *
 * - The check only applies to unsafe methods carrying the session cookie;
 *   Bearer/native clients and safe methods pass unconditionally.
 * - Missing Origin AND Referer (curl, native apps, server-to-server) => allow.
 * - Origin present => its authority must match the request Host (or the first
 *   X-Forwarded-Host behind a proxy).
 * - Origin absent but Referer present => same rule for the Referer authority.
 * - Anything unparseable => reject.
 */
export function tko_isOriginAllowed(tko_input: {
  method: string;
  origin?: string | string[] | null;
  referer?: string | string[] | null;
  host?: string | string[] | null;
  forwardedHost?: string | string[] | null;
}): TkoOriginVerdict {
  if (!tko_isUnsafeMethod(tko_input.method)) return { allowed: true, reason: "unsafe_method_not_applicable" };

  const tko_first = (tko_value: string | string[] | null | undefined): string | null => {
    if (Array.isArray(tko_value)) return tko_value[0] ?? null;
    return tko_value ?? null;
  };

  const tko_origin = tko_first(tko_input.origin)?.trim() || null;
  const tko_referer = tko_first(tko_input.referer)?.trim() || null;
  const tko_host = tko_first(tko_input.forwardedHost)?.trim() || tko_first(tko_input.host)?.trim() || null;

  if (!tko_origin && !tko_referer) return { allowed: true, reason: "no_origin_native_client" };
  // A missing Host on an unsafe browser request cannot be validated; fail closed.
  if (!tko_host) return { allowed: false, reason: "origin_mismatch" };

  const tko_requestAuthority = tko_normalizeAuthority(tko_host, null);

  if (tko_origin) {
    const tko_originAuthority = tko_authorityOf(tko_origin);
    if (!tko_originAuthority) return { allowed: false, reason: "malformed_origin" };
    return tko_originAuthority.authority === tko_requestAuthority
      ? { allowed: true, reason: "same_origin" }
      : { allowed: false, reason: "origin_mismatch" };
  }

  // Only a same-request Referer can reach this point: the guard above returned
  // when Origin was present, and the earlier check returned when both were
  // absent. Treat an absent/unparseable Referer as a mismatch (fail closed).
  const tko_refererAuthority = tko_referer ? tko_authorityOf(tko_referer) : null;
  if (!tko_refererAuthority) return { allowed: false, reason: "malformed_referer" };
  return tko_refererAuthority.authority === tko_requestAuthority
    ? { allowed: true, reason: "same_origin" }
    : { allowed: false, reason: "origin_mismatch" };
}

// ---------------------------------------------------------------------------
// Storage proxy key guard (tenant isolation for /manus-storage)
// ---------------------------------------------------------------------------

/**
 * Root-level brand assets (logo/favicon referenced by the unauthenticated
 * login shell and client/index.html) are the only public keys. Everything not
 * matching this shape requires an authenticated, tenant-scoped request.
 */
const TKO_PUBLIC_BRAND_ASSET_PATTERN = /^tasko-[a-z0-9][a-z0-9-]*_[0-9a-f]{8}\.[a-z0-9]{2,5}$/;

export type TkoStorageAccessVerdict =
  | { decision: "proxy"; scope: "public_brand" }
  | { decision: "proxy"; scope: "tenant"; tenantId: string }
  | { decision: "not_found"; reason: "empty_key" | "traversal" | "outside_tenant_scope" | "unauthenticated" };

export function tko_isPublicBrandAssetKey(tko_key: string): boolean {
  return !tko_key.includes("/") && !tko_key.includes("\\") && TKO_PUBLIC_BRAND_ASSET_PATTERN.test(tko_key);
}

export function tko_parseTenantScopedKey(tko_key: string): { tenantId: string; remainder: string } | null {
  const tko_match = /^tenants\/([^/]+)\/(.+)$/.exec(tko_key);
  if (!tko_match) return null;
  return { tenantId: tko_match[1], remainder: tko_match[2] };
}

function tko_hasTraversal(tko_key: string): boolean {
  if (tko_key.includes("\\")) return true;
  return tko_key.split("/").some(tko_segment => tko_segment === "." || tko_segment === "..");
}

/**
 * Decide whether a /manus-storage key may be proxied at all, based purely on
 * key shape and the caller's resolved tenant (null when unauthenticated).
 * Authenticated tenant-scoped access still requires a read capability at the
 * call site; unknown and cross-tenant keys collapse into "not_found" so no
 * existence information is revealed (acceptance-test A).
 */
export function tko_evaluateStorageKeyAccess(tko_input: {
  key: string | null | undefined;
  callerTenantId: string | null;
}): TkoStorageAccessVerdict {
  const tko_key = (tko_input.key ?? "").replace(/^\/+/, "");
  if (!tko_key) return { decision: "not_found", reason: "empty_key" };
  if (tko_hasTraversal(tko_key)) return { decision: "not_found", reason: "traversal" };

  if (tko_isPublicBrandAssetKey(tko_key)) return { decision: "proxy", scope: "public_brand" };

  const tko_tenantKey = tko_parseTenantScopedKey(tko_key);
  if (!tko_tenantKey) return { decision: "not_found", reason: "outside_tenant_scope" };
  if (!tko_input.callerTenantId) return { decision: "not_found", reason: "unauthenticated" };
  if (tko_tenantKey.tenantId !== tko_input.callerTenantId) return { decision: "not_found", reason: "outside_tenant_scope" };

  return { decision: "proxy", scope: "tenant", tenantId: tko_input.callerTenantId };
}

// ---------------------------------------------------------------------------
// Session-token extraction (cookie first, Bearer fallback) + logout matching
// ---------------------------------------------------------------------------

/** The tRPC express adapter exposes procedures as `/auth.logout[,other.proc]`. */
export function tko_parseTrpcProcedureNames(tko_path: string): string[] {
  return tko_path
    .replace(/^\/+/, "")
    .split(",")
    .map(tko_name => tko_name.trim())
    .filter(tko_name => tko_name.length > 0);
}

/**
 * The logout mutation must revoke the presented session row (acceptance-test
 * K). Batched calls (`/auth.logout,other.proc`) are matched per procedure.
 */
export function tko_shouldRevokeSessionForRequest(tko_input: { method: string; path: string }): boolean {
  return tko_input.method.toUpperCase() === "POST" && tko_parseTrpcProcedureNames(tko_input.path).includes("auth.logout");
}

export function tko_extractSessionTokenFromHeaders(tko_input: {
  cookieHeader?: string | null;
  authorizationHeader?: string | null;
  parseCookie?: (tko_cookieHeader: string) => Record<string, string>;
}): string | null {
  const tko_parse = tko_input.parseCookie ?? ((tko_cookieHeader: string) => {
    // Minimal parsing to keep this module dependency-free; the HTTP adapter may
    // inject the battle-tested `cookie` parser instead.
    const tko_result: Record<string, string> = {};
    for (const tko_part of tko_cookieHeader.split(";")) {
      const tko_index = tko_part.indexOf("=");
      if (tko_index === -1) continue;
      const tko_name = tko_part.slice(0, tko_index).trim();
      const tko_value = tko_part.slice(tko_index + 1).trim();
      if (tko_name) tko_result[tko_name] = decodeURIComponent(tko_value);
    }
    return tko_result;
  });

  if (tko_input.cookieHeader) {
    const tko_fromCookie = tko_parse(tko_input.cookieHeader)[COOKIE_NAME];
    if (tko_fromCookie) return tko_fromCookie;
  }
  const tko_authorization = tko_input.authorizationHeader ?? "";
  if (tko_authorization.startsWith("Bearer ")) return tko_authorization.slice(7) || null;
  return null;
}
