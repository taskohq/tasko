import { tko_config } from "../../packages/config/src/tasko-config";
import { getPlatformStore } from "../../packages/database/src/platform-store";
import { getRedisAdapter } from "../../packages/redis/src/redis-adapter";
import { getWorkerStatus } from "../../modules/worker/src/worker-service";

export async function getPlatformHealth() {
  const [tko_database, tko_redis] = await Promise.all([
    getPlatformStore().health(),
    getRedisAdapter().health(),
  ]);
  return {
    status: "ok" as const,
    service: "tasko",
    deploymentProfile: tko_config.deploymentProfile,
    checks: {
      database: tko_database,
      redis: tko_redis,
      worker: getWorkerStatus(),
    },
  };
}

export async function getPlatformReadiness() {
  const tko_health = await getPlatformHealth();
  const tko_isReady =
    tko_health.checks.database.status === "ok" &&
    tko_health.checks.redis.status === "ok" &&
    (tko_health.checks.worker.status === "standby" || tko_health.checks.worker.status === "healthy");
  return {
    ...tko_health,
    status: tko_isReady ? ("ready" as const) : ("not_ready" as const),
  };
}
