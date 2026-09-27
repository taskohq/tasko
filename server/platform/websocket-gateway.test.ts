import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { registerWebSocketGateway } from "./websocket-gateway";
import { MemoryPlatformStore, setPlatformStoreForTests } from "../../packages/database/src/platform-store";
import { getChatStore, MemoryChatStore, setChatStoreForTests } from "../../packages/database/src/chat-store";
import { MemoryWorkStore, getWorkStore, setWorkStoreForTests } from "../../packages/database/src/work-store";
import { createInMemoryRedisAdapter, getRedisAdapter, setRedisAdapterForTests } from "../../packages/redis/src/redis-adapter";
import type { PlatformActor } from "../../packages/contracts/src/platform";

// The gateway authenticates at upgrade via `sdk.authenticateRequest` + tenant resolution; both are
// replaced with fakes so the test exercises the real upgrade, subscription authorization and
// fan-out paths without an OAuth round-trip.
const tko_gatewayAuth = vi.hoisted(() => ({
  openId: "gateway-owner",
  actor: null as PlatformActor | null,
}));
vi.mock("../_core/sdk", () => ({ sdk: { authenticateRequest: async () => ({ openId: tko_gatewayAuth.openId }) } }));
vi.mock("../../modules/tenancy/src/tenant-context", () => ({
  resolveTenantRequestContext: async () => ({ actor: tko_gatewayAuth.actor }),
}));

function tko_actor(tko_tenantId: string, tko_memberId: string, tko_authSubject: string, tko_role: PlatformActor["role"] = "owner"): PlatformActor {
  return { authSubject: tko_authSubject, tenantId: tko_tenantId, tenantSlug: "tasko-demo", memberId: tko_memberId, role: tko_role, membershipStatus: "active", correlationId: "gateway-test" };
}

/** Client wrapper that buffers incoming messages from creation time so nothing is lost between
 * the handshake and the first wait, and supports waiting for the next matching message. */
type TkoClientSocket = {
  socket: WebSocket;
  tko_next(tko_match: (tko_message: Record<string, unknown>) => boolean, tko_timeoutMs?: number): Promise<Record<string, unknown>>;
};

function tko_openSocket(tko_port: number): Promise<TkoClientSocket> {
  return new Promise((tko_resolve, tko_reject) => {
    const tko_socket = new WebSocket(`ws://127.0.0.1:${tko_port}/api/realtime`);
    const tko_buffer: Record<string, unknown>[] = [];
    const tko_waiters: Array<{ tko_match: (tko_message: Record<string, unknown>) => boolean; tko_resolve: (tko_message: Record<string, unknown>) => void; tko_timer: ReturnType<typeof setTimeout> }> = [];
    tko_socket.on("message", tko_raw => {
      const tko_message = JSON.parse(tko_raw.toString()) as Record<string, unknown>;
      const tko_waiterIndex = tko_waiters.findIndex(tko_waiter => tko_waiter.tko_match(tko_message));
      if (tko_waiterIndex >= 0) {
        const [tko_waiter] = tko_waiters.splice(tko_waiterIndex, 1);
        clearTimeout(tko_waiter.tko_timer);
        tko_waiter.tko_resolve(tko_message);
        return;
      }
      tko_buffer.push(tko_message);
    });
    const tko_client: TkoClientSocket = {
      socket: tko_socket,
      tko_next(tko_match, tko_timeoutMs = 2_000) {
        const tko_bufferedIndex = tko_buffer.findIndex(tko_match);
        if (tko_bufferedIndex >= 0) return Promise.resolve(tko_buffer.splice(tko_bufferedIndex, 1)[0]);
        return new Promise((tko_resolveWaiter, tko_rejectWaiter) => {
          const tko_timer = setTimeout(() => tko_rejectWaiter(new Error("gateway message timeout")), tko_timeoutMs);
          tko_waiters.push({ tko_match: tko_match, tko_resolve: tko_resolveWaiter, tko_timer: tko_timer });
        });
      },
    };
    tko_socket.on("open", () => tko_resolve(tko_client));
    tko_socket.on("error", tko_reject);
  });
}

describe("chat realtime over the WebSocket gateway", () => {
  let tko_httpServer: http.Server;
  let tko_closeGateway: (() => Promise<void>) | null = null;
  let tko_port = 0;
  let tko_platform: MemoryPlatformStore;
  let tko_tenantId = "";

  beforeEach(async () => {
    tko_platform = new MemoryPlatformStore();
    setPlatformStoreForTests(tko_platform);
    setChatStoreForTests(new MemoryChatStore());
    setWorkStoreForTests(new MemoryWorkStore());
    setRedisAdapterForTests(createInMemoryRedisAdapter());
    const tko_tenant = await tko_platform.seedDemoWorkspace({ ownerAuthSubject: "gateway-owner", tenantSlug: "tasko-demo" });
    tko_tenantId = tko_tenant.id;
    const tko_ownerMembership = (await tko_platform.listTenantMembers(tko_tenantId)).find(tko_member => tko_member.role === "owner");
    tko_gatewayAuth.actor = tko_actor(tko_tenantId, tko_ownerMembership!.id, "gateway-owner");
    tko_httpServer = http.createServer();
    await new Promise<void>(tko_resolve => tko_httpServer.listen(0, "127.0.0.1", () => tko_resolve()));
    tko_port = (tko_httpServer.address() as AddressInfo).port;
    tko_closeGateway = registerWebSocketGateway(tko_httpServer).close;
  });

  afterEach(async () => {
    if (tko_closeGateway) await tko_closeGateway();
    await new Promise<void>(tko_resolve => tko_httpServer.close(() => tko_resolve()));
    setPlatformStoreForTests(null);
    setChatStoreForTests(null);
    setWorkStoreForTests(null);
    setRedisAdapterForTests(null);
  });

  it("delivers channel-scoped chat events only to subscribers of that channel", async () => {
    const tko_owner = tko_gatewayAuth.actor!;
    const tko_channelA = await getChatStore().createChannel(tko_owner, { tenantId: tko_tenantId, kind: "public", name: "gateway-a", memberIds: [] });
    const tko_channelB = await getChatStore().createChannel(tko_owner, { tenantId: tko_tenantId, kind: "public", name: "gateway-b", memberIds: [] });

    const tko_clientA = await tko_openSocket(tko_port);
    const tko_clientB = await tko_openSocket(tko_port);
    await tko_clientA.tko_next(tko_message => tko_message.type === "connected");
    await tko_clientB.tko_next(tko_message => tko_message.type === "connected");
    tko_clientA.socket.send(JSON.stringify({ type: "subscribe", channelId: tko_channelA.id }));
    tko_clientB.socket.send(JSON.stringify({ type: "subscribe", channelId: tko_channelB.id }));
    const tko_subscribedA = await tko_clientA.tko_next(tko_message => tko_message.type === "subscribed");
    await tko_clientB.tko_next(tko_message => tko_message.type === "subscribed");
    expect(tko_subscribedA.channelId).toBe(tko_channelA.id);

    await getRedisAdapter().publishTenant({ tenantId: tko_tenantId, eventId: "evt-a", eventType: "chat.message_created.v1", payload: { channelId: tko_channelA.id, messageId: "m-a", sequence: 1 } });
    const tko_received = await tko_clientA.tko_next(tko_message => tko_message.type === "event");
    expect(tko_received.eventType).toBe("chat.message_created.v1");
    expect((tko_received.payload as Record<string, unknown>).channelId).toBe(tko_channelA.id);
    // Subscriber of the other channel must not receive the event: give the loop a beat to prove silence.
    await expect(tko_clientB.tko_next(tko_message => tko_message.type === "event", 250)).rejects.toThrow("gateway message timeout");

    tko_clientA.socket.close();
    tko_clientB.socket.close();
  });

  it("forwards ephemeral typing and tenant-wide presence published outside the outbox", async () => {
    const tko_owner = tko_gatewayAuth.actor!;
    const tko_channel = await getChatStore().createChannel(tko_owner, { tenantId: tko_tenantId, kind: "public", name: "gateway-ephemeral", memberIds: [] });
    const tko_client = await tko_openSocket(tko_port);
    await tko_client.tko_next(tko_message => tko_message.type === "connected");
    tko_client.socket.send(JSON.stringify({ type: "subscribe", channelId: tko_channel.id }));
    await tko_client.tko_next(tko_message => tko_message.type === "subscribed");

    await getRedisAdapter().publishTenant({ tenantId: tko_tenantId, eventId: "evt-typing", eventType: "chat.typing_updated.v1", payload: { channelId: tko_channel.id, memberId: tko_owner.memberId, isTyping: true, expiresAt: Date.now() + 8_000 } });
    const tko_typingEvent = await tko_client.tko_next(tko_message => tko_message.type === "event");
    expect(tko_typingEvent.eventType).toBe("chat.typing_updated.v1");

    await getRedisAdapter().publishTenant({ tenantId: tko_tenantId, eventId: "evt-presence", eventType: "chat.presence_updated.v1", payload: { memberId: tko_owner.memberId, status: "online", expiresAt: Date.now() + 90_000 } });
    const tko_presenceEvent = await tko_client.tko_next(tko_message => tko_message.type === "event");
    expect(tko_presenceEvent.eventType).toBe("chat.presence_updated.v1");

    tko_client.socket.close();
  });

  it("keeps the Work board project subscription protocol working", async () => {
    const tko_owner = tko_gatewayAuth.actor!;
    const tko_board = await getWorkStore().seedDemoWork(tko_owner);
    const tko_client = await tko_openSocket(tko_port);
    await tko_client.tko_next(tko_message => tko_message.type === "connected");
    tko_client.socket.send(JSON.stringify({ type: "subscribe", projectId: tko_board.project.id }));
    const tko_subscribed = await tko_client.tko_next(tko_message => tko_message.type === "subscribed");
    expect(tko_subscribed.projectId).toBe(tko_board.project.id);

    await getRedisAdapter().publishTenant({ tenantId: tko_tenantId, eventId: "evt-work", eventType: "work.work_item_created.v1", payload: { workItemId: "w-1" } });
    const tko_workEvent = await tko_client.tko_next(tko_message => tko_message.type === "event");
    expect(tko_workEvent.eventType).toBe("work.work_item_created.v1");

    tko_client.socket.close();
  });

  it("rejects private channel subscriptions for non-members, cross-tenant ids and tenant mismatches", async () => {
    const tko_owner = tko_gatewayAuth.actor!;
    const tko_memberMembership = (await tko_platform.listTenantMembers(tko_tenantId)).find(tko_member => tko_member.role === "member" || tko_member.role === "admin");
    expect(tko_memberMembership).toBeDefined();
    const tko_privateChannel = await getChatStore().createChannel(tko_owner, { tenantId: tko_tenantId, kind: "private", name: "gateway-private", memberIds: [] });
    // Connect as a workspace member who is NOT in the private channel.
    tko_gatewayAuth.actor = tko_actor(tko_tenantId, tko_memberMembership!.id, tko_memberMembership!.authSubject, tko_memberMembership!.role as PlatformActor["role"]);
    const tko_client = await tko_openSocket(tko_port);
    await tko_client.tko_next(tko_message => tko_message.type === "connected");

    // 1. Private channel the caller is not a member of.
    tko_client.socket.send(JSON.stringify({ type: "subscribe", channelId: tko_privateChannel.id }));
    expect((await tko_client.tko_next(tko_message => tko_message.type === "error")).code).toBe("forbidden");

    // 2. Cross-tenant channel id (unknown in this tenant) must not leak existence.
    tko_client.socket.send(JSON.stringify({ type: "subscribe", channelId: "1d1acc46-2c30-4e9f-9a33-2f1e06c5f662" }));
    expect((await tko_client.tko_next(tko_message => tko_message.type === "error")).code).toBe("forbidden");

    // 3. Explicit tenant mismatch is rejected before any lookup.
    tko_client.socket.send(JSON.stringify({ type: "subscribe", channelId: tko_privateChannel.id, tenantId: "another-tenant" }));
    expect((await tko_client.tko_next(tko_message => tko_message.type === "error")).code).toBe("forbidden");

    // The same caller CAN subscribe to a public channel of the tenant.
    const tko_publicChannel = await getChatStore().createChannel(tko_owner, { tenantId: tko_tenantId, kind: "public", name: "gateway-public", memberIds: [] });
    tko_client.socket.send(JSON.stringify({ type: "subscribe", channelId: tko_publicChannel.id }));
    expect((await tko_client.tko_next(tko_message => tko_message.type === "subscribed")).channelId).toBe(tko_publicChannel.id);

    tko_client.socket.close();
    tko_gatewayAuth.actor = tko_owner;
  });
});
