import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PlatformActor } from "../../packages/contracts/src/platform";
import { MemoryFeatureFlagStore, setFeatureFlagStoreForTests } from "../../packages/database/src/flag-store";
import { MemoryPlatformStore, setPlatformStoreForTests } from "../../packages/database/src/platform-store";
import { isFeatureEnabled, listFeatureFlagStates, listFeatureFlagsForActor, setFeatureFlagOverride, tko_knownFeatureFlags, tko_reloadFeatureFlagEnvDefaultsForTests } from "./src/feature-flags";

function tko_actor(tko_overrides: Partial<PlatformActor> = {}): PlatformActor {
  return { authSubject: "flags-owner", tenantId: "tko-tenant-tasko-demo", tenantSlug: "tasko-demo", memberId: "tko-member-tasko-demo-owner", role: "owner", membershipStatus: "active", correlationId: "flags-test", ...tko_overrides };
}

describe("Tasko M5 feature flags", () => {
  let tko_platform: MemoryPlatformStore;
  let tko_flags: MemoryFeatureFlagStore;

  beforeEach(async () => {
    tko_platform = new MemoryPlatformStore(); tko_flags = new MemoryFeatureFlagStore();
    setPlatformStoreForTests(tko_platform); setFeatureFlagStoreForTests(tko_flags);
    await tko_platform.seedDemoWorkspace({ ownerAuthSubject: "flags-owner", tenantSlug: "tasko-demo" });
    delete process.env.TASKO_FEATURE_AI_TOOLS;
    delete process.env.TASKO_FEATURE_PUBLIC_FORMS;
    delete process.env.TASKO_FEATURE_AUTOMATION_V2;
    tko_reloadFeatureFlagEnvDefaultsForTests();
  });
  afterEach(() => { setPlatformStoreForTests(null); setFeatureFlagStoreForTests(null); });

  it("defaults: known flags off unless built-in default is enabled; unknown flags always off", async () => {
    expect(await isFeatureEnabled("tko-tenant-tasko-demo", "ai.tools")).toBe(false);
    expect(await isFeatureEnabled("tko-tenant-tasko-demo", "automationV2")).toBe(false);
    expect(await isFeatureEnabled("tko-tenant-tasko-demo", "publicForms")).toBe(true); // backward-compatible default
    expect(await isFeatureEnabled("tko-tenant-tasko-demo", "not.a.flag")).toBe(false);
    expect(tko_knownFeatureFlags).toContain("publicForms");
  });

  it("env static defaults via TASKO_FEATURE_<NAME>=1/0 are overridden by tenant overrides", async () => {
    process.env.TASKO_FEATURE_AI_TOOLS = "1";
    tko_reloadFeatureFlagEnvDefaultsForTests();
    expect(await isFeatureEnabled("tko-tenant-tasko-demo", "ai.tools")).toBe(true);
    const tko_owner = tko_actor();
    const tko_states = await setFeatureFlagOverride(tko_owner, { flagKey: "ai.tools", enabled: false, correlationId: "flag-1" });
    expect(await isFeatureEnabled("tko-tenant-tasko-demo", "ai.tools")).toBe(false); // tenant override beats env
    expect(tko_states.find(tko_state => tko_state.key === "ai.tools")?.source).toBe("tenant_override");
    expect((await listFeatureFlagStates("tko-tenant-tasko-demo")).find(tko_state => tko_state.key === "publicForms")?.source).toBe("default");
    const tko_outbox = await tko_platform.listOutbox();
    expect(tko_outbox.some(tko_row => tko_row.eventType === "platform.feature_flag_set.v1")).toBe(true);
    expect((await tko_platform.listAuditLogs()).some(tko_row => tko_row.action === "platform.feature_flag.set")).toBe(true);
  });

  it("public forms default on but a tenant override can disable intake", async () => {
    expect(await isFeatureEnabled("tko-tenant-tasko-demo", "publicForms")).toBe(true);
    await setFeatureFlagOverride(tko_actor(), { flagKey: "publicForms", enabled: false, correlationId: "flag-2" });
    expect(await isFeatureEnabled("tko-tenant-tasko-demo", "publicForms")).toBe(false);
    expect(await isFeatureEnabled("other-tenant", "publicForms")).toBe(true); // override is tenant-scoped
  });

  it("denies flag writes to non-admins, rejects unknown flags and gates admin listing", async () => {
    await expect(setFeatureFlagOverride(tko_actor({ role: "member", memberId: "member-1" }), { flagKey: "publicForms", enabled: false, correlationId: "denied" })).rejects.toThrow("TASKO_AUTHORIZATION_DENIED");
    await expect(setFeatureFlagOverride(tko_actor({ role: "guest", memberId: "guest-1" }), { flagKey: "publicForms", enabled: false, correlationId: "denied-2" })).rejects.toThrow("TASKO_AUTHORIZATION_DENIED");
    await expect(setFeatureFlagOverride(tko_actor({ role: "service_account", memberId: "service-1" }), { flagKey: "publicForms", enabled: false, correlationId: "denied-3" })).rejects.toThrow("TASKO_AUTHORIZATION_DENIED");
    await expect(setFeatureFlagOverride(tko_actor(), { flagKey: "unknown.flag", enabled: true, correlationId: "unknown" })).rejects.toThrow("FEATURE_FLAG_UNKNOWN");
    await expect(listFeatureFlagsForActor(tko_actor({ role: "member", memberId: "member-1" }))).rejects.toThrow("TASKO_AUTHORIZATION_DENIED");
    await expect(listFeatureFlagsForActor(tko_actor())).resolves.toHaveLength(tko_knownFeatureFlags.length);
    expect(await tko_flags.listTenantFlagOverrides("tko-tenant-tasko-demo")).toEqual({});
  });
});
