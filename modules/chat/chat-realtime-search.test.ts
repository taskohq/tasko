import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PlatformActor } from "../../packages/contracts/src/platform";
import { MemoryPlatformStore, setPlatformStoreForTests } from "../../packages/database/src/platform-store";
import { getChatStore, MemoryChatStore, setChatStoreForTests } from "../../packages/database/src/chat-store";
import { setRedisAdapterForTests, createInMemoryRedisAdapter } from "../../packages/redis/src/redis-adapter";
import * as chat from "./src/chat-service";

function tko_actor(tko_overrides: Partial<PlatformActor> = {}): PlatformActor {
  return { authSubject: "realtime-owner", tenantId: "tko-tenant-tasko-demo", tenantSlug: "tasko-demo", memberId: "tko-member-demo-owner", role: "owner", membershipStatus: "active", correlationId: "realtime-test", ...tko_overrides };
}

describe("Chat realtime, search, idempotency and team mentions (M2)", () => {
  let tko_platform: MemoryPlatformStore;
  let tko_owner: PlatformActor;
  let tko_member: PlatformActor;
  let tko_memberId: string;
  let tko_channelId: string;

  beforeEach(async () => {
    tko_platform = new MemoryPlatformStore();
    setPlatformStoreForTests(tko_platform);
    setChatStoreForTests(new MemoryChatStore());
    setRedisAdapterForTests(createInMemoryRedisAdapter());
    await tko_platform.seedDemoWorkspace({ ownerAuthSubject: "realtime-owner", tenantSlug: "tasko-demo" });
    tko_owner = tko_actor();
    const tko_membership = (await tko_platform.listTenantMembers(tko_owner.tenantId)).find(tko_item => tko_item.role === "member");
    expect(tko_membership).toBeDefined();
    tko_memberId = tko_membership!.id;
    tko_member = tko_actor({ authSubject: tko_membership!.authSubject, memberId: tko_memberId, role: "member" });
    const tko_channel = await chat.createChannel(tko_owner, { kind: "private", name: "realtime-room", visibility: "private", memberIds: [tko_memberId] });
    tko_channelId = tko_channel.id;
  });

  afterEach(() => { setPlatformStoreForTests(null); setChatStoreForTests(null); setRedisAdapterForTests(null); });

  it("scopes message idempotency to tenant + sender + client message id so a retry returns the original message", async () => {
    const tko_otherChannel = await chat.createChannel(tko_owner, { kind: "public", name: "retry-room", memberIds: [] });
    const tko_input = { channelId: tko_channelId, clientMessageId: "9d4b6de2-6cbf-45e5-8db5-3bf6f3a0aa11", body: { type: "text" as const, text: "Delivered once." } };
    const tko_first = await chat.sendMessage(tko_owner, tko_input, "send-first");

    // Same client_message_id on a different channel: the retry resolves to the ORIGINAL message (spec 13 §5).
    const tko_retryOtherChannel = await chat.sendMessage(tko_owner, { ...tko_input, channelId: tko_otherChannel.id }, "send-retry");
    expect(tko_retryOtherChannel.id).toBe(tko_first.id);
    expect(tko_retryOtherChannel.channelId).toBe(tko_channelId);

    // A different sender reusing the id is NOT deduped into the first sender's message.
    const tko_otherSender = await chat.sendMessage(tko_member, { channelId: tko_channelId, clientMessageId: "9d4b6de2-6cbf-45e5-8db5-3bf6f3a0aa11", body: { type: "text" as const, text: "Second sender, own message." } }, "send-other-sender");
    expect(tko_otherSender.id).not.toBe(tko_first.id);
  });

  it("returns only messages after a requested sequence for reconnect resume", async () => {
    const tko_first = await chat.sendMessage(tko_owner, { channelId: tko_channelId, clientMessageId: "1e873766-e2a7-42ec-93de-7de5456dc001", body: { type: "text", text: "before disconnect" } }, "seq-1");
    const tko_second = await chat.sendMessage(tko_owner, { channelId: tko_channelId, clientMessageId: "1e873766-e2a7-42ec-93de-7de5456dc002", body: { type: "text", text: "after disconnect" } }, "seq-2");

    const tko_resume = await chat.messages(tko_owner, tko_channelId, tko_first.sequence);
    expect(tko_resume.map(tko_message => tko_message.id)).toEqual([tko_second.id]);
  });

  it("filters chat search by channel, sender, hasFile, date range and threads with snippets", async () => {
    const tko_otherChannel = await chat.createChannel(tko_owner, { kind: "public", name: "search-other", memberIds: [] });
    // Attachments bypass the upload pipeline: write through the store like chat.integration.test.ts.
    const tko_withFile = await getChatStore().sendMessage(tko_owner, { tenantId: tko_owner.tenantId, channelId: tko_channelId, authorMemberId: tko_owner.memberId, clientMessageId: "7bc2ce1a-4d5a-4f06-9d0f-4c6c8a5aa001", body: { type: "text", text: "alpha decision" }, attachments: [{ id: "8d0e5a6c-72d4-4a80-9be4-4f4b2a63a777", tenantId: tko_owner.tenantId, objectKey: `tenants/${tko_owner.tenantId}/attachments/alpha.txt`, filename: "alpha.txt", contentType: "text/plain", url: "/manus-storage/alpha.txt" }] }, "search-1");
    await chat.sendMessage(tko_owner, { channelId: tko_channelId, clientMessageId: "7bc2ce1a-4d5a-4f06-9d0f-4c6c8a5aa002", body: { type: "text", text: "alpha follow-up" } }, "search-2");
    const tko_fromMember = await chat.sendMessage(tko_member, { channelId: tko_channelId, clientMessageId: "7bc2ce1a-4d5a-4f06-9d0f-4c6c8a5aa003", body: { type: "text", text: "alpha from member" } }, "search-3");
    await chat.sendMessage(tko_owner, { channelId: tko_otherChannel.id, clientMessageId: "7bc2ce1a-4d5a-4f06-9d0f-4c6c8a5aa004", body: { type: "text", text: "alpha elsewhere" } }, "search-4");
    const tko_threadRoot = await chat.sendMessage(tko_owner, { channelId: tko_channelId, clientMessageId: "7bc2ce1a-4d5a-4f06-9d0f-4c6c8a5aa005", body: { type: "text", text: "alpha thread root" } }, "search-5");
    await chat.sendMessage(tko_owner, { channelId: tko_channelId, clientMessageId: "7bc2ce1a-4d5a-4f06-9d0f-4c6c8a5aa006", parentMessageId: tko_threadRoot.id, body: { type: "text", text: "alpha in thread" } }, "search-6");

    expect((await chat.search(tko_owner, "alpha")).length).toBe(6);
    expect((await chat.search(tko_owner, "alpha", { channelId: tko_otherChannel.id })).map(tko_result => tko_result.message.channelId)).toEqual([tko_otherChannel.id]);
    expect((await chat.search(tko_owner, "alpha", { fromMemberId: tko_memberId })).map(tko_result => tko_result.message.id)).toEqual([tko_fromMember.id]);
    expect((await chat.search(tko_owner, "alpha", { hasFile: true })).map(tko_result => tko_result.message.id)).toEqual([tko_withFile.id]);
    expect((await chat.search(tko_owner, "alpha", { inThreads: true })).map(tko_result => tko_result.message.parentMessageId)).toEqual([tko_threadRoot.id]);
    const tko_future = await chat.search(tko_owner, "alpha", { dateFrom: new Date(Date.now() + 3_600_000) });
    expect(tko_future).toEqual([]);
    const tko_all = await chat.search(tko_owner, "alpha", { dateTo: new Date(Date.now() + 3_600_000) });
    expect(tko_all.length).toBe(6);
    // Results carry sender and channel context for the search panel.
    expect((await chat.search(tko_owner, "alpha decision"))[0]).toEqual(expect.objectContaining({
      channel: expect.objectContaining({ id: tko_channelId }),
      message: expect.objectContaining({ author: expect.objectContaining({ memberId: tko_owner.memberId }) }),
    }));

    // Member scope: private channel search only exposes channels they can read.
    const tko_hidden = await chat.createChannel(tko_owner, { kind: "private", name: "search-hidden", visibility: "private", memberIds: [] });
    await chat.sendMessage(tko_owner, { channelId: tko_hidden.id, clientMessageId: "7bc2ce1a-4d5a-4f06-9d0f-4c6c8a5aa007", body: { type: "text", text: "alpha secret" } }, "search-7");
    expect((await chat.search(tko_member, "alpha secret")).length).toBe(0);
  });

  it("expands @team mentions to channel members and rejects unknown teams", async () => {
    const tko_teamId = "3f7ab5e0-2c46-4bd0-8ed0-93a3f9d3c111";
    const tko_store = getChatStore() as MemoryChatStore;
    tko_store.seedTeam(tko_owner.tenantId, tko_teamId, "Delivery", "delivery", [tko_memberId, "member-outside-the-channel"]);
    tko_store.seedTeam(tko_owner.tenantId, "3f7ab5e0-2c46-4bd0-8ed0-93a3f9d3c222", "Ghost", "ghost", []);

    expect(await chat.listMentionableTeams(tko_owner)).toEqual(expect.arrayContaining([expect.objectContaining({ id: tko_teamId, handle: "delivery" })]));

    const tko_mentioned = await chat.sendMessage(tko_owner, { channelId: tko_channelId, clientMessageId: "5c7d1b8e-3a24-4f05-90aa-6fca4c0dd001", body: { type: "text", text: "@delivery please review", teamMentions: [tko_teamId] } }, "team-mention");
    expect(tko_mentioned.body.mentions).toEqual([tko_memberId]);
    expect(tko_mentioned.body.teamMentions).toEqual([tko_teamId]);
    expect((await chat.readStates(tko_member)).find(tko_state => tko_state.channelId === tko_channelId)?.unreadMentions).toBe(1);

    await expect(chat.sendMessage(tko_owner, { channelId: tko_channelId, clientMessageId: "5c7d1b8e-3a24-4f05-90aa-6fca4c0dd002", body: { type: "text", text: "@missing", teamMentions: ["e3a3ea9a-11c2-4d61-9f7f-2a56f65e6999"] } }, "team-missing")).rejects.toThrow("CHAT_TEAM_NOT_FOUND");
  });

  it("stores per-user notification defaults with quiet hours through durable, auditable mutations", async () => {
    expect(await chat.memberNotificationPrefs(tko_owner)).toEqual(expect.objectContaining({ defaultPolicy: "mentions", quietHoursStart: null, quietHoursEnd: null }));

    const tko_updated = await chat.updateMemberNotificationPrefs(tko_owner, { defaultPolicy: "none", quietHoursStart: "22:30", quietHoursEnd: "07:00" }, "prefs-update");
    expect(tko_updated).toEqual({ defaultPolicy: "none", quietHoursStart: "22:30", quietHoursEnd: "07:00" });
    expect(await chat.memberNotificationPrefs(tko_member)).toEqual(expect.objectContaining({ defaultPolicy: "mentions" }));
    expect(await chat.memberNotificationPrefs(tko_owner)).toEqual(expect.objectContaining({ defaultPolicy: "none" }));
    expect((await tko_platform.listAuditLogs()).map(tko_event => tko_event.action)).toContain("chat.notification.member_prefs_updated");
    expect((await tko_platform.listOutbox()).map(tko_event => tko_event.eventType)).toContain("chat.member_notification_prefs_updated.v1");
  });
});
