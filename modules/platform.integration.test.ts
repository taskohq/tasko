import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PlatformActor } from "../packages/contracts/src/platform";
import {
  MemoryPlatformStore,
  setPlatformStoreForTests,
} from "../packages/database/src/platform-store";
import { setRedisAdapterForTests, getRedisAdapter } from "../packages/redis/src/redis-adapter";
import { can } from "./permissions/src/authorization";
import { resolveTenantRequestContext } from "./tenancy/src/tenant-context";
import { enqueueDurableEvent } from "./events/src/outbox-service";
import { processOutboxOnce, registerOutboxConsumer } from "./worker/src/worker-service";
import { changeMemberRole } from "./tenancy/src/membership-service";

const tko_ownerSubject = "owner-a";
const tko_otherSubject = "owner-b";

function createActor(tko_overrides: Partial<PlatformActor> = {}): PlatformActor {
  return {
    authSubject: tko_ownerSubject,
    tenantId: "tko-tenant-tasko-demo",
    tenantSlug: "tasko-demo",
    memberId: "tko-member-tasko-demo-owner",
    role: "owner",
    membershipStatus: "active",
    correlationId: "correlation-test",
    ...tko_overrides,
  };
}

describe("Tasko M0 platform boundaries", () => {
  let tko_store: MemoryPlatformStore;

  beforeEach(async () => {
    tko_store = new MemoryPlatformStore();
    setPlatformStoreForTests(tko_store);
    setRedisAdapterForTests(null);
    await tko_store.seedDemoWorkspace({ ownerAuthSubject: tko_ownerSubject, tenantSlug: "tasko-demo" });
    await tko_store.seedDemoWorkspace({ ownerAuthSubject: tko_otherSubject, tenantSlug: "other-tenant" });
  });

  afterEach(() => {
    setPlatformStoreForTests(null);
    setRedisAdapterForTests(null);
  });

  it("resolves a tenant only from active server-side membership", async () => {
    const tko_context = await resolveTenantRequestContext({
      authSubject: tko_ownerSubject,
      candidateTenantSlug: "other-tenant",
      correlationId: "request-a",
    });

    // In the single-tenant profile, the server ignores the candidate and resolves the configured workspace.
    expect(tko_context?.actor.tenantSlug).toBe("tasko-demo");
    expect(tko_context?.actor.tenantId).toBe("tko-tenant-tasko-demo");
  });

  it("prevents direct cross-tenant resource access", () => {
    const tko_decision = can(createActor(), "workspace.read", {
      tenantId: "tko-tenant-other-tenant",
      type: "project",
      id: "project-b",
      visibility: "internal",
    });

    expect(tko_decision).toEqual({ allowed: false, reason: "tenant_mismatch" });
  });

  it("denies guest escalation and private resources without an explicit grant", () => {
    const tko_guest = createActor({ role: "guest", memberId: "guest-member" });
    const tko_adminDecision = can(tko_guest, "workspace.members.manage", {
      tenantId: tko_guest.tenantId,
      type: "membership",
      id: "member-2",
      visibility: "internal",
    });
    const tko_privateDecision = can(tko_guest, "workspace.read", {
      tenantId: tko_guest.tenantId,
      type: "channel",
      id: "private-channel",
      visibility: "private",
      explicitMemberIds: ["somebody-else"],
    });

    expect(tko_adminDecision).toEqual({ allowed: false, reason: "capability_missing" });
    expect(tko_privateDecision).toEqual({ allowed: false, reason: "private_resource" });
  });

  it("seeds owner, admin, member, guest and worker identities per tenant", async () => {
    const tko_subjects = [
      tko_ownerSubject,
      "demo-admin:tasko-demo",
      "demo-member:tasko-demo",
      "demo-guest:tasko-demo",
      "service:tasko-worker",
    ];
    const tko_roles = await Promise.all(tko_subjects.map(async tko_subject => (await tko_store.listMemberships(tko_subject))[0]?.role));

    expect(tko_roles).toEqual(["owner", "admin", "member", "guest", "service_account"]);
  });

  it("denies unprivileged role changes and writes audit plus outbox atomically for an owner", async () => {
    const tko_target = (await tko_store.listMemberships("demo-member:tasko-demo"))[0];
    expect(tko_target).toBeDefined();
    await expect(
      changeMemberRole({
        actor: createActor({ role: "guest", memberId: "tko-member-tasko-demo-guest" }),
        memberId: tko_target!.id,
        newRole: "admin",
        correlationId: "guest-denied",
      }),
    ).rejects.toThrow("TASKO_AUTHORIZATION_DENIED:capability_missing");

    await changeMemberRole({
      actor: createActor(),
      memberId: tko_target!.id,
      newRole: "admin",
      correlationId: "owner-role-change",
    });

    expect((await tko_store.listMemberships("demo-member:tasko-demo"))[0]?.role).toBe("admin");
    expect((await tko_store.listAuditLogs())[0]).toMatchObject({
      action: "tenant.membership.role_changed",
      resourceId: tko_target!.id,
    });
    expect(await tko_store.reserveOutbox(5)).toHaveLength(1);
  });

  it("uses the central policy for service-account jobs and denies privilege escalation", async () => {
    let tko_processed = false;
    registerOutboxConsumer(
      "platform.worker_denied.v1",
      async () => {
        tko_processed = true;
      },
      "workspace.members.manage",
    );
    await enqueueDurableEvent({
      actor: createActor(),
      tenantId: "tko-tenant-tasko-demo",
      eventType: "platform.worker_denied.v1",
      topic: "platform.events",
      payload: {},
      action: "platform.worker_denied.queued",
      resourceType: "outbox",
      resourceId: "worker-denied",
      correlationId: "worker-denied",
    });

    expect(await processOutboxOnce()).toBe(1);
    expect(tko_processed).toBe(false);
    expect(
      can(createActor({ role: "service_account", memberId: "tko-member-tasko-demo-service_account" }), "workspace.members.manage", {
        tenantId: "tko-tenant-tasko-demo",
        type: "outbox_job",
        id: "worker-denied",
      }),
    ).toEqual({ allowed: false, reason: "capability_missing" });
  });

  it("provides cache, rate-limit, lock and queue coordination through the Redis boundary", async () => {
    const tko_redis = getRedisAdapter();
    await tko_redis.setCache("tenant-a:summary", "cached", 1_000);
    expect(await tko_redis.getCache("tenant-a:summary")).toBe("cached");
    expect((await tko_redis.takeRateLimit("tenant-a:mutation", 1, 1_000)).allowed).toBe(true);
    expect((await tko_redis.takeRateLimit("tenant-a:mutation", 1, 1_000)).allowed).toBe(false);
    const tko_lock = await tko_redis.acquireLock("tenant-a:outbox", 1_000);
    expect(tko_lock).not.toBeNull();
    expect(await tko_redis.acquireLock("tenant-a:outbox", 1_000)).toBeNull();
    await tko_lock?.release();
    expect(await tko_redis.acquireLock("tenant-a:outbox", 1_000)).not.toBeNull();
    await tko_redis.enqueue("tenant-a:work", "job-1");
    expect(await tko_redis.dequeue("tenant-a:work")).toBe("job-1");
  });

  it("writes audit and outbox records together, then publishes only to the matching tenant", async () => {
    const tko_actor = createActor();
    const tko_received: string[] = [];
    const tko_unsubscribe = await getRedisAdapter().subscribeTenant(tko_actor.tenantId, tko_message => {
      tko_received.push(tko_message.eventId);
    });
    let tko_consumerCalls = 0;
    registerOutboxConsumer("platform.test_event.v1", async () => {
      tko_consumerCalls += 1;
    });

    const tko_outbox = await enqueueDurableEvent({
      actor: tko_actor,
      tenantId: tko_actor.tenantId,
      eventType: "platform.test_event.v1",
      topic: "platform.events",
      payload: { fixture: "tenant-a" },
      action: "platform.test_event.queued",
      resourceType: "outbox",
      resourceId: "test-event",
      correlationId: tko_actor.correlationId,
      metadata: { accessToken: "must-not-appear" },
    });

    expect((await tko_store.listAuditLogs())).toHaveLength(1);
    expect((await tko_store.listAuditLogs())[0]?.metadata.accessToken).toBe("[REDACTED]");
    expect(await processOutboxOnce()).toBe(1);
    expect(tko_consumerCalls).toBe(1);
    expect(tko_received).toEqual([tko_outbox.eventId]);
    await tko_unsubscribe();
  });
});
