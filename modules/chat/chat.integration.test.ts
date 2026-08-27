import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PlatformActor } from "../../packages/contracts/src/platform";
import { MemoryPlatformStore, setPlatformStoreForTests } from "../../packages/database/src/platform-store";
import { getChatStore, MemoryChatStore, setChatStoreForTests } from "../../packages/database/src/chat-store";
import { createInMemoryRedisAdapter, getRedisAdapter, setRedisAdapterForTests } from "../../packages/redis/src/redis-adapter";
import { registerOutboxConsumer, processOutboxOnce } from "../worker/src/worker-service";
import * as chat from "./src/chat-service";
import * as workspaceMembership from "../workspace/src/workspace-membership-service";

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

  it("lets an active member create the first channel in an empty workspace", async () => {
    const tko_owner = tko_actor({ memberId: "tko-member-tasko-demo-owner" });
    const tko_membership = (await tko_platform.listTenantMembers(tko_owner.tenantId)).find(tko_member => tko_member.role === "member");
    expect(tko_membership).toBeDefined();
    const tko_member = tko_actor({ authSubject: tko_membership!.authSubject, memberId: tko_membership!.id, role: "member" });

    expect(await chat.listChannels(tko_member)).toEqual([]);
    const tko_created = await chat.createChannel(tko_member, { kind: "public", name: "first-team-room", topic: "The first channel", memberIds: [] });

    expect(tko_created.memberIds).toContain(tko_member.memberId);
    expect((await chat.listChannels(tko_member)).map(tko_channel => tko_channel.id)).toEqual([tko_created.id]);
  });

  it("lets an admin restrict channel creation by role while preserving owner and service automation access", async () => {
    const tko_owner = tko_actor({ memberId: "tko-member-tasko-demo-owner" });
    const tko_members = await tko_platform.listTenantMembers(tko_owner.tenantId);
    const tko_adminMembership = tko_members.find(tko_member => tko_member.role === "admin");
    const tko_memberMembership = tko_members.find(tko_member => tko_member.role === "member");
    expect(tko_adminMembership).toBeDefined();
    expect(tko_memberMembership).toBeDefined();
    const tko_admin = tko_actor({ authSubject: tko_adminMembership!.authSubject, memberId: tko_adminMembership!.id, role: "admin" });
    const tko_member = tko_actor({ authSubject: tko_memberMembership!.authSubject, memberId: tko_memberMembership!.id, role: "member" });

    await chat.updateChannelCreationPolicy(tko_admin, ["owner", "admin"], "channel-policy-admin-only");
    expect((await chat.channelCreationPolicy(tko_member)).allowed).toBe(false);
    await expect(chat.createChannel(tko_member, { kind: "public", name: "not-allowed", memberIds: [] })).rejects.toThrow("CHAT_CHANNEL_CREATION_DISABLED_FOR_ROLE");
    await expect(chat.createChannel(tko_owner, { kind: "public", name: "owner-allowed", memberIds: [] })).resolves.toEqual(expect.objectContaining({ name: "owner-allowed" }));

    await chat.updateChannelCreationPolicy(tko_owner, ["owner", "admin", "member"], "channel-policy-member-enabled");
    expect((await chat.channelCreationPolicy(tko_member)).allowed).toBe(true);
  });

  it("adds selected active workspace members at channel creation and projects their presence state", async () => {
    const tko_owner = tko_actor({ memberId: "tko-member-tasko-demo-owner" });
    const tko_members = await tko_platform.listTenantMembers(tko_owner.tenantId);
    const tko_memberMembership = tko_members.find(tko_member => tko_member.role === "member");
    expect(tko_memberMembership).toBeDefined();
    const tko_member = tko_actor({ authSubject: tko_memberMembership!.authSubject, memberId: tko_memberMembership!.id, role: "member" });

    const tko_channel = await chat.createChannel(tko_owner, { kind: "private", name: "launch-invites", visibility: "private", memberIds: [tko_member.memberId] });
    expect(tko_channel.memberIds).toEqual(expect.arrayContaining([tko_owner.memberId, tko_member.memberId]));
    await chat.setPresence(tko_owner, "online");
    await chat.setPresence(tko_member, "away");

    expect(await chat.channelMembers(tko_owner, tko_channel.id)).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: tko_owner.memberId, presenceStatus: "online", isActive: true }),
      expect.objectContaining({ id: tko_member.memberId, presenceStatus: "away", isActive: true }),
    ]));
  });

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
    const tko_private = await chat.createChannel(tko_owner, { kind: "private", name: "leadership", visibility: "private", memberIds: [] });
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
    expect(await chat.savedEntries(tko_owner)).toEqual(expect.arrayContaining([expect.objectContaining({ saved: expect.objectContaining({ messageId: tko_message.id }), message: expect.objectContaining({ id: tko_message.id, body: expect.objectContaining({ text: "Follow up with the pilot group." }) }), channel: expect.objectContaining({ id: tko_channel.id }) })]));
    expect((await tko_platform.listAuditLogs()).map(tko_event => tko_event.action)).toEqual(expect.arrayContaining(["chat.notification.preference_updated", "chat.message.saved"]));
  });

  it("creates personal reminders with or without a message and forwards accessible message content into another channel", async () => {
    const tko_owner = tko_actor();
    const tko_sourceChannel = await chat.seedDemo(tko_owner);
    const tko_source = await getChatStore().sendMessage(tko_owner, { tenantId: tko_owner.tenantId, channelId: tko_sourceChannel.id, authorMemberId: tko_owner.memberId, clientMessageId: "a95af3e8-5696-4993-aea4-8db720241334", body: { type: "text", text: "Forward the final handoff." }, attachments: [{ id: "72996520-2729-4e92-8bfc-b95b5d2f0953", tenantId: tko_owner.tenantId, objectKey: "tenants/tko-tenant-tasko-demo/attachments/forward/brief.txt", filename: "brief.txt", contentType: "text/plain", url: "/manus-storage/tenants/tko-tenant-tasko-demo/attachments/forward/brief.txt" }] }, "forward-source");
    const tko_targetChannel = await chat.createChannel(tko_owner, { kind: "public", name: "handoff-destination", memberIds: [] });
    const tko_standalone = await chat.createReminder(tko_owner, { title: "Gọi lại khách hàng", note: "Xác nhận khung giờ", reminderAt: new Date("2030-01-02T09:00:00.000Z") }, "reminder-standalone");
    await expect(chat.createReminder(tko_owner, { title: "Không tạo lịch ở development", reminderAt: new Date("2030-01-02T09:30:00.000Z") }, "reminder-development", "session-would-schedule-if-production")).resolves.toEqual(expect.objectContaining({ scheduleCronTaskUid: null }));
    const tko_messageReminder = await chat.createReminder(tko_owner, { title: "Đọc lại handoff", reminderAt: new Date("2030-01-02T10:00:00.000Z"), messageId: tko_source.id }, "reminder-message");
    const tko_snoozed = await chat.snoozeReminder(tko_owner, tko_standalone.id, new Date("2030-01-02T11:00:00.000Z"), "reminder-snooze");
    const tko_subscription = await chat.upsertPushSubscription(tko_owner, { endpoint: "https://fcm.googleapis.com/fcm/send/tasko-test-subscription", p256dh: "test-p256dh-key-material", auth: "test-auth-key-material", userAgent: "Tasko Vitest" }, "push-subscription");
    await getChatStore().setReminderSchedule(tko_owner, tko_standalone.id, "cron-reminder-test");
    expect(await getChatStore().claimReminderPushDelivery("cron-reminder-test")).toEqual(expect.objectContaining({ id: tko_standalone.id }));
    await getChatStore().releaseReminderPushDelivery("cron-reminder-test");
    expect(await getChatStore().claimReminderPushDelivery("cron-reminder-test")).toEqual(expect.objectContaining({ id: tko_standalone.id }));
    await getChatStore().completeReminderPushDelivery("cron-reminder-test");
    expect(await getChatStore().claimReminderPushDelivery("cron-reminder-test")).toBeNull();
    const tko_forwarded = await chat.forwardMessage(tko_owner, { messageId: tko_source.id, targetChannelId: tko_targetChannel.id, note: "Dùng bản này để chốt." }, "forward-message");

    expect(await chat.reminders(tko_owner)).toEqual(expect.arrayContaining([expect.objectContaining({ id: tko_standalone.id, messageId: null, title: "Gọi lại khách hàng" }), expect.objectContaining({ id: tko_messageReminder.id, messageId: tko_source.id })]));
    expect(tko_snoozed).toEqual(expect.objectContaining({ status: "open", reminderAt: new Date("2030-01-02T11:00:00.000Z") }));
    expect(await getChatStore().listPushSubscriptions(tko_owner.tenantId, tko_owner.memberId)).toEqual([expect.objectContaining({ id: tko_subscription.id, endpoint: tko_subscription.endpoint })]);
    expect((await chat.setReminderStatus(tko_owner, tko_standalone.id, "done", "reminder-complete")).status).toBe("done");
    expect(tko_forwarded).toEqual(expect.objectContaining({ channelId: tko_targetChannel.id, authorMemberId: tko_owner.memberId, attachments: [expect.objectContaining({ filename: "brief.txt" })] }));
    expect(tko_forwarded.body.text).toContain("Chuyển tiếp từ #product");
    expect(tko_forwarded.body.text).toContain("Dùng bản này để chốt.");
    expect((await tko_platform.listAuditLogs()).map(tko_event => tko_event.action)).toEqual(expect.arrayContaining(["chat.reminder.created", "chat.reminder.snoozed", "chat.push.subscription_upserted", "chat.reminder.updated", "chat.message.created"]));
  });

  it("links an accessible work item to a message through a durable, auditable mutation", async () => {
    const tko_owner = tko_actor();
    const tko_channel = await chat.seedDemo(tko_owner);
    const tko_message = await chat.sendMessage(tko_owner, { channelId: tko_channel.id, clientMessageId: "8b3d0b25-fd09-4686-88a5-69ce87cbd8ba", body: { type: "text", text: "Please attach this customer decision to the renewal work item." } }, "link-source");

    const tko_linked = await chat.linkWorkItem(tko_owner, tko_message.id, "e0f2122d-4d3e-4d54-846f-303864c59017", "link-work-item");

    expect(tko_linked.linkedWorkItemId).toBe("e0f2122d-4d3e-4d54-846f-303864c59017");
    expect((await chat.messages(tko_owner, tko_channel.id)).find(tko_item => tko_item.id === tko_message.id)?.linkedWorkItemId).toBe(tko_linked.linkedWorkItemId);
    expect((await tko_platform.listAuditLogs()).map(tko_event => tko_event.action)).toContain("chat.message.work_item_linked");
    expect((await tko_platform.listOutbox()).map(tko_event => tko_event.eventType)).toContain("chat.message_linked_work_item.v1");
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
    const tko_workspaceMember = (await tko_platform.listTenantMembers(tko_owner.tenantId)).find(tko_member => tko_member.role === "member");
    expect(tko_workspaceMember).toBeDefined();
    const tko_member = tko_actor({ authSubject: tko_workspaceMember!.authSubject, memberId: tko_workspaceMember!.id, role: "member" });
    const tko_channel = await chat.createChannel(tko_owner, { kind: "private", name: "delivery", visibility: "private", memberIds: [tko_member.memberId] });
    const tko_message = await getChatStore().sendMessage(tko_owner, { tenantId: tko_owner.tenantId, channelId: tko_channel.id, authorMemberId: tko_owner.memberId, clientMessageId: "35403726-451b-440f-a95f-11f8b0e2e2e2", body: { type: "text", text: "Please review the handoff.", mentions: [tko_member.memberId] }, attachments: [{ id: "db3c8a6f-5157-446f-ae1c-461629784c82", tenantId: tko_owner.tenantId, objectKey: "tenants/tko-tenant-tasko-demo/attachments/db3c8a6f/handoff.txt", filename: "handoff.txt", contentType: "text/plain", url: "/manus-storage/tenants/tko-tenant-tasko-demo/attachments/db3c8a6f/handoff.txt" }] }, "mention-attachment");

    expect((await chat.readStates(tko_member)).find(tko_state => tko_state.channelId === tko_channel.id)?.unreadMentions).toBe(1);
    await chat.markRead(tko_member, tko_channel.id, tko_message.sequence);
    expect((await chat.readStates(tko_member)).find(tko_state => tko_state.channelId === tko_channel.id)?.unreadMentions).toBe(0);
    expect((await chat.messages(tko_owner, tko_channel.id)).find(tko_item => tko_item.id === tko_message.id)?.attachments).toEqual([expect.objectContaining({ filename: "handoff.txt", objectKey: expect.stringContaining("attachments/") })]);
  });

  it("returns chronological messages with timestamps for client-side day grouping", async () => {
    const tko_owner = tko_actor();
    const tko_channel = await chat.seedDemo(tko_owner);
    await chat.sendMessage(tko_owner, { channelId: tko_channel.id, clientMessageId: "b7d3c19b-a530-4e4b-9dc8-119d6cb10001", body: { type: "text", text: "Earlier timeline message" } }, "timeline-first");
    await chat.sendMessage(tko_owner, { channelId: tko_channel.id, clientMessageId: "b7d3c19b-a530-4e4b-9dc8-119d6cb10002", body: { type: "text", text: "Later timeline message" } }, "timeline-second");

    const tko_messages = await chat.messages(tko_owner, tko_channel.id);
    expect(tko_messages.map(tko_message => tko_message.sequence)).toEqual([...tko_messages.map(tko_message => tko_message.sequence)].sort((tko_left, tko_right) => tko_left - tko_right));
    expect(tko_messages.every(tko_message => tko_message.createdAt instanceof Date && !Number.isNaN(tko_message.createdAt.getTime()))).toBe(true);
  });

  it("manages named channel lifecycle durably and rejects unauthorized or foreign membership changes", async () => {
    const tko_owner = tko_actor({ memberId: "tko-member-tasko-demo-owner" });
    const tko_private = await chat.createChannel(tko_owner, { kind: "private", name: "launch-room", topic: "Launch planning", visibility: "private", memberIds: [] });
    const tko_candidates = await chat.channelMemberCandidates(tko_owner, tko_private.id);
    const tko_updated = await chat.updateChannel(tko_owner, tko_private.id, { name: "launch-control", topic: "Decision log" }, "channel-update");

    expect(tko_candidates).toEqual(expect.arrayContaining([expect.objectContaining({ id: tko_owner.memberId, isInChannel: true })]));
    expect(tko_updated.name).toBe("launch-control");
    await expect(chat.addChannelMembers(tko_owner, tko_private.id, ["19d1d3e6-dc63-4c3d-bc35-5d87ee977605"], "foreign-member")).rejects.toThrow("CHAT_CHANNEL_MEMBER_NOT_FOUND");
    await expect(chat.updateChannel(tko_actor({ authSubject: "ordinary-member", memberId: "member-not-manager", role: "member" }), tko_private.id, { topic: "Nope" }, "denied-update")).rejects.toThrow("AUTHORIZATION_DENIED");
    await chat.archiveChannel(tko_owner, tko_private.id, "channel-archive");
    expect((await chat.listChannels(tko_owner)).map(tko_channel => tko_channel.id)).not.toContain(tko_private.id);
    expect((await tko_platform.listAuditLogs()).map(tko_event => tko_event.action)).toEqual(expect.arrayContaining(["chat.channel.updated", "chat.channel.archived"]));
  });

  it("allows an active member to create a channel without granting channel management", async () => {
    const tko_owner = tko_actor({ memberId: "tko-member-tasko-demo-owner" });
    const tko_membership = (await tko_platform.listTenantMembers(tko_owner.tenantId)).find(tko_member => tko_member.role === "member");
    expect(tko_membership).toBeDefined();
    const tko_member = tko_actor({ authSubject: tko_membership!.authSubject, memberId: tko_membership!.id, role: "member" });

    const tko_channel = await chat.createChannel(tko_member, { kind: "public", name: "member-created", topic: "Created by a team member", memberIds: [] });

    expect(tko_channel.name).toBe("member-created");
    expect(tko_channel.memberIds).toContain(tko_member.memberId);
    await expect(chat.updateChannel(tko_member, tko_channel.id, { topic: "This must stay protected" }, "member-manage-denied")).rejects.toThrow("AUTHORIZATION_DENIED");
  });

  it("sources channel invites from active workspace members while retaining suspended authors as inactive history", async () => {
    const tko_owner = tko_actor({ memberId: "tko-member-tasko-demo-owner" });
    const tko_workspaceMember = (await tko_platform.listTenantMembers(tko_owner.tenantId)).find(tko_member => tko_member.displayName === "Demo Member");
    expect(tko_workspaceMember).toBeDefined();
    const tko_private = await chat.createChannel(tko_owner, { kind: "private", name: "member-sync", visibility: "private", memberIds: [tko_workspaceMember!.id] });
    await getChatStore().sendMessage(tko_owner, { tenantId: tko_owner.tenantId, channelId: tko_private.id, authorMemberId: tko_workspaceMember!.id, clientMessageId: "c21028cd-ae83-48e2-8940-d5137ca4aa62", body: { type: "text", text: "I will retain this decision in the channel history." }, attachments: [] }, "inactive-author-source");

    expect((await chat.channelMemberCandidates(tko_owner, tko_private.id)).find(tko_candidate => tko_candidate.id === tko_workspaceMember!.id)).toEqual(expect.objectContaining({ isActive: true, isInChannel: true }));
    await workspaceMembership.removeWorkspaceMember({ actor: tko_owner, memberId: tko_workspaceMember!.id, correlationId: "remove-chat-member" });

    expect((await chat.channelMemberCandidates(tko_owner, tko_private.id)).map(tko_candidate => tko_candidate.id)).not.toContain(tko_workspaceMember!.id);
    await expect(chat.addChannelMembers(tko_owner, tko_private.id, [tko_workspaceMember!.id], "invite-inactive-member")).rejects.toThrow("CHAT_CHANNEL_MEMBER_NOT_FOUND");
    expect(await chat.channelMembers(tko_owner, tko_private.id)).toEqual(expect.arrayContaining([expect.objectContaining({ id: tko_workspaceMember!.id, displayName: "Demo Member (inactive account)", isActive: false })]));
    expect((await chat.messages(tko_owner, tko_private.id)).find(tko_message => tko_message.authorMemberId === tko_workspaceMember!.id)?.author).toEqual(expect.objectContaining({ displayName: "Demo Member (inactive account)", isActive: false }));
  });

  it("keeps quote references in-channel and normalizes nested replies onto a single Slack-style thread root", async () => {
    const tko_owner = tko_actor();
    const tko_channel = await chat.seedDemo(tko_owner);
    const tko_root = await chat.sendMessage(tko_owner, { channelId: tko_channel.id, clientMessageId: "e8f8b71e-636e-41e6-ad80-c31d53b61271", body: { type: "text", text: "Root decision" } }, "thread-root");
    const tko_firstReply = await chat.sendMessage(tko_owner, { channelId: tko_channel.id, clientMessageId: "b84c7031-4645-432b-bb14-d11dd47f7c26", parentMessageId: tko_root.id, body: { type: "text", text: "First reply", quotedMessageId: tko_root.id } }, "thread-first");
    const tko_nestedReply = await chat.sendMessage(tko_owner, { channelId: tko_channel.id, clientMessageId: "c85a4f51-4e2e-48e4-8df3-b40fccb4b4f9", parentMessageId: tko_firstReply.id, body: { type: "text", text: "Nested reply" } }, "thread-nested");
    const tko_otherChannel = await chat.createChannel(tko_owner, { kind: "public", name: "other-room", memberIds: [] });

    expect(tko_firstReply.body.quotedMessageId).toBe(tko_root.id);
    expect(tko_nestedReply.parentMessageId).toBe(tko_root.id);
    await expect(chat.sendMessage(tko_owner, { channelId: tko_otherChannel.id, clientMessageId: "8e7369e1-c247-43a1-a3c3-df361869306e", body: { type: "text", text: "Invalid quote", quotedMessageId: tko_root.id } }, "quote-cross-channel")).rejects.toThrow("CHAT_QUOTED_MESSAGE_NOT_FOUND");
  });

  it("projects message authors and aggregated emoji reactions for conversation rendering", async () => {
    const tko_owner = tko_actor();
    const tko_channel = await chat.seedDemo(tko_owner);
    const tko_message = await chat.sendMessage(tko_owner, { channelId: tko_channel.id, clientMessageId: "cad84aa9-dccf-446a-9a7b-a3e2e5ca2b3b", body: { type: "text", text: "Please acknowledge the rollout decision." } }, "reaction-source");

    await chat.toggleReaction(tko_owner, tko_message.id, "✅", "reaction-add");
    const tko_projected = (await chat.messages(tko_owner, tko_channel.id)).find(tko_item => tko_item.id === tko_message.id);

    expect(tko_projected?.author).toEqual(expect.objectContaining({ memberId: tko_owner.memberId }));
    expect(tko_projected?.reactions).toEqual([expect.objectContaining({ emoji: "✅", count: 1, memberIds: [tko_owner.memberId] })]);

    await chat.toggleReaction(tko_owner, tko_message.id, "✅", "reaction-remove");
    const tko_afterRemoval = (await chat.messages(tko_owner, tko_channel.id)).find(tko_item => tko_item.id === tko_message.id);
    expect(tko_afterRemoval?.reactions).toEqual([]);
  });

  it("pins and unpins a channel message separately from Saved/Later", async () => {
    const tko_owner = tko_actor();
    const tko_channel = await chat.seedDemo(tko_owner);
    const tko_message = await chat.sendMessage(tko_owner, { channelId: tko_channel.id, clientMessageId: "e31d33ca-8d22-4724-ae34-b8387554e053", body: { type: "text", text: "Pin this launch decision for the channel." } }, "pin-source");

    await expect(chat.togglePin(tko_owner, tko_message.id, "pin-add")).resolves.toEqual({ pinned: true });
    expect(await chat.pinnedMessages(tko_owner, tko_channel.id)).toEqual([expect.objectContaining({ pin: expect.objectContaining({ messageId: tko_message.id, channelId: tko_channel.id }), message: expect.objectContaining({ id: tko_message.id }) })]);
    await expect(chat.togglePin(tko_owner, tko_message.id, "pin-remove")).resolves.toEqual({ pinned: false });
    expect(await chat.pinnedMessages(tko_owner, tko_channel.id)).toEqual([]);
    expect((await tko_platform.listAuditLogs()).map(tko_event => tko_event.action)).toContain("chat.message.pin_toggled");
  });
});
