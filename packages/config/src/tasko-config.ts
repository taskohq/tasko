import type { DeploymentProfile } from "../../contracts/src/platform";

function readDeploymentProfile(tko_value: string | undefined): DeploymentProfile {
  return tko_value === "saas" ? "saas" : "single_tenant";
}

function readPositiveInteger(tko_value: string | undefined, tko_fallback: number): number {
  const tko_parsed = Number.parseInt(tko_value ?? "", 10);
  return Number.isSafeInteger(tko_parsed) && tko_parsed > 0 ? tko_parsed : tko_fallback;
}

export const tko_config = {
  deploymentProfile: readDeploymentProfile(process.env.DEPLOYMENT_PROFILE),
  singleTenantSlug: process.env.TASKO_SINGLE_TENANT_SLUG ?? "tasko-demo",
  postgresUrl: process.env.TASKO_POSTGRES_URL ?? "",
  redisUrl: process.env.TASKO_REDIS_URL ?? "",
  workerPollIntervalMs: readPositiveInteger(process.env.TASKO_WORKER_POLL_MS, 1_000),
  workerMaxAttempts: readPositiveInteger(process.env.TASKO_WORKER_MAX_ATTEMPTS, 8),
  ownerAuthSubject: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
} as const;
