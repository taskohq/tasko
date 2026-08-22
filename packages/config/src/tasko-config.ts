import type { DeploymentProfile } from "../../contracts/src/platform";

function readDeploymentProfile(tko_value: string | undefined): DeploymentProfile {
  return tko_value === "saas" ? "saas" : "single_tenant";
}

function readPositiveInteger(tko_value: string | undefined, tko_fallback: number): number {
  const tko_parsed = Number.parseInt(tko_value ?? "", 10);
  return Number.isSafeInteger(tko_parsed) && tko_parsed > 0 ? tko_parsed : tko_fallback;
}

function readSubjects(tko_value: string | undefined, tko_owner: string): readonly string[] {
  return Array.from(new Set([tko_owner, ...(tko_value ?? "").split(",")].map(tko_subject => tko_subject.trim()).filter(Boolean)));
}

export const tko_config = {
  deploymentProfile: readDeploymentProfile(process.env.DEPLOYMENT_PROFILE),
  singleTenantSlug: process.env.TASKO_SINGLE_TENANT_SLUG ?? "tasko-demo",
  postgresUrl: process.env.TASKO_POSTGRES_URL ?? "",
  redisUrl: process.env.TASKO_REDIS_URL ?? "",
  workerPollIntervalMs: readPositiveInteger(process.env.TASKO_WORKER_POLL_MS, 1_000),
  workerMaxAttempts: readPositiveInteger(process.env.TASKO_WORKER_MAX_ATTEMPTS, 8),
  workerServiceAuthSubject: process.env.TASKO_WORKER_SERVICE_SUBJECT ?? "service:tasko-worker",
  ownerAuthSubject: process.env.OWNER_OPEN_ID ?? "",
  platformAdminSubjects: readSubjects(process.env.TASKO_PLATFORM_ADMIN_SUBJECTS, process.env.OWNER_OPEN_ID ?? ""),
  billingProvider: process.env.TASKO_BILLING_PROVIDER === "stripe" ? "stripe" : null,
  resendApiKey: process.env.RESEND_API_KEY ?? "",
  resendFromEmail: process.env.RESEND_FROM_EMAIL ?? "",
  appOrigin: process.env.TASKO_APP_ORIGIN ?? "",
  isProduction: process.env.NODE_ENV === "production",
} as const;
