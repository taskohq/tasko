import type { OutboxRecord } from "../../../packages/contracts/src/platform";
import { tko_config } from "../../../packages/config/src/tasko-config";
import { getPlatformStore } from "../../../packages/database/src/platform-store";
import { tko_logger } from "../../../packages/observability/src/logger";
import { getRedisAdapter } from "../../../packages/redis/src/redis-adapter";

export type OutboxConsumer = (tko_record: OutboxRecord) => Promise<void>;

export interface WorkerStatus {
  name: "worker";
  status: "standby" | "healthy" | "degraded";
  processedCount: number;
  lastPollAt: Date | null;
  lastError: string | null;
}

const tko_consumers = new Map<string, OutboxConsumer>();
let tko_workerStatus: WorkerStatus = {
  name: "worker",
  status: "standby",
  processedCount: 0,
  lastPollAt: null,
  lastError: null,
};

export function registerOutboxConsumer(tko_eventType: string, tko_consumer: OutboxConsumer): void {
  tko_consumers.set(tko_eventType, tko_consumer);
}

export function getWorkerStatus(): WorkerStatus {
  return { ...tko_workerStatus, lastPollAt: tko_workerStatus.lastPollAt && new Date(tko_workerStatus.lastPollAt) };
}

export async function processOutboxOnce(tko_limit = 25): Promise<number> {
  const tko_store = getPlatformStore();
  const tko_records = await tko_store.reserveOutbox(tko_limit);
  tko_workerStatus = { ...tko_workerStatus, status: "healthy", lastPollAt: new Date(), lastError: null };

  for (const tko_record of tko_records) {
    try {
      const tko_consumer = tko_consumers.get(tko_record.eventType);
      if (tko_consumer) await tko_consumer(tko_record);
      await getRedisAdapter().publishTenant({
        tenantId: tko_record.tenantId,
        eventId: tko_record.eventId,
        eventType: tko_record.eventType,
        payload: tko_record.payload,
      });
      await tko_store.markOutboxProcessed(tko_record.id);
      tko_workerStatus = { ...tko_workerStatus, processedCount: tko_workerStatus.processedCount + 1 };
      tko_logger.info({ eventId: tko_record.eventId, eventType: tko_record.eventType, tenantId: tko_record.tenantId }, "outbox event processed");
    } catch (tko_error) {
      const tko_message = tko_error instanceof Error ? tko_error.message : "unknown outbox error";
      await tko_store.rescheduleOutbox(tko_record.id, tko_message, tko_config.workerMaxAttempts);
      tko_workerStatus = { ...tko_workerStatus, status: "degraded", lastError: tko_message };
      tko_logger.error({ err: tko_error, eventId: tko_record.eventId, tenantId: tko_record.tenantId }, "outbox event failed");
    }
  }

  return tko_records.length;
}

export function startWorker(): () => void {
  const tko_tick = async () => {
    try {
      await processOutboxOnce();
    } catch (tko_error) {
      const tko_message = tko_error instanceof Error ? tko_error.message : "worker polling failed";
      tko_workerStatus = { ...tko_workerStatus, status: "degraded", lastError: tko_message, lastPollAt: new Date() };
      tko_logger.error({ err: tko_error }, "worker polling failed");
    }
  };
  const tko_timer = setInterval(() => void tko_tick(), tko_config.workerPollIntervalMs);
  void tko_tick();
  return () => clearInterval(tko_timer);
}
