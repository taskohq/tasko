import { afterEach, describe, expect, it } from "vitest";
import { tko_getActiveWorkspaceSlug, tko_setActiveWorkspaceSlug, tko_workspaceHeaders, tko_workspaceStorageKey } from "./trpc";

/** Node environment: install a minimal window/localStorage shim to exercise the header wiring. */
function tko_installWindowShim(): Map<string, string> {
  const tko_store = new Map<string, string>();
  (globalThis as unknown as { window: unknown }).window = {
    localStorage: {
      getItem: (tko_key: string) => tko_store.get(tko_key) ?? null,
      setItem: (tko_key: string, tko_value: string) => void tko_store.set(tko_key, tko_value),
      removeItem: (tko_key: string) => void tko_store.delete(tko_key),
    },
  };
  return tko_store;
}

describe("Tasko workspace header wiring (spec 17 §5)", () => {
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  it("sends the x-tasko-workspace candidate header from localStorage on every request", () => {
    const tko_storage = tko_installWindowShim();
    expect(tko_getActiveWorkspaceSlug()).toBeNull();
    expect(tko_workspaceHeaders()).toEqual({});
    tko_setActiveWorkspaceSlug("acme-operations");
    expect(tko_storage.get(tko_workspaceStorageKey)).toBe("acme-operations");
    expect(tko_workspaceHeaders()).toEqual({ "x-tasko-workspace": "acme-operations" });
    tko_setActiveWorkspaceSlug(null);
    expect(tko_getActiveWorkspaceSlug()).toBeNull();
    expect(tko_workspaceHeaders()).toEqual({});
  });

  it("degrades safely when window/localStorage is unavailable", () => {
    expect(tko_getActiveWorkspaceSlug()).toBeNull();
    expect(() => tko_setActiveWorkspaceSlug("acme")).not.toThrow();
    expect(tko_workspaceHeaders()).toEqual({});
  });
});
