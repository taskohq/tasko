import { describe, expect, it } from "vitest";
import SecuritySettings from "./SecuritySettings";
import Login from "../pages/Login";

/**
 * Module smoke guard: both new surfaces must keep importing and defaulting to
 * renderable React components (rendering is covered by E2E; tRPC hooks are
 * exercised through lib/auth-extras-trpc.ts against the wired appRouter).
 */
describe("account security surfaces", () => {
  it("exposes SecuritySettings and Login as components", () => {
    expect(typeof SecuritySettings).toBe("function");
    expect(typeof Login).toBe("function");
  });
});
