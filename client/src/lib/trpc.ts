import { createTRPCReact } from "@trpc/react-query";
import type { AppRouter } from "../../../server/routers";

export const trpc = createTRPCReact<AppRouter>();

/** Active workspace slug (spec 17 §5). The browser value is only a candidate: the server
 * re-verifies membership for the `x-tasko-workspace` header before resolving the tenant. */
export const tko_workspaceStorageKey = "tasko.workspace";

export function tko_getActiveWorkspaceSlug(): string | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage.getItem(tko_workspaceStorageKey) ?? null;
  } catch {
    return null;
  }
}

export function tko_setActiveWorkspaceSlug(tko_slug: string | null): void {
  try {
    if (typeof window === "undefined") return;
    if (tko_slug) window.localStorage.setItem(tko_workspaceStorageKey, tko_slug);
    else window.localStorage.removeItem(tko_workspaceStorageKey);
  } catch {
    // Storage unavailable (private mode): switching falls back to the default workspace.
  }
}

/** Extra headers for every tRPC HTTP batch (queries and mutations). Merged into the
 * httpBatchLink `headers()` callback in client/src/main.tsx alongside the Bearer fallback. */
export function tko_workspaceHeaders(): Record<string, string> {
  const tko_slug = tko_getActiveWorkspaceSlug();
  return tko_slug ? { "x-tasko-workspace": tko_slug } : {};
}
