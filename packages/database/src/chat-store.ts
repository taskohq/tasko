import type { PlatformActor } from "../../contracts/src/platform";
import type { Channel, ChannelKind, ChannelMemberSetting, ChannelNotificationLevel, ChannelReadState, ChatMessage, ChatPin, ChatPushSubscription, ChatReminder, ChatReminderStatus, ChatSearchFilters, ChatSearchResult, ChatTeamSummary, CreateChannelInput, MemberNotificationPrefs, MessageReaction, SaveMessageInput, SavedMessage, SendMessageInput, UpdateChannelInput } from "../../contracts/src/chat";
import { getPlatformStore } from "./platform-store";
import { tko_config } from "../../config/src/tasko-config";
import { PostgresChatStore } from "./postgres-chat-store";

export interface ChatStore {
  readonly mode: "memory" | "postgres";
  listChannels(tenantId: string, memberId: string): Promise<Channel[]>;
  getChannel(tenantId: string, channelId: string): Promise<Channel | null>;
  listMessages(tenantId: string, channelId: string, afterSequence?: number): Promise<ChatMessage[]>;
  getMessage(tenantId: string, messageId: string): Promise<ChatMessage | null>;
  createChannel(actor: PlatformActor, input: CreateChannelInput): Promise<Channel>;
  updateChannel(actor: PlatformActor, channelId: string, input: UpdateChannelInput, correlationId: string): Promise<Channel>;
  archiveChannel(actor: PlatformActor, channelId: string, correlationId: string): Promise<Channel>;
  deleteChannel(actor: PlatformActor, channelId: string, correlationId: string): Promise<void>;
  addChannelMembers(actor: PlatformActor, channelId: string, memberIds: string[], correlationId: string): Promise<Channel>;
  removeChannelMember(actor: PlatformActor, channelId: string, memberId: string, correlationId: string): Promise<Channel>;
  sendMessage(actor: PlatformActor, input: SendMessageInput, correlationId: string): Promise<ChatMessage>;
  editMessage(actor: PlatformActor, messageId: string, text: string, correlationId: string): Promise<ChatMessage>;
  deleteMessage(actor: PlatformActor, messageId: string, correlationId: string): Promise<ChatMessage>;
  toggleReaction(actor: PlatformActor, messageId: string, emoji: string, correlationId: string): Promise<{ added: boolean }>;
  listReadStates(tenantId: string, memberId: string): Promise<ChannelReadState[]>;
  updateReadState(actor: PlatformActor, channelId: string, lastReadSeq: number): Promise<ChannelReadState>;
  setNotificationPreference(actor: PlatformActor, channelId: string, notificationLevel: ChannelNotificationLevel, correlationId: string): Promise<ChannelReadState>;
  listSavedMessages(tenantId: string, memberId: string): Promise<SavedMessage[]>;
  saveMessage(actor: PlatformActor, messageId: string, input: SaveMessageInput, correlationId: string): Promise<SavedMessage>;
  listReminders(tenantId: string, memberId: string, includeCompleted?: boolean): Promise<ChatReminder[]>;
  createReminder(actor: PlatformActor, input: { title: string; note?: string | null; reminderAt: Date; messageId?: string | null }, correlationId: string): Promise<ChatReminder>;
  setReminderStatus(actor: PlatformActor, reminderId: string, status: ChatReminderStatus, correlationId: string): Promise<ChatReminder>;
  snoozeReminder(actor: PlatformActor, reminderId: string, reminderAt: Date, correlationId: string): Promise<ChatReminder>;
  setReminderSchedule(actor: PlatformActor, reminderId: string, taskUid: string | null): Promise<ChatReminder>;
  getReminderByScheduleTaskUid(taskUid: string): Promise<ChatReminder | null>;
  claimReminderPushDelivery(taskUid: string): Promise<ChatReminder | null>;
  completeReminderPushDelivery(taskUid: string): Promise<void>;
  releaseReminderPushDelivery(taskUid: string): Promise<void>;
  upsertPushSubscription(actor: PlatformActor, input: { endpoint: string; p256dh: string; auth: string; userAgent?: string | null }, correlationId: string): Promise<ChatPushSubscription>;
  listPushSubscriptions(tenantId: string, memberId: string): Promise<ChatPushSubscription[]>;
  disablePushSubscription(tenantId: string, endpoint: string): Promise<void>;
  listPinnedMessages(tenantId: string, channelId: string): Promise<ChatPin[]>;
  togglePin(actor: PlatformActor, messageId: string, correlationId: string): Promise<{ pinned: boolean }>;
  search(tenantId: string, memberId: string, query: string, filters?: ChatSearchFilters): Promise<ChatSearchResult[]>;
  getMemberNotificationPrefs(tenantId: string, memberId: string): Promise<MemberNotificationPrefs>;
  setMemberNotificationPrefs(actor: PlatformActor, prefs: MemberNotificationPrefs, correlationId: string): Promise<MemberNotificationPrefs>;
  getTeam(tenantId: string, teamId: string): Promise<ChatTeamSummary | null>;
  listTeamMemberIds(tenantId: string, teamId: string): Promise<string[]>;
  listListableTeams(tenantId: string): Promise<ChatTeamSummary[]>;
  listChannelMemberSettings(tenantId: string, channelId: string): Promise<ChannelMemberSetting[]>;
  linkWorkItem(actor: PlatformActor, messageId: string, workItemId: string, correlationId: string): Promise<ChatMessage>;
  seedDemo(actor: PlatformActor): Promise<Channel>;
}

function cloneChannel(tko_value: Channel): Channel { return { ...tko_value, memberIds: [...tko_value.memberIds], createdAt: new Date(tko_value.createdAt), archivedAt: tko_value.archivedAt && new Date(tko_value.archivedAt) }; }
function cloneMessage(tko_value: ChatMessage): ChatMessage { return { ...tko_value, body: { ...tko_value.body, mentions: [...(tko_value.body.mentions ?? [])] }, attachments: tko_value.attachments.map(tko_attachment => ({ ...tko_attachment })), reactions: tko_value.reactions.map(tko_reaction => ({ ...tko_reaction, memberIds: [...tko_reaction.memberIds] })), author: tko_value.author ? { ...tko_value.author } : undefined, createdAt: new Date(tko_value.createdAt), editedAt: tko_value.editedAt && new Date(tko_value.editedAt), deletedAt: tko_value.deletedAt && new Date(tko_value.deletedAt), latestReplyAt: tko_value.latestReplyAt && new Date(tko_value.latestReplyAt) }; }
function emptyReadState(tko_channelId: string, tko_memberId: string): ChannelReadState { return { channelId: tko_channelId, memberId: tko_memberId, lastReadSeq: 0, lastNotifiedSeq: 0, unreadMentions: 0, notificationLevel: "mentions" }; }
function cloneReminder(tko_value: ChatReminder): ChatReminder { return { ...tko_value, reminderAt: new Date(tko_value.reminderAt), createdAt: new Date(tko_value.createdAt), completedAt: tko_value.completedAt && new Date(tko_value.completedAt) }; }

export class MemoryChatStore implements ChatStore {
  readonly mode = "memory" as const;
  private readonly tko_channels = new Map<string, Channel>();
  private readonly tko_messages = new Map<string, ChatMessage>();
  private readonly tko_clientMessageIndex = new Map<string, string>();
  private readonly tko_reactions = new Map<string, MessageReaction>();
  private readonly tko_reads = new Map<string, ChannelReadState>();
  private readonly tko_savedMessages = new Map<string, SavedMessage>();
  private readonly tko_reminders = new Map<string, ChatReminder>();
  private readonly tko_pushSubscriptions = new Map<string, ChatPushSubscription>();
  private readonly tko_pins = new Map<string, ChatPin>();
  private readonly tko_teams = new Map<string, { tenantId: string; id: string; name: string; handle: string; memberIds: Set<string> }>();
  private readonly tko_memberPrefs = new Map<string, MemberNotificationPrefs>();

  async listChannels(tko_tenantId: string, tko_memberId: string): Promise<Channel[]> {
    return Array.from(this.tko_channels.values()).filter(tko_channel => tko_channel.tenantId === tko_tenantId && !tko_channel.archivedAt && (tko_channel.kind === "public" || tko_channel.memberIds.includes(tko_memberId))).sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "")).map(cloneChannel);
  }
  async getChannel(tko_tenantId: string, tko_channelId: string): Promise<Channel | null> { const tko_value = this.tko_channels.get(tko_channelId); return tko_value?.tenantId === tko_tenantId ? cloneChannel(tko_value) : null; }
  async listMessages(tko_tenantId: string, tko_channelId: string, tko_after = 0): Promise<ChatMessage[]> { return Array.from(this.tko_messages.values()).filter(tko_message => tko_message.tenantId === tko_tenantId && tko_message.channelId === tko_channelId && tko_message.sequence > tko_after).sort((a,b) => a.sequence - b.sequence).map(cloneMessage); }
  async getMessage(tko_tenantId: string, tko_messageId: string): Promise<ChatMessage | null> { const tko_value = this.tko_messages.get(tko_messageId); return tko_value?.tenantId === tko_tenantId ? cloneMessage(tko_value) : null; }
  async createChannel(tko_actor: PlatformActor, tko_input: CreateChannelInput): Promise<Channel> {
    const tko_channel: Channel = { id: crypto.randomUUID(), tenantId: tko_input.tenantId, kind: tko_input.kind, name: tko_input.kind === "public" || tko_input.kind === "private" ? (tko_input.name ?? null) : null, topic: tko_input.topic ?? null, visibility: tko_input.visibility ?? (tko_input.kind === "private" || tko_input.kind === "dm" || tko_input.kind === "group_dm" ? "private" : "internal"), memberIds: Array.from(new Set([tko_actor.memberId, ...tko_input.memberIds])), lastSequence: 0, createdByMemberId: tko_actor.memberId, archivedAt: null, createdAt: new Date(), type: "channel", explicitMemberIds: [] };
    tko_channel.explicitMemberIds = tko_channel.memberIds;
    this.tko_channels.set(tko_channel.id, tko_channel);
    for (const tko_memberId of tko_channel.memberIds) this.tko_reads.set(`${tko_channel.id}:${tko_memberId}`, emptyReadState(tko_channel.id, tko_memberId));
    await getPlatformStore().writeDurableMutation({ actor: tko_actor, tenantId: tko_actor.tenantId, eventType: "chat.channel_created.v1", topic: "chat.channel", payload: { channelId: tko_channel.id, kind: tko_channel.kind }, auditAction: "chat.channel.created", resourceType: "channel", resourceId: tko_channel.id, correlationId: tko_actor.correlationId });
    return cloneChannel(tko_channel);
  }
  async updateChannel(tko_actor: PlatformActor, tko_channelId: string, tko_input: UpdateChannelInput, tko_correlationId: string): Promise<Channel> {
    const tko_channel = this.tko_channels.get(tko_channelId); if (!tko_channel || tko_channel.tenantId !== tko_actor.tenantId || tko_channel.archivedAt) throw new Error("CHAT_CHANNEL_NOT_FOUND");
    if (tko_input.name !== undefined) tko_channel.name = tko_input.name.trim(); if (tko_input.topic !== undefined) tko_channel.topic = tko_input.topic?.trim() || null; if (tko_input.visibility !== undefined) tko_channel.visibility = tko_input.visibility;
    await getPlatformStore().writeDurableMutation({ actor: tko_actor, tenantId: tko_actor.tenantId, eventType: "chat.channel_updated.v1", topic: "chat.channel", payload: { channelId: tko_channelId }, auditAction: "chat.channel.updated", resourceType: "channel", resourceId: tko_channelId, correlationId: tko_correlationId }); return cloneChannel(tko_channel);
  }
  async archiveChannel(tko_actor: PlatformActor, tko_channelId: string, tko_correlationId: string): Promise<Channel> {
    const tko_channel = this.tko_channels.get(tko_channelId); if (!tko_channel || tko_channel.tenantId !== tko_actor.tenantId || tko_channel.archivedAt) throw new Error("CHAT_CHANNEL_NOT_FOUND"); tko_channel.archivedAt = new Date();
    await getPlatformStore().writeDurableMutation({ actor: tko_actor, tenantId: tko_actor.tenantId, eventType: "chat.channel_archived.v1", topic: "chat.channel", payload: { channelId: tko_channelId }, auditAction: "chat.channel.archived", resourceType: "channel", resourceId: tko_channelId, correlationId: tko_correlationId }); return cloneChannel(tko_channel);
  }
  async deleteChannel(tko_actor: PlatformActor, tko_channelId: string, tko_correlationId: string): Promise<void> {
    const tko_channel = this.tko_channels.get(tko_channelId); if (!tko_channel || tko_channel.tenantId !== tko_actor.tenantId) throw new Error("CHAT_CHANNEL_NOT_FOUND"); this.tko_channels.delete(tko_channelId);
    for (const [tko_id, tko_message] of Array.from(this.tko_messages.entries())) if (tko_message.channelId === tko_channelId) { this.tko_messages.delete(tko_id); this.tko_pins.delete(tko_id); } for (const tko_key of Array.from(this.tko_reads.keys())) if (tko_key.startsWith(`${tko_channelId}:`)) this.tko_reads.delete(tko_key);
    await getPlatformStore().writeDurableMutation({ actor: tko_actor, tenantId: tko_actor.tenantId, eventType: "chat.channel_deleted.v1", topic: "chat.channel", payload: { channelId: tko_channelId }, auditAction: "chat.channel.deleted", resourceType: "channel", resourceId: tko_channelId, correlationId: tko_correlationId });
  }
  async addChannelMembers(tko_actor: PlatformActor, tko_channelId: string, tko_memberIds: string[], tko_correlationId: string): Promise<Channel> {
    const tko_channel = this.tko_channels.get(tko_channelId); if (!tko_channel || tko_channel.tenantId !== tko_actor.tenantId || tko_channel.archivedAt) throw new Error("CHAT_CHANNEL_NOT_FOUND"); const tko_added = tko_memberIds.filter(tko_memberId => !tko_channel.memberIds.includes(tko_memberId)); tko_channel.memberIds.push(...tko_added); tko_channel.explicitMemberIds = [...tko_channel.memberIds]; for (const tko_memberId of tko_added) this.tko_reads.set(`${tko_channelId}:${tko_memberId}`, emptyReadState(tko_channelId, tko_memberId));
    await getPlatformStore().writeDurableMutation({ actor: tko_actor, tenantId: tko_actor.tenantId, eventType: "chat.channel_members_added.v1", topic: "chat.channel", payload: { channelId: tko_channelId, memberIds: tko_added }, auditAction: "chat.channel.members_added", resourceType: "channel", resourceId: tko_channelId, correlationId: tko_correlationId }); return cloneChannel(tko_channel);
  }
  async removeChannelMember(tko_actor: PlatformActor, tko_channelId: string, tko_memberId: string, tko_correlationId: string): Promise<Channel> {
    const tko_channel = this.tko_channels.get(tko_channelId); if (!tko_channel || tko_channel.tenantId !== tko_actor.tenantId || tko_channel.archivedAt) throw new Error("CHAT_CHANNEL_NOT_FOUND"); tko_channel.memberIds = tko_channel.memberIds.filter(tko_value => tko_value !== tko_memberId); tko_channel.explicitMemberIds = [...tko_channel.memberIds]; this.tko_reads.delete(`${tko_channelId}:${tko_memberId}`);
    await getPlatformStore().writeDurableMutation({ actor: tko_actor, tenantId: tko_actor.tenantId, eventType: "chat.channel_member_removed.v1", topic: "chat.channel", payload: { channelId: tko_channelId, memberId: tko_memberId }, auditAction: "chat.channel.member_removed", resourceType: "channel", resourceId: tko_channelId, correlationId: tko_correlationId }); return cloneChannel(tko_channel);
  }
  async sendMessage(tko_actor: PlatformActor, tko_input: SendMessageInput, tko_correlationId: string): Promise<ChatMessage> {
    const tko_idempotencyKey = `${tko_input.tenantId}:${tko_input.authorMemberId}:${tko_input.clientMessageId}`;
    const tko_existingId = this.tko_clientMessageIndex.get(tko_idempotencyKey);
    if (tko_existingId) { const tko_existing = this.tko_messages.get(tko_existingId); if (tko_existing) return cloneMessage(tko_existing); this.tko_clientMessageIndex.delete(tko_idempotencyKey); }
    const tko_channel = this.tko_channels.get(tko_input.channelId);
    if (!tko_channel || tko_channel.tenantId !== tko_input.tenantId) throw new Error("CHAT_CHANNEL_NOT_FOUND");
    tko_channel.lastSequence += 1;
    const tko_message: ChatMessage = { id: crypto.randomUUID(), tenantId: tko_input.tenantId, channelId: tko_input.channelId, sequence: tko_channel.lastSequence, clientMessageId: tko_input.clientMessageId, authorMemberId: tko_input.authorMemberId, body: { ...tko_input.body, mentions: [...(tko_input.body.mentions ?? [])] }, plainText: tko_input.body.text, attachments: (tko_input.attachments ?? []).map(tko_attachment => ({ ...tko_attachment })), parentMessageId: tko_input.parentMessageId ?? null, replyCount: 0, latestReplyAt: null, linkedWorkItemId: null, reactions: [], editedAt: null, deletedAt: null, createdAt: new Date() };
    this.tko_messages.set(tko_message.id, tko_message); this.tko_clientMessageIndex.set(tko_idempotencyKey, tko_message.id);
    if (tko_message.parentMessageId) { const tko_root = this.tko_messages.get(tko_message.parentMessageId); if (tko_root) { tko_root.replyCount += 1; tko_root.latestReplyAt = tko_message.createdAt; } }
    for (const tko_memberId of Array.from(new Set(tko_message.body.mentions ?? []))) {
      if (tko_memberId === tko_actor.memberId || !tko_channel.memberIds.includes(tko_memberId)) continue;
      const tko_key = `${tko_channel.id}:${tko_memberId}`;
      const tko_previous = this.tko_reads.get(tko_key) ?? emptyReadState(tko_channel.id, tko_memberId);
      this.tko_reads.set(tko_key, { ...tko_previous, unreadMentions: tko_previous.unreadMentions + 1, lastNotifiedSeq: tko_message.sequence });
    }
    await getPlatformStore().writeDurableMutation({ actor: tko_actor, tenantId: tko_actor.tenantId, eventType: "chat.message_created.v1", topic: "chat.message", payload: { channelId: tko_message.channelId, messageId: tko_message.id, sequence: tko_message.sequence, parentMessageId: tko_message.parentMessageId, attachmentCount: tko_message.attachments.length, mentionCount: tko_message.body.mentions?.length ?? 0, mentionMemberIds: Array.from(new Set(tko_message.body.mentions ?? [])), teamMentionIds: Array.from(new Set(tko_message.body.teamMentions ?? [])) }, auditAction: "chat.message.created", resourceType: "message", resourceId: tko_message.id, correlationId: tko_correlationId });
    return cloneMessage(tko_message);
  }
  async editMessage(tko_actor: PlatformActor, tko_messageId: string, tko_text: string, tko_correlationId: string): Promise<ChatMessage> { const tko_message = this.tko_messages.get(tko_messageId); if (!tko_message || tko_message.tenantId !== tko_actor.tenantId) throw new Error("CHAT_MESSAGE_NOT_FOUND"); tko_message.body = { ...tko_message.body, text: tko_text }; tko_message.plainText = tko_text; tko_message.editedAt = new Date(); await getPlatformStore().writeDurableMutation({ actor: tko_actor, tenantId: tko_actor.tenantId, eventType: "chat.message_updated.v1", topic: "chat.message", payload: { channelId: tko_message.channelId, messageId: tko_message.id }, auditAction: "chat.message.edited", resourceType: "message", resourceId: tko_message.id, correlationId: tko_correlationId }); return cloneMessage(tko_message); }
  async deleteMessage(tko_actor: PlatformActor, tko_messageId: string, tko_correlationId: string): Promise<ChatMessage> { const tko_message = this.tko_messages.get(tko_messageId); if (!tko_message || tko_message.tenantId !== tko_actor.tenantId) throw new Error("CHAT_MESSAGE_NOT_FOUND"); tko_message.deletedAt = new Date(); tko_message.body = { type: "text", text: "This message was deleted." }; tko_message.plainText = ""; await getPlatformStore().writeDurableMutation({ actor: tko_actor, tenantId: tko_actor.tenantId, eventType: "chat.message_deleted.v1", topic: "chat.message", payload: { channelId: tko_message.channelId, messageId: tko_message.id }, auditAction: "chat.message.deleted", resourceType: "message", resourceId: tko_message.id, correlationId: tko_correlationId }); return cloneMessage(tko_message); }
  async toggleReaction(tko_actor: PlatformActor, tko_messageId: string, tko_emoji: string, tko_correlationId: string): Promise<{ added: boolean }> { const tko_key = `${tko_messageId}:${tko_actor.memberId}:${tko_emoji}`; const tko_added = !this.tko_reactions.has(tko_key); if (tko_added) this.tko_reactions.set(tko_key, { messageId: tko_messageId, memberId: tko_actor.memberId, emoji: tko_emoji, createdAt: new Date() }); else this.tko_reactions.delete(tko_key); const tko_message = this.tko_messages.get(tko_messageId); if (tko_message) { const tko_existing = tko_message.reactions.find(tko_reaction => tko_reaction.emoji === tko_emoji); if (tko_added) { if (tko_existing) { tko_existing.memberIds = Array.from(new Set([...tko_existing.memberIds, tko_actor.memberId])); tko_existing.count = tko_existing.memberIds.length; } else tko_message.reactions.push({ emoji: tko_emoji, count: 1, memberIds: [tko_actor.memberId] }); } else if (tko_existing) { tko_existing.memberIds = tko_existing.memberIds.filter(tko_memberId => tko_memberId !== tko_actor.memberId); tko_existing.count = tko_existing.memberIds.length; tko_message.reactions = tko_message.reactions.filter(tko_reaction => tko_reaction.count > 0); } } await getPlatformStore().writeDurableMutation({ actor: tko_actor, tenantId: tko_actor.tenantId, eventType: "chat.reaction_toggled.v1", topic: "chat.message", payload: { channelId: tko_message?.channelId ?? null, messageId: tko_messageId, emoji: tko_emoji, added: tko_added }, auditAction: "chat.reaction.toggled", resourceType: "message", resourceId: tko_messageId, correlationId: tko_correlationId }); return { added: tko_added }; }
  async listReadStates(tko_tenantId: string, tko_memberId: string): Promise<ChannelReadState[]> { const tko_channels = await this.listChannels(tko_tenantId, tko_memberId); return tko_channels.map(tko_channel => ({ ...(this.tko_reads.get(`${tko_channel.id}:${tko_memberId}`) ?? emptyReadState(tko_channel.id, tko_memberId)) })); }
  async updateReadState(tko_actor: PlatformActor, tko_channelId: string, tko_lastReadSeq: number): Promise<ChannelReadState> { const tko_key = `${tko_channelId}:${tko_actor.memberId}`; const tko_previous = this.tko_reads.get(tko_key) ?? emptyReadState(tko_channelId, tko_actor.memberId); const tko_nextReadSeq = Math.max(tko_previous.lastReadSeq, tko_lastReadSeq); const tko_unreadMentions = Array.from(this.tko_messages.values()).filter(tko_message => tko_message.tenantId === tko_actor.tenantId && tko_message.channelId === tko_channelId && tko_message.sequence > tko_nextReadSeq && tko_message.body.mentions?.includes(tko_actor.memberId)).length; const tko_state = { ...tko_previous, lastReadSeq: tko_nextReadSeq, unreadMentions: tko_unreadMentions }; this.tko_reads.set(tko_key, tko_state); await getPlatformStore().writeDurableMutation({ actor: tko_actor, tenantId: tko_actor.tenantId, eventType: "chat.read_cursor_updated.v1", topic: "chat.read", payload: { channelId: tko_channelId, lastReadSeq: tko_state.lastReadSeq }, auditAction: "chat.read_cursor.updated", resourceType: "channel", resourceId: tko_channelId, correlationId: tko_actor.correlationId }); return { ...tko_state }; }
  async setNotificationPreference(tko_actor: PlatformActor, tko_channelId: string, tko_notificationLevel: ChannelNotificationLevel, tko_correlationId: string): Promise<ChannelReadState> { const tko_key = `${tko_channelId}:${tko_actor.memberId}`; const tko_previous = this.tko_reads.get(tko_key) ?? emptyReadState(tko_channelId, tko_actor.memberId); const tko_state = { ...tko_previous, notificationLevel: tko_notificationLevel }; this.tko_reads.set(tko_key, tko_state); await getPlatformStore().writeDurableMutation({ actor: tko_actor, tenantId: tko_actor.tenantId, eventType: "chat.notification_preference_updated.v1", topic: "chat.notification", payload: { channelId: tko_channelId, notificationLevel: tko_notificationLevel }, auditAction: "chat.notification.preference_updated", resourceType: "channel", resourceId: tko_channelId, correlationId: tko_correlationId }); return { ...tko_state }; }
  async listSavedMessages(tko_tenantId: string, tko_memberId: string): Promise<SavedMessage[]> { return Array.from(this.tko_savedMessages.values()).filter(tko_saved => tko_saved.tenantId === tko_tenantId && tko_saved.memberId === tko_memberId).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).map(tko_saved => ({ ...tko_saved, reminderAt: tko_saved.reminderAt && new Date(tko_saved.reminderAt), createdAt: new Date(tko_saved.createdAt) })); }
  async saveMessage(tko_actor: PlatformActor, tko_messageId: string, tko_input: SaveMessageInput, tko_correlationId: string): Promise<SavedMessage> { const tko_message = this.tko_messages.get(tko_messageId); if (!tko_message || tko_message.tenantId !== tko_actor.tenantId) throw new Error("CHAT_MESSAGE_NOT_FOUND"); const tko_key = `${tko_messageId}:${tko_actor.memberId}`; const tko_saved: SavedMessage = { tenantId: tko_actor.tenantId, messageId: tko_messageId, memberId: tko_actor.memberId, status: tko_input.status ?? "open", note: tko_input.note ?? null, reminderAt: tko_input.reminderAt ?? null, createdAt: this.tko_savedMessages.get(tko_key)?.createdAt ?? new Date() }; this.tko_savedMessages.set(tko_key, tko_saved); await getPlatformStore().writeDurableMutation({ actor: tko_actor, tenantId: tko_actor.tenantId, eventType: "chat.message_saved.v1", topic: "chat.saved", payload: { messageId: tko_messageId, status: tko_saved.status }, auditAction: "chat.message.saved", resourceType: "message", resourceId: tko_messageId, correlationId: tko_correlationId }); return { ...tko_saved, reminderAt: tko_saved.reminderAt && new Date(tko_saved.reminderAt), createdAt: new Date(tko_saved.createdAt) }; }
  async listReminders(tko_tenantId: string, tko_memberId: string, tko_includeCompleted = false): Promise<ChatReminder[]> { return Array.from(this.tko_reminders.values()).filter(tko_reminder => tko_reminder.tenantId === tko_tenantId && tko_reminder.memberId === tko_memberId && (tko_includeCompleted || tko_reminder.status === "open")).sort((tko_left, tko_right) => tko_left.reminderAt.getTime() - tko_right.reminderAt.getTime()).map(cloneReminder); }
  async createReminder(tko_actor: PlatformActor, tko_input: { title: string; note?: string | null; reminderAt: Date; messageId?: string | null }, tko_correlationId: string): Promise<ChatReminder> { const tko_reminder: ChatReminder = { id: crypto.randomUUID(), tenantId: tko_actor.tenantId, memberId: tko_actor.memberId, messageId: tko_input.messageId ?? null, title: tko_input.title.trim(), note: tko_input.note?.trim() || null, reminderAt: new Date(tko_input.reminderAt), status: "open", createdAt: new Date(), completedAt: null, scheduleCronTaskUid: null, pushDeliveredAt: null }; this.tko_reminders.set(tko_reminder.id, tko_reminder); await getPlatformStore().writeDurableMutation({ actor: tko_actor, tenantId: tko_actor.tenantId, eventType: "chat.reminder_created.v1", topic: "chat.reminder", payload: { reminderId: tko_reminder.id, messageId: tko_reminder.messageId }, auditAction: "chat.reminder.created", resourceType: "chat_reminder", resourceId: tko_reminder.id, correlationId: tko_correlationId }); return cloneReminder(tko_reminder); }
  async setReminderStatus(tko_actor: PlatformActor, tko_reminderId: string, tko_status: ChatReminderStatus, tko_correlationId: string): Promise<ChatReminder> { const tko_reminder = this.tko_reminders.get(tko_reminderId); if (!tko_reminder || tko_reminder.tenantId !== tko_actor.tenantId || tko_reminder.memberId !== tko_actor.memberId) throw new Error("CHAT_REMINDER_NOT_FOUND"); tko_reminder.status = tko_status; tko_reminder.completedAt = tko_status === "open" ? null : new Date(); await getPlatformStore().writeDurableMutation({ actor: tko_actor, tenantId: tko_actor.tenantId, eventType: "chat.reminder_updated.v1", topic: "chat.reminder", payload: { reminderId: tko_reminder.id, status: tko_status }, auditAction: "chat.reminder.updated", resourceType: "chat_reminder", resourceId: tko_reminder.id, correlationId: tko_correlationId }); return cloneReminder(tko_reminder); }
  async snoozeReminder(tko_actor: PlatformActor, tko_reminderId: string, tko_reminderAt: Date, tko_correlationId: string): Promise<ChatReminder> { const tko_reminder = this.tko_reminders.get(tko_reminderId); if (!tko_reminder || tko_reminder.tenantId !== tko_actor.tenantId || tko_reminder.memberId !== tko_actor.memberId) throw new Error("CHAT_REMINDER_NOT_FOUND"); tko_reminder.reminderAt = new Date(tko_reminderAt); tko_reminder.status = "open"; tko_reminder.completedAt = null; tko_reminder.pushDeliveredAt = null; await getPlatformStore().writeDurableMutation({ actor: tko_actor, tenantId: tko_actor.tenantId, eventType: "chat.reminder_snoozed.v1", topic: "chat.reminder", payload: { reminderId: tko_reminder.id, reminderAt: tko_reminder.reminderAt.toISOString() }, auditAction: "chat.reminder.snoozed", resourceType: "chat_reminder", resourceId: tko_reminder.id, correlationId: tko_correlationId }); return cloneReminder(tko_reminder); }
  async setReminderSchedule(tko_actor: PlatformActor, tko_reminderId: string, tko_taskUid: string | null): Promise<ChatReminder> { const tko_reminder = this.tko_reminders.get(tko_reminderId); if (!tko_reminder || tko_reminder.tenantId !== tko_actor.tenantId || tko_reminder.memberId !== tko_actor.memberId) throw new Error("CHAT_REMINDER_NOT_FOUND"); tko_reminder.scheduleCronTaskUid = tko_taskUid; return cloneReminder(tko_reminder); }
  async getReminderByScheduleTaskUid(tko_taskUid: string): Promise<ChatReminder | null> { const tko_reminder = Array.from(this.tko_reminders.values()).find(tko_item => tko_item.scheduleCronTaskUid === tko_taskUid); return tko_reminder ? cloneReminder(tko_reminder) : null; }
  async claimReminderPushDelivery(tko_taskUid: string): Promise<ChatReminder | null> { const tko_reminder = await this.getReminderByScheduleTaskUid(tko_taskUid); if (!tko_reminder || tko_reminder.status !== "open" || tko_reminder.pushDeliveredAt) return null; return tko_reminder; }
  async completeReminderPushDelivery(tko_taskUid: string): Promise<void> { const tko_reminder = Array.from(this.tko_reminders.values()).find(tko_item => tko_item.scheduleCronTaskUid === tko_taskUid); if (tko_reminder) tko_reminder.pushDeliveredAt = new Date(); }
  async releaseReminderPushDelivery(_tko_taskUid: string): Promise<void> { }
  async upsertPushSubscription(tko_actor: PlatformActor, tko_input: { endpoint: string; p256dh: string; auth: string; userAgent?: string | null }, tko_correlationId: string): Promise<ChatPushSubscription> { const tko_existing = Array.from(this.tko_pushSubscriptions.values()).find(tko_item => tko_item.endpoint === tko_input.endpoint); const tko_subscription: ChatPushSubscription = { id: tko_existing?.id ?? crypto.randomUUID(), tenantId: tko_actor.tenantId, memberId: tko_actor.memberId, endpoint: tko_input.endpoint, p256dh: tko_input.p256dh, auth: tko_input.auth, userAgent: tko_input.userAgent ?? null, createdAt: tko_existing?.createdAt ?? new Date(), updatedAt: new Date() }; this.tko_pushSubscriptions.set(tko_subscription.id, tko_subscription); await getPlatformStore().writeDurableMutation({ actor: tko_actor, tenantId: tko_actor.tenantId, eventType: "chat.push_subscription_upserted.v1", topic: "chat.push", payload: { subscriptionId: tko_subscription.id }, auditAction: "chat.push.subscription_upserted", resourceType: "push_subscription", resourceId: tko_subscription.id, correlationId: tko_correlationId }); return { ...tko_subscription, createdAt: new Date(tko_subscription.createdAt), updatedAt: new Date(tko_subscription.updatedAt) }; }
  async listPushSubscriptions(tko_tenantId: string, tko_memberId: string): Promise<ChatPushSubscription[]> { return Array.from(this.tko_pushSubscriptions.values()).filter(tko_item => tko_item.tenantId === tko_tenantId && tko_item.memberId === tko_memberId).map(tko_item => ({ ...tko_item, createdAt: new Date(tko_item.createdAt), updatedAt: new Date(tko_item.updatedAt) })); }
  async disablePushSubscription(_tko_tenantId: string, tko_endpoint: string): Promise<void> { for (const [tko_id, tko_subscription] of Array.from(this.tko_pushSubscriptions.entries())) if (tko_subscription.endpoint === tko_endpoint) this.tko_pushSubscriptions.delete(tko_id); }
  async listPinnedMessages(tko_tenantId: string, tko_channelId: string): Promise<ChatPin[]> { return Array.from(this.tko_pins.values()).filter(tko_pin => tko_pin.tenantId === tko_tenantId && tko_pin.channelId === tko_channelId).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).map(tko_pin => ({ ...tko_pin, createdAt: new Date(tko_pin.createdAt) })); }
  async togglePin(tko_actor: PlatformActor, tko_messageId: string, tko_correlationId: string): Promise<{ pinned: boolean }> { const tko_message = this.tko_messages.get(tko_messageId); if (!tko_message || tko_message.tenantId !== tko_actor.tenantId || tko_message.deletedAt) throw new Error("CHAT_MESSAGE_NOT_FOUND"); const tko_pinned = !this.tko_pins.has(tko_messageId); if (tko_pinned) this.tko_pins.set(tko_messageId, { tenantId: tko_actor.tenantId, channelId: tko_message.channelId, messageId: tko_messageId, pinnedByMemberId: tko_actor.memberId, createdAt: new Date() }); else this.tko_pins.delete(tko_messageId); await getPlatformStore().writeDurableMutation({ actor: tko_actor, tenantId: tko_actor.tenantId, eventType: "chat.message_pin_toggled.v1", topic: "chat.pin", payload: { channelId: tko_message.channelId, messageId: tko_messageId, pinned: tko_pinned }, auditAction: "chat.message.pin_toggled", resourceType: "message", resourceId: tko_messageId, correlationId: tko_correlationId }); return { pinned: tko_pinned }; }
  async search(tko_tenantId: string, tko_memberId: string, tko_query: string, tko_filters?: ChatSearchFilters): Promise<ChatSearchResult[]> {
    const tko_needleTokens = tko_query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
    const tko_limit = tko_filters?.limit ?? 50;
    const tko_accessible = new Set((await this.listChannels(tko_tenantId, tko_memberId)).map(tko_channel => tko_channel.id).filter(tko_channelId => !tko_filters?.channelId || tko_channelId === tko_filters.channelId));
    const tko_dateFrom = tko_filters?.dateFrom ? new Date(tko_filters.dateFrom).getTime() : null;
    const tko_dateTo = tko_filters?.dateTo ? new Date(tko_filters.dateTo).getTime() : null;
    return Array.from(this.tko_messages.values()).filter(tko_message => {
      if (tko_message.tenantId !== tko_tenantId || !tko_accessible.has(tko_message.channelId) || tko_message.deletedAt) return false;
      const tko_text = tko_message.plainText.toLocaleLowerCase();
      if (tko_needleTokens.some(tko_token => !tko_text.includes(tko_token))) return false;
      if (tko_filters?.fromMemberId && tko_message.authorMemberId !== tko_filters.fromMemberId) return false;
      if (tko_filters?.hasFile && !tko_message.attachments.length) return false;
      if (tko_filters?.inThreads && !tko_message.parentMessageId) return false;
      if (tko_dateFrom !== null && tko_message.createdAt.getTime() < tko_dateFrom) return false;
      if (tko_dateTo !== null && tko_message.createdAt.getTime() > tko_dateTo) return false;
      return true;
    }).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, tko_limit).map(tko_message => {
      const tko_channel = this.tko_channels.get(tko_message.channelId)!;
      return { message: cloneMessage(tko_message), channel: { id: tko_channel.id, kind: tko_channel.kind, name: tko_channel.name }, snippet: tko_message.plainText.slice(0, 220) };
    });
  }
  async linkWorkItem(tko_actor: PlatformActor, tko_messageId: string, tko_workItemId: string, tko_correlationId: string): Promise<ChatMessage> { const tko_message = this.tko_messages.get(tko_messageId); if (!tko_message || tko_message.tenantId !== tko_actor.tenantId) throw new Error("CHAT_MESSAGE_NOT_FOUND"); tko_message.linkedWorkItemId = tko_workItemId; await getPlatformStore().writeDurableMutation({ actor: tko_actor, tenantId: tko_actor.tenantId, eventType: "chat.message_linked_work_item.v1", topic: "chat.message", payload: { channelId: tko_message.channelId, messageId: tko_messageId, workItemId: tko_workItemId }, auditAction: "chat.message.work_item_linked", resourceType: "message", resourceId: tko_messageId, correlationId: tko_correlationId }); return cloneMessage(tko_message); }
  async getMemberNotificationPrefs(tko_tenantId: string, tko_memberId: string): Promise<MemberNotificationPrefs> {
    return { ...(this.tko_memberPrefs.get(`${tko_tenantId}:${tko_memberId}`) ?? { defaultPolicy: "mentions" as const, quietHoursStart: null, quietHoursEnd: null }) };
  }
  async setMemberNotificationPrefs(tko_actor: PlatformActor, tko_prefs: MemberNotificationPrefs, tko_correlationId: string): Promise<MemberNotificationPrefs> {
    if (tko_actor.membershipStatus !== "active") throw new Error("TASKO_AUTHORIZATION_DENIED:actor_inactive");
    const tko_prefs_json: MemberNotificationPrefs = { defaultPolicy: tko_prefs.defaultPolicy, quietHoursStart: tko_prefs.quietHoursStart ?? null, quietHoursEnd: tko_prefs.quietHoursEnd ?? null };
    this.tko_memberPrefs.set(`${tko_actor.tenantId}:${tko_actor.memberId}`, tko_prefs_json);
    await getPlatformStore().writeDurableMutation({ actor: tko_actor, tenantId: tko_actor.tenantId, eventType: "chat.member_notification_prefs_updated.v1", topic: "chat.notification", payload: { memberId: tko_actor.memberId, ...tko_prefs_json }, auditAction: "chat.notification.member_prefs_updated", resourceType: "tenant_member", resourceId: tko_actor.memberId, correlationId: tko_correlationId });
    return { ...tko_prefs_json };
  }
  async getTeam(tko_tenantId: string, tko_teamId: string): Promise<ChatTeamSummary | null> {
    const tko_team = this.tko_teams.get(tko_teamId);
    return tko_team && tko_team.tenantId === tko_tenantId ? { id: tko_team.id, name: tko_team.name, handle: tko_team.handle, memberCount: tko_team.memberIds.size } : null;
  }
  async listTeamMemberIds(tko_tenantId: string, tko_teamId: string): Promise<string[]> {
    const tko_team = this.tko_teams.get(tko_teamId);
    return tko_team && tko_team.tenantId === tko_tenantId ? Array.from(tko_team.memberIds) : [];
  }
  async listListableTeams(tko_tenantId: string): Promise<ChatTeamSummary[]> {
    return Array.from(this.tko_teams.values()).filter(tko_team => tko_team.tenantId === tko_tenantId).sort((a, b) => a.name.localeCompare(b.name)).map(tko_team => ({ id: tko_team.id, name: tko_team.name, handle: tko_team.handle, memberCount: tko_team.memberIds.size }));
  }
  async listChannelMemberSettings(tko_tenantId: string, tko_channelId: string): Promise<ChannelMemberSetting[]> {
    const tko_channel = this.tko_channels.get(tko_channelId);
    if (!tko_channel || tko_channel.tenantId !== tko_tenantId) return [];
    return tko_channel.memberIds.map(tko_memberId => {
      const tko_state = this.tko_reads.get(`${tko_channelId}:${tko_memberId}`);
      return { channelId: tko_channelId, memberId: tko_memberId, notificationLevel: tko_state?.notificationLevel ?? ("mentions" as ChannelNotificationLevel) };
    });
  }
  /** Test/seed helper mirroring the teams + team_members tables. Members are tenant member ids. */
  seedTeam(tko_tenantId: string, tko_teamId: string, tko_name: string, tko_handle: string, tko_memberIds: string[]): ChatTeamSummary {
    const tko_team = { tenantId: tko_tenantId, id: tko_teamId, name: tko_name, handle: tko_handle, memberIds: new Set(tko_memberIds) };
    this.tko_teams.set(tko_teamId, tko_team);
    return { id: tko_teamId, name: tko_name, handle: tko_handle, memberCount: tko_team.memberIds.size };
  }
  async seedDemo(tko_actor: PlatformActor): Promise<Channel> { const tko_existing = Array.from(this.tko_channels.values()).find(tko_channel => tko_channel.tenantId === tko_actor.tenantId && tko_channel.name === "product"); if (tko_existing) return cloneChannel(tko_existing); const tko_channel = await this.createChannel(tko_actor, { tenantId: tko_actor.tenantId, kind: "public", name: "product", topic: "Product team pilot", memberIds: [tko_actor.memberId] }); await this.sendMessage(tko_actor, { tenantId: tko_actor.tenantId, channelId: tko_channel.id, authorMemberId: tko_actor.memberId, clientMessageId: crypto.randomUUID(), body: { type: "text", text: "Welcome to the Tasko product channel." } }, tko_actor.correlationId); return tko_channel; }
}

let tko_store: ChatStore = tko_config.postgresUrl ? new PostgresChatStore(tko_config.postgresUrl) : new MemoryChatStore();
export function getChatStore(): ChatStore { return tko_store; }
export function setChatStoreForTests(tko_next: ChatStore | null): void { tko_store = tko_next ?? new MemoryChatStore(); }
