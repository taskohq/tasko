import { randomUUID } from "node:crypto";
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

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

export interface DistributedLock {
  key: string;
  release(): Promise<void>;
}

export type TenantMessageHandler = (tko_message: TenantMessage) => Promise<void> | void;

export interface TenantRedisAdapter {
  health(): Promise<RedisHealth>;
  publishTenant(tko_message: TenantMessage): Promise<void>;
  subscribeTenant(tko_tenantId: string, tko_handler: TenantMessageHandler): Promise<() => Promise<void>>;
  getCache(tko_key: string): Promise<string | null>;
  setCache(tko_key: string, tko_value: string, tko_ttlMs: number): Promise<void>;
  takeRateLimit(tko_key: string, tko_limit: number, tko_windowMs: number): Promise<RateLimitResult>;
  acquireLock(tko_key: string, tko_ttlMs: number): Promise<DistributedLock | null>;
  enqueue(tko_queue: string, tko_payload: string): Promise<void>;
  dequeue(tko_queue: string): Promise<string | null>;
  close(): Promise<void>;
}

function getTenantChannel(tko_tenantId: string): string {
  return `tasko:tenant:${tko_tenantId}:events`;
}

class NoopRedisAdapter implements TenantRedisAdapter {
  private readonly tko_handlers = new Map<string, Set<TenantMessageHandler>>();
  private readonly tko_cache = new Map<string, { value: string; expiresAt: number }>();
  private readonly tko_windows = new Map<string, { count: number; expiresAt: number }>();
  private readonly tko_locks = new Map<string, string>();
  private readonly tko_queues = new Map<string, string[]>();

  async health(): Promise<RedisHealth> {
    return { name: "redis", status: "ok", detail: "in-process development coordination adapter" };
  }

  async publishTenant(tko_message: TenantMessage): Promise<void> {
    const tko_handlers = this.tko_handlers.get(tko_message.tenantId) ?? new Set<TenantMessageHandler>();
    await Promise.all(Array.from(tko_handlers).map(tko_handler => tko_handler(tko_message)));
  }

  async subscribeTenant(tko_tenantId: string, tko_handler: TenantMessageHandler): Promise<() => Promise<void>> {
    const tko_handlers = this.tko_handlers.get(tko_tenantId) ?? new Set<TenantMessageHandler>();
    tko_handlers.add(tko_handler);
    this.tko_handlers.set(tko_tenantId, tko_handlers);
    return async () => {
      tko_handlers.delete(tko_handler);
      if (tko_handlers.size === 0) this.tko_handlers.delete(tko_tenantId);
    };
  }

  async getCache(tko_key: string): Promise<string | null> {
    const tko_value = this.tko_cache.get(tko_key);
    if (!tko_value || tko_value.expiresAt <= Date.now()) {
      this.tko_cache.delete(tko_key);
      return null;
    }
    return tko_value.value;
  }

  async setCache(tko_key: string, tko_value: string, tko_ttlMs: number): Promise<void> {
    this.tko_cache.set(tko_key, { value: tko_value, expiresAt: Date.now() + tko_ttlMs });
  }

  async takeRateLimit(tko_key: string, tko_limit: number, tko_windowMs: number): Promise<RateLimitResult> {
    const tko_now = Date.now();
    const tko_window = this.tko_windows.get(tko_key);
    const tko_current = !tko_window || tko_window.expiresAt <= tko_now
      ? { count: 1, expiresAt: tko_now + tko_windowMs }
      : { ...tko_window, count: tko_window.count + 1 };
    this.tko_windows.set(tko_key, tko_current);
    return {
      allowed: tko_current.count <= tko_limit,
      remaining: Math.max(0, tko_limit - tko_current.count),
      retryAfterMs: Math.max(0, tko_current.expiresAt - tko_now),
    };
  }

  async acquireLock(tko_key: string, _tko_ttlMs: number): Promise<DistributedLock | null> {
    if (this.tko_locks.has(tko_key)) return null;
    const tko_token = randomUUID();
    this.tko_locks.set(tko_key, tko_token);
    return {
      key: tko_key,
      release: async () => {
        if (this.tko_locks.get(tko_key) === tko_token) this.tko_locks.delete(tko_key);
      },
    };
  }

  async enqueue(tko_queue: string, tko_payload: string): Promise<void> {
    const tko_items = this.tko_queues.get(tko_queue) ?? [];
    tko_items.push(tko_payload);
    this.tko_queues.set(tko_queue, tko_items);
  }

  async dequeue(tko_queue: string): Promise<string | null> {
    return this.tko_queues.get(tko_queue)?.shift() ?? null;
  }

  async close(): Promise<void> {
    this.tko_handlers.clear();
    this.tko_cache.clear();
    this.tko_windows.clear();
    this.tko_locks.clear();
    this.tko_queues.clear();
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
      try {
        const tko_message = JSON.parse(tko_body) as TenantMessage;
        for (const tko_handler of Array.from(this.tko_handlers.get(tko_tenantId) ?? [])) void tko_handler(tko_message);
      } catch {
        // Invalid broker payloads are discarded at the adapter boundary.
      }
    });
  }

  private async tko_connect(tko_client: Redis): Promise<void> {
    if (tko_client.status === "wait") await tko_client.connect();
  }

  async health(): Promise<RedisHealth> {
    try {
      await this.tko_connect(this.tko_publisher);
      await this.tko_publisher.ping();
      return { name: "redis", status: "ok", detail: "Redis reachable" };
    } catch (tko_error) {
      return { name: "redis", status: "error", detail: tko_error instanceof Error ? tko_error.message : "Redis unavailable" };
    }
  }

  async publishTenant(tko_message: TenantMessage): Promise<void> {
    await this.tko_connect(this.tko_publisher);
    await this.tko_publisher.publish(getTenantChannel(tko_message.tenantId), JSON.stringify(tko_message));
  }

  async subscribeTenant(tko_tenantId: string, tko_handler: TenantMessageHandler): Promise<() => Promise<void>> {
    await this.tko_connect(this.tko_subscriber);
    const tko_handlers = this.tko_handlers.get(tko_tenantId) ?? new Set<TenantMessageHandler>();
    const tko_subscribe = tko_handlers.size === 0;
    tko_handlers.add(tko_handler);
    this.tko_handlers.set(tko_tenantId, tko_handlers);
    if (tko_subscribe) await this.tko_subscriber.subscribe(getTenantChannel(tko_tenantId));
    return async () => {
      tko_handlers.delete(tko_handler);
      if (tko_handlers.size === 0) {
        this.tko_handlers.delete(tko_tenantId);
        await this.tko_subscriber.unsubscribe(getTenantChannel(tko_tenantId));
      }
    };
  }

  async getCache(tko_key: string): Promise<string | null> {
    await this.tko_connect(this.tko_publisher);
    return this.tko_publisher.get(`tasko:cache:${tko_key}`);
  }

  async setCache(tko_key: string, tko_value: string, tko_ttlMs: number): Promise<void> {
    await this.tko_connect(this.tko_publisher);
    await this.tko_publisher.set(`tasko:cache:${tko_key}`, tko_value, "PX", tko_ttlMs);
  }

  async takeRateLimit(tko_key: string, tko_limit: number, tko_windowMs: number): Promise<RateLimitResult> {
    await this.tko_connect(this.tko_publisher);
    const tko_result = await this.tko_publisher.eval(
      "local current=redis.call('INCR',KEYS[1]); if current==1 then redis.call('PEXPIRE',KEYS[1],ARGV[1]); end; return {current,redis.call('PTTL',KEYS[1])};",
      1,
      `tasko:rate:${tko_key}`,
      tko_windowMs,
    ) as [number, number];
    return {
      allowed: tko_result[0] <= tko_limit,
      remaining: Math.max(0, tko_limit - tko_result[0]),
      retryAfterMs: Math.max(0, tko_result[1]),
    };
  }

  async acquireLock(tko_key: string, tko_ttlMs: number): Promise<DistributedLock | null> {
    await this.tko_connect(this.tko_publisher);
    const tko_token = randomUUID();
    const tko_redisKey = `tasko:lock:${tko_key}`;
    const tko_acquired = await this.tko_publisher.set(tko_redisKey, tko_token, "PX", tko_ttlMs, "NX");
    if (tko_acquired !== "OK") return null;
    return {
      key: tko_key,
      release: async () => {
        await this.tko_publisher.eval(
          "if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('DEL',KEYS[1]); end; return 0;",
          1,
          tko_redisKey,
          tko_token,
        );
      },
    };
  }

  async enqueue(tko_queue: string, tko_payload: string): Promise<void> {
    await this.tko_connect(this.tko_publisher);
    await this.tko_publisher.rpush(`tasko:queue:${tko_queue}`, tko_payload);
  }

  async dequeue(tko_queue: string): Promise<string | null> {
    await this.tko_connect(this.tko_publisher);
    return this.tko_publisher.lpop(`tasko:queue:${tko_queue}`);
  }

  async close(): Promise<void> {
    await Promise.all([this.tko_publisher.quit(), this.tko_subscriber.quit()]);
  }
}

let tko_redisAdapter: TenantRedisAdapter | null = null;

export function createInMemoryRedisAdapter(): TenantRedisAdapter {
  return new NoopRedisAdapter();
}

export function getRedisAdapter(): TenantRedisAdapter {
  if (!tko_redisAdapter) tko_redisAdapter = tko_config.redisUrl ? new RedisAdapter(tko_config.redisUrl) : new NoopRedisAdapter();
  return tko_redisAdapter;
}

export function setRedisAdapterForTests(tko_adapter: TenantRedisAdapter | null): void {
  tko_redisAdapter = tko_adapter;
}
