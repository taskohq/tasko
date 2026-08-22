import type { OutboxRecord } from "../../../packages/contracts/src/platform";
import { tko_config } from "../../../packages/config/src/tasko-config";
import { getPlatformStore } from "../../../packages/database/src/platform-store";
import { tko_logger } from "../../../packages/observability/src/logger";
import { getRedisAdapter } from "../../../packages/redis/src/redis-adapter";
import { requireCapability } from "../../permissions/src/authorization";
import { resolveWorkerServiceActor } from "../../tenancy/src/tenant-context";

export type OutboxConsumer = (tko_record: OutboxRecord) => Promise<void>;
type RegisteredConsumer = { consumer: OutboxConsumer; requiredCapability: "job.process" | "workspace.members.manage" };

export interface WorkerStatus {
  name: "worker";
  status: "standby" | "healthy" | "degraded";
  processedCount: number;
  lastPollAt: Date | null;
  lastError: string | null;
}

const tko_consumers = new Map<string, RegisteredConsumer[]>();
const tko_observers = new Set<OutboxConsumer>();
let tko_workerStatus: WorkerStatus = {
  name: "worker",
  status: "standby",
  processedCount: 0,
  lastPollAt: null,
  lastError: null,
};

export function registerOutboxConsumer(
  tko_eventType: string,
  tko_consumer: OutboxConsumer,
  tko_requiredCapability: RegisteredConsumer["requiredCapability"] = "job.process",
): void {
  const tko_registered = tko_consumers.get(tko_eventType) ?? [];
  if (!tko_registered.some(tko_entry => tko_entry.consumer === tko_consumer)) tko_registered.push({ consumer: tko_consumer, requiredCapability: tko_requiredCapability });
  tko_consumers.set(tko_eventType, tko_registered);
}

export function registerOutboxObserver(tko_observer: OutboxConsumer): void {
  tko_observers.add(tko_observer);
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
      for (const tko_observer of Array.from(tko_observers)) await tko_observer(tko_record);
      const tko_registeredConsumers = tko_consumers.get(tko_record.eventType) ?? [];
      for (const tko_registeredConsumer of tko_registeredConsumers) {
        const tko_serviceActor = await resolveWorkerServiceActor({
          tenantId: tko_record.tenantId,
          correlationId: tko_record.correlationId,
        });
        if (!tko_serviceActor) throw new Error("TASKO_AUTHORIZATION_DENIED:worker_service_membership_missing");
        requireCapability(tko_serviceActor, tko_registeredConsumer.requiredCapability, {
          tenantId: tko_record.tenantId,
          type: "outbox_job",
          id: tko_record.id,
          visibility: "internal",
        });
        await tko_registeredConsumer.consumer(tko_record);
      }
      const tko_actorMembership = tko_record.actorAuthSubject
        ? (await getPlatformStore().listMemberships(tko_record.actorAuthSubject)).find(tko_membership => tko_membership.tenant.id === tko_record.tenantId && tko_membership.status === "active")
        : null;
      const { deliveryToken: _tko_deliveryToken, ...tko_realtimePayload } = tko_record.payload;
      await getRedisAdapter().publishTenant({
        tenantId: tko_record.tenantId,
        eventId: tko_record.eventId,
        eventType: tko_record.eventType,
        payload: { ...tko_realtimePayload, actorMemberId: tko_actorMembership?.id ?? null },
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
      const tko_safeMessage = tko_message.replace(/(127\.0\.0\.1|localhost):\d+/g, "platform database");
      tko_workerStatus = { ...tko_workerStatus, status: "degraded", lastError: tko_safeMessage, lastPollAt: new Date() };
      tko_logger.error({ errorCode: tko_safeMessage }, "worker polling failed");
    }
  };
  const tko_timer = setInterval(() => void tko_tick(), tko_config.workerPollIntervalMs);
  void tko_tick();
  return () => clearInterval(tko_timer);
}
