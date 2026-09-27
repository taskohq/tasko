import type { PlatformActor } from "../../../packages/contracts/src/platform";
import { getFeatureFlagStore } from "../../../packages/database/src/flag-store";
import { requireCapability } from "../../permissions/src/authorization";

/** Feature-flag layer (spec 03 P0, spec 22 §10). Resolution order per tenant:
 *   1. tenant override (persisted via the flag store, audited as platform.feature_flag_set.v1);
 *   2. static env default TASKO_FEATURE_<NAME>=1|0 (tasko-config pattern);
 *   3. per-flag built-in default — every flag defaults to DISABLED except `publicForms`, which
 *      defaults to ENABLED for backward compatibility with pre-flag deployments.
 * Unknown flags are never enabled: `isFeatureEnabled` is the single safe gate. */

export const tko_knownFeatureFlags = ["ai.tools", "publicForms", "automationV2"] as const;
export type FeatureFlagKey = (typeof tko_knownFeatureFlags)[number];

const tko_flagDefaults: Record<FeatureFlagKey, boolean> = {
  "ai.tools": false,
  publicForms: true,
  automationV2: false,
};

const tko_envFlagName = (tko_flag: FeatureFlagKey): string => `TASKO_FEATURE_${tko_flag.replaceAll(".", "_").replace(/([a-z0-9])([A-Z])/g, "$1_$2").toUpperCase()}`;

const tko_readEnvDefaults = (): Record<FeatureFlagKey, { enabled: boolean; present: boolean }> => {
  const tko_result = {} as Record<FeatureFlagKey, { enabled: boolean; present: boolean }>;
  for (const tko_flag of tko_knownFeatureFlags) {
    const tko_raw = process.env[tko_envFlagName(tko_flag)];
    const tko_present = tko_raw === "1" || tko_raw === "0" || tko_raw === "true" || tko_raw === "false";
    tko_result[tko_flag] = { present: tko_present, enabled: tko_raw === "1" || tko_raw === "true" };
  }
  return tko_result;
};

const tko_envDefaults = tko_readEnvDefaults();

export function tko_isKnownFeatureFlag(tko_value: string): tko_value is FeatureFlagKey {
  return (tko_knownFeatureFlags as readonly string[]).includes(tko_value);
}

export interface FeatureFlagState {
  key: FeatureFlagKey;
  enabled: boolean;
  source: "tenant_override" | "env" | "default";
}

export async function isFeatureEnabled(tko_tenantId: string, tko_flag: string): Promise<boolean> {
  if (!tko_isKnownFeatureFlag(tko_flag)) return false;
  const tko_overrides = await getFeatureFlagStore().listTenantFlagOverrides(tko_tenantId);
  if (tko_flag in tko_overrides) return tko_overrides[tko_flag];
  if (tko_envDefaults[tko_flag].present) return tko_envDefaults[tko_flag].enabled;
  return tko_flagDefaults[tko_flag];
}

export async function listFeatureFlagStates(tko_tenantId: string): Promise<FeatureFlagState[]> {
  const tko_overrides = await getFeatureFlagStore().listTenantFlagOverrides(tko_tenantId);
  return tko_knownFeatureFlags.map(tko_flag => {
    if (tko_flag in tko_overrides) return { key: tko_flag, enabled: tko_overrides[tko_flag], source: "tenant_override" as const };
    if (tko_envDefaults[tko_flag].present) return { key: tko_flag, enabled: tko_envDefaults[tko_flag].enabled, source: "env" as const };
    return { key: tko_flag, enabled: tko_flagDefaults[tko_flag], source: "default" as const };
  });
}

export async function setFeatureFlagOverride(tko_actor: PlatformActor, tko_input: { flagKey: string; enabled: boolean; correlationId: string }): Promise<FeatureFlagState[]> {
  requireCapability(tko_actor, "workspace.settings.manage", { tenantId: tko_actor.tenantId, type: "tenant", id: tko_actor.tenantId, visibility: "internal" });
  if (!tko_isKnownFeatureFlag(tko_input.flagKey)) throw new Error("FEATURE_FLAG_UNKNOWN");
  await getFeatureFlagStore().setTenantFlagOverride(tko_actor, { flagKey: tko_input.flagKey, enabled: tko_input.enabled, correlationId: tko_input.correlationId });
  return listFeatureFlagStates(tko_actor.tenantId);
}

/** Admin listing: only owners/admins may inspect tenant flag policy. */
export async function listFeatureFlagsForActor(tko_actor: PlatformActor): Promise<FeatureFlagState[]> {
  requireCapability(tko_actor, "workspace.settings.manage", { tenantId: tko_actor.tenantId, type: "tenant", id: tko_actor.tenantId, visibility: "internal" });
  return listFeatureFlagStates(tko_actor.tenantId);
}

/** Reset helper used by tests to reload env-derived static defaults. */
export function tko_reloadFeatureFlagEnvDefaultsForTests(): void {
  for (const [tko_flag, tko_state] of Object.entries(tko_readEnvDefaults())) tko_envDefaults[tko_flag as FeatureFlagKey] = tko_state;
}
