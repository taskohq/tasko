import { describe, expect, it, vi } from "vitest";
import { TkoCommandPalette, tko_onOpenCommandPalette, tko_openCommandPalette } from "@/components/CommandPalette";
import { tko_workspaceExtrasHooks } from "@/lib/workspace-extras-trpc";

describe("CommandPalette event bus and workspace extras bridge", () => {
  it("exposes a self-contained component and notifies subscribers when tko_openCommandPalette fires", () => {
    expect(typeof TkoCommandPalette).toBe("function");
    const tko_listener = vi.fn();
    const tko_off = tko_onOpenCommandPalette(tko_listener);
    tko_openCommandPalette();
    expect(tko_listener).toHaveBeenCalledTimes(1);
    tko_openCommandPalette();
    expect(tko_listener).toHaveBeenCalledTimes(2);
    tko_off();
    tko_openCommandPalette();
    expect(tko_listener).toHaveBeenCalledTimes(2);
  });

  it("bridges the workspace router onto the extras hook surface without copying state", () => {
    const tko_router = { documentRevisions: { id: "query" }, setFormSharing: { id: "mutation" } };
    expect(tko_workspaceExtrasHooks(tko_router)).toBe(tko_router);
  });
});
