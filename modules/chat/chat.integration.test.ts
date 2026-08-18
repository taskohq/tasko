import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PlatformActor } from "../../packages/contracts/src/platform";
import { MemoryPlatformStore, setPlatformStoreForTests } from "../../packages/database/src/platform-store";
import { getChatStore, MemoryChatStore, setChatStoreForTests } from "../../packages/database/src/chat-store";
import { createInMemoryRedisAdapter, getRedisAdapter, setRedisAdapterForTests } from "../../packages/redis/src/redis-adapter";
import { registerOutboxConsumer, processOutboxOnce } from "../worker/src/worker-service";
import * as chat from "./src/chat-service";

function tko_actor(tko_overrides: Partial<PlatformActor> = {}): PlatformActor {
  return { authSubject: "chat-owner", tenantId: "tko-tenant-tasko-demo", tenantSlug: "tasko-demo", memberId: "tko-member-demo-owner", role: "owner", membershipStatus: "active", correlationId: "chat-test", ...tko_overrides };
}

describe("Collaboration Alpha M2", () => {
  let tko_platform: MemoryPlatformStore;
  beforeEach(async () => {
    tko_platform = new MemoryPlatformStore();
    setPlatformStoreForTests(tko_platform);
    setChatStoreForTests(new MemoryChatStore());
    setRedisAdapterForTests(createInMemoryRedisAdapter());
    await tko_platform.seedDemoWorkspace({ ownerAuthSubject: "chat-owner", tenantSlug: "tasko-demo" });
  });
  afterEach(() => { setPlatformStoreForTests(null); setChatStoreForTests(null); setRedisAdapterForTests(null); });

  it("makes send idempotent and emits a durable tenant-scoped event", async () => {
    const tko_owner = tko_actor();
    const tko_channel = await chat.seedDemo(tko_owner);
    const tko_input = { channelId: tko_channel.id, clientMessageId: "c03a7e15-1f98-4f5e-809c-492a65a5f8c3", body: { type: "text" as const, text: "Ship the pilot", mentions: [] } };
    const tko_first = await chat.sendMessage(tko_owner, tko_input, "send-1");
    const tko_retry = await chat.sendMessage(tko_owner, tko_input, "send-2");

    expect(tko_retry.id).toBe(tko_first.id);
    expect((await chat.messages(tko_owner, tko_channel.id)).filter(tko_message => tko_message.clientMessageId === tko_input.clientMessageId)).toHaveLength(1);
    expect((await tko_platform.listAuditLogs()).filter(tko_event => tko_event.action === "chat.message.created")).toHaveLength(2);
  });

  it("does not expose a private channel to a non-member, even with a known channel id", async () => {
    const tko_owner = tko_actor();
    const tko_private = await chat.createChannel(tko_owner, { kind: "private", name: "leadership", visibility: "private", memberIds: [tko_owner.memberId] });
    const tko_nonMember = tko_actor({ authSubject: "chat-guest", memberId: "member-not-in-private-channel", role: "member" });

    await expect(chat.messages(tko_nonMember, tko_private.id)).rejects.toThrow("AUTHORIZATION_DENIED");
    await expect(chat.search(tko_nonMember, "leadership")).resolves.toEqual([]);
  });

  it("projects a thread, read cursor and tenant-only realtime events", async () => {
    const tko_owner = tko_actor();
    const tko_channel = await chat.seedDemo(tko_owner);
    const tko_root = await chat.sendMessage(tko_owner, { channelId: tko_channel.id, clientMessageId: "52c49174-b4c2-4642-81af-42e573066456", body: { type: "text", text: "Can we decide today?" } }, "root");
    await chat.sendMessage(tko_owner, { channelId: tko_channel.id, clientMessageId: "1597d4dc-2ca9-4f9d-a675-0ac4f5b03844", parentMessageId: tko_root.id, body: { type: "text", text: "Yes, I will post the decision." } }, "reply");
    const tko_read = await chat.markRead(tko_owner, tko_channel.id, 3);
    const tko_received: string[] = [];
    const tko_stop = await getRedisAdapter().subscribeTenant(tko_owner.tenantId, tko_event => tko_received.push(tko_event.eventType));
    registerOutboxConsumer("chat.channel_created.v1", async () => undefined);
    registerOutboxConsumer("chat.message_created.v1", async () => undefined);
    await processOutboxOnce(); await processOutboxOnce(); await processOutboxOnce();

    expect((await chat.messages(tko_owner, tko_channel.id)).find(tko_message => tko_message.id === tko_root.id)?.replyCount).toBe(1);
    expect(tko_read.lastReadSeq).toBe(3);
    expect(tko_received).toContain("chat.message_created.v1");
    await tko_stop();
  });

  it("persists personal notification overrides and Saved/Later metadata through durable events", async () => {
    const tko_owner = tko_actor();
    const tko_channel = await chat.seedDemo(tko_owner);
    const tko_message = await chat.sendMessage(tko_owner, { channelId: tko_channel.id, clientMessageId: "604ae2e4-3e55-4318-bac2-1d3faef12eb2", body: { type: "text", text: "Follow up with the pilot group." } }, "saved-source");

    const tko_preference = await chat.setNotificationPreference(tko_owner, tko_channel.id, "none", "notification-pref");
    const tko_saved = await chat.saveMessage(tko_owner, tko_message.id, { note: "Bring to the weekly review", status: "open" }, "save-message");

    expect(tko_preference.notificationLevel).toBe("none");
    expect(tko_saved.note).toBe("Bring to the weekly review");
    expect(await chat.savedMessages(tko_owner)).toEqual(expect.arrayContaining([expect.objectContaining({ messageId: tko_message.id, memberId: tko_owner.memberId })]));
    expect((await tko_platform.listAuditLogs()).map(tko_event => tko_event.action)).toEqual(expect.arrayContaining(["chat.notification.preference_updated", "chat.message.saved"]));
  });

  it("publishes presence and typing as TTL-bound non-durable tenant events", async () => {
    const tko_owner = tko_actor();
    const tko_channel = await chat.seedDemo(tko_owner);
    const tko_received: string[] = [];
    const tko_stop = await getRedisAdapter().subscribeTenant(tko_owner.tenantId, tko_event => tko_received.push(tko_event.eventType));

    const tko_presence = await chat.setPresence(tko_owner, "online");
    const tko_typing = await chat.setTyping(tko_owner, tko_channel.id, true);

    expect(tko_presence.status).toBe("online");
    expect(tko_typing.isTyping).toBe(true);
    expect(await getRedisAdapter().getCache(`chat:presence:${tko_owner.tenantId}:${tko_owner.memberId}`)).toContain('"online"');
    expect(await getRedisAdapter().getCache(`chat:typing:${tko_owner.tenantId}:${tko_channel.id}:${tko_owner.memberId}`)).toContain('"isTyping":true');
    expect(tko_received).toEqual(expect.arrayContaining(["chat.presence_updated.v1", "chat.typing_updated.v1"]));
    expect(await chat.presence(tko_owner, tko_channel.id)).toEqual(expect.arrayContaining([expect.objectContaining({ memberId: tko_owner.memberId, status: "online" })]));
    await tko_stop();
  });

  it("projects unread mentions, clears them on read, and persists attachment metadata without file bytes", async () => {
    const tko_owner = tko_actor();
    const tko_member = tko_actor({ authSubject: "chat-member", memberId: "9d02f976-0a98-430b-8d30-881ff3c2c6ac", role: "member" });
    const tko_channel = await chat.createChannel(tko_owner, { kind: "private", name: "delivery", visibility: "private", memberIds: [tko_member.memberId] });
    const tko_message = await getChatStore().sendMessage(tko_owner, { tenantId: tko_owner.tenantId, channelId: tko_channel.id, authorMemberId: tko_owner.memberId, clientMessageId: "35403726-451b-440f-a95f-11f8b0e2e2e2", body: { type: "text", text: "Please review the handoff.", mentions: [tko_member.memberId] }, attachments: [{ id: "db3c8a6f-5157-446f-ae1c-461629784c82", tenantId: tko_owner.tenantId, objectKey: "tenants/tko-tenant-tasko-demo/attachments/db3c8a6f/handoff.txt", filename: "handoff.txt", contentType: "text/plain", url: "/manus-storage/tenants/tko-tenant-tasko-demo/attachments/db3c8a6f/handoff.txt" }] }, "mention-attachment");

    expect((await chat.readStates(tko_member)).find(tko_state => tko_state.channelId === tko_channel.id)?.unreadMentions).toBe(1);
    await chat.markRead(tko_member, tko_channel.id, tko_message.sequence);
    expect((await chat.readStates(tko_member)).find(tko_state => tko_state.channelId === tko_channel.id)?.unreadMentions).toBe(0);
    expect((await chat.messages(tko_owner, tko_channel.id)).find(tko_item => tko_item.id === tko_message.id)?.attachments).toEqual([expect.objectContaining({ filename: "handoff.txt", objectKey: expect.stringContaining("attachments/") })]);
  });
});
