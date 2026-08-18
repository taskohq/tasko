import Redis from "ioredis";
import { tko_config } from "../../config/src/tasko-config";

export interface RedisHealth {
  name: "redis";
  status: "ok" | "degraded" | "error";
  detail: string;
}

export interface TenantMessage {
  tenantId: string;
  eventId: string;
  eventType: string;
  payload: Record<string, unknown>;
}

export type TenantMessageHandler = (tko_message: TenantMessage) => Promise<void> | void;

export interface TenantRedisAdapter {
  health(): Promise<RedisHealth>;
  publishTenant(tko_message: TenantMessage): Promise<void>;
  subscribeTenant(tko_tenantId: string, tko_handler: TenantMessageHandler): Promise<() => Promise<void>>;
  close(): Promise<void>;
}

function getTenantChannel(tko_tenantId: string): string {
  return `tasko:tenant:${tko_tenantId}:events`;
}

class NoopRedisAdapter implements TenantRedisAdapter {
  private readonly tko_handlers = new Map<string, Set<TenantMessageHandler>>();

  async health(): Promise<RedisHealth> {
    return { name: "redis", status: "ok", detail: "in-process development pub/sub adapter" };
  }

  async publishTenant(tko_message: TenantMessage): Promise<void> {
    const tko_handlers = this.tko_handlers.get(tko_message.tenantId) ?? new Set<TenantMessageHandler>();
    await Promise.all(Array.from(tko_handlers).map(tko_handler => tko_handler(tko_message)));
  }

  async subscribeTenant(
    tko_tenantId: string,
    tko_handler: TenantMessageHandler,
  ): Promise<() => Promise<void>> {
    const tko_handlers = this.tko_handlers.get(tko_tenantId) ?? new Set<TenantMessageHandler>();
    tko_handlers.add(tko_handler);
    this.tko_handlers.set(tko_tenantId, tko_handlers);
    return async () => {
      tko_handlers.delete(tko_handler);
      if (tko_handlers.size === 0) this.tko_handlers.delete(tko_tenantId);
    };
  }

  async close(): Promise<void> {
    this.tko_handlers.clear();
  }
}

class RedisAdapter implements TenantRedisAdapter {
  private readonly tko_publisher: Redis;
  private readonly tko_subscriber: Redis;
  private readonly tko_handlers = new Map<string, Set<TenantMessageHandler>>();

  constructor(tko_url: string) {
    this.tko_publisher = new Redis(tko_url, { lazyConnect: true, maxRetriesPerRequest: 1 });
    this.tko_subscriber = new Redis(tko_url, { lazyConnect: true, maxRetriesPerRequest: 1 });
    this.tko_subscriber.on("message", (tko_channel, tko_body) => {
      const tko_tenantId = tko_channel.split(":")[2];
      if (!tko_tenantId) return;
      let tko_message: TenantMessage;
      try {
        tko_message = JSON.parse(tko_body) as TenantMessage;
      } catch {
        return;
      }
      for (const tko_handler of Array.from(this.tko_handlers.get(tko_tenantId) ?? [])) {
        void tko_handler(tko_message);
      }
    });
  }

  async health(): Promise<RedisHealth> {
    try {
      if (this.tko_publisher.status === "wait") await this.tko_publisher.connect();
      await this.tko_publisher.ping();
      return { name: "redis", status: "ok", detail: "Redis reachable" };
    } catch (tko_error) {
      return {
        name: "redis",
        status: "error",
        detail: tko_error instanceof Error ? tko_error.message : "Redis unavailable",
      };
    }
  }

  async publishTenant(tko_message: TenantMessage): Promise<void> {
    if (this.tko_publisher.status === "wait") await this.tko_publisher.connect();
    await this.tko_publisher.publish(getTenantChannel(tko_message.tenantId), JSON.stringify(tko_message));
  }

  async subscribeTenant(
    tko_tenantId: string,
    tko_handler: TenantMessageHandler,
  ): Promise<() => Promise<void>> {
    if (this.tko_subscriber.status === "wait") await this.tko_subscriber.connect();
    const tko_handlers = this.tko_handlers.get(tko_tenantId) ?? new Set<TenantMessageHandler>();
    const tko_shouldSubscribe = tko_handlers.size === 0;
    tko_handlers.add(tko_handler);
    this.tko_handlers.set(tko_tenantId, tko_handlers);
    if (tko_shouldSubscribe) await this.tko_subscriber.subscribe(getTenantChannel(tko_tenantId));

    return async () => {
      tko_handlers.delete(tko_handler);
      if (tko_handlers.size === 0) {
        this.tko_handlers.delete(tko_tenantId);
        await this.tko_subscriber.unsubscribe(getTenantChannel(tko_tenantId));
      }
    };
  }

  async close(): Promise<void> {
    await Promise.all([this.tko_publisher.quit(), this.tko_subscriber.quit()]);
  }
}

let tko_redisAdapter: TenantRedisAdapter | null = null;

export function getRedisAdapter(): TenantRedisAdapter {
  if (!tko_redisAdapter) {
    tko_redisAdapter = tko_config.redisUrl
      ? new RedisAdapter(tko_config.redisUrl)
      : new NoopRedisAdapter();
  }
  return tko_redisAdapter;
}

export function setRedisAdapterForTests(tko_adapter: TenantRedisAdapter | null): void {
  tko_redisAdapter = tko_adapter;
}
