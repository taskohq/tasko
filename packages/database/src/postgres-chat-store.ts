import type { PlatformActor } from "../../contracts/src/platform";
import type { Channel, ChannelNotificationLevel, ChannelReadState, ChatMessage, ChatSearchResult, CreateChannelInput, SaveMessageInput, SavedMessage, SendMessageInput, UpdateChannelInput } from "../../contracts/src/chat";
import type { ChatStore } from "./chat-store";
import { Pool, type PoolClient } from "pg";

type Row = Record<string, unknown>;
const tko_date = (tko_value: unknown): Date | null => tko_value ? new Date(String(tko_value)) : null;
const tko_body = (tko_value: unknown): ChatMessage["body"] => typeof tko_value === "string" ? JSON.parse(tko_value) as ChatMessage["body"] : tko_value as ChatMessage["body"];

export class PostgresChatStore implements ChatStore {
  readonly mode = "postgres" as const;
  private readonly tko_pool: Pool;

  constructor(tko_connectionString: string) { this.tko_pool = new Pool({ connectionString: tko_connectionString, max: 10 }); }

  async close(): Promise<void> { await this.tko_pool.end(); }

  async listChannels(tko_tenantId: string, tko_memberId: string): Promise<Channel[]> {
    return this.tko_read(tko_tenantId, async tko_client => {
      const tko_rows = await tko_client.query(`select distinct c.* from channels c left join channel_members cm on cm.channel_id=c.id and cm.tenant_id=c.tenant_id where c.tenant_id=$1 and c.archived_at is null and (c.kind='public' or cm.member_id=$2) order by c.name nulls last, c.created_at`, [tko_tenantId, tko_memberId]);
      return Promise.all(tko_rows.rows.map(tko_row => this.tko_channel(tko_client, tko_row)));
    });
  }

  async getChannel(tko_tenantId: string, tko_channelId: string): Promise<Channel | null> {
    return this.tko_read(tko_tenantId, async tko_client => {
      const tko_result = await tko_client.query(`select * from channels where tenant_id=$1 and id=$2`, [tko_tenantId, tko_channelId]);
      return tko_result.rowCount ? this.tko_channel(tko_client, tko_result.rows[0]) : null;
    });
  }

  async listMessages(tko_tenantId: string, tko_channelId: string, tko_afterSequence = 0): Promise<ChatMessage[]> {
    return this.tko_read(tko_tenantId, async tko_client => {
      const tko_result = await tko_client.query(`select * from messages where tenant_id=$1 and channel_id=$2 and sequence>$3 order by sequence`, [tko_tenantId, tko_channelId, tko_afterSequence]);
      return Promise.all(tko_result.rows.map(tko_row => this.tko_message(tko_client, tko_row)));
    });
  }

  async getMessage(tko_tenantId: string, tko_messageId: string): Promise<ChatMessage | null> {
    return this.tko_read(tko_tenantId, async tko_client => {
      const tko_result = await tko_client.query(`select * from messages where tenant_id=$1 and id=$2`, [tko_tenantId, tko_messageId]);
      return tko_result.rowCount ? this.tko_message(tko_client, tko_result.rows[0]) : null;
    });
  }

  async createChannel(tko_actor: PlatformActor, tko_input: CreateChannelInput): Promise<Channel> {
    return this.tko_transaction(tko_actor.tenantId, async tko_client => {
      const tko_result = await tko_client.query(`insert into channels (id,tenant_id,kind,name,topic,visibility,created_by_member_id) values ($1,$2,$3,$4,$5,$6,$7) returning *`, [crypto.randomUUID(), tko_actor.tenantId, tko_input.kind, tko_input.kind === "public" || tko_input.kind === "private" ? (tko_input.name?.trim() ?? null) : null, tko_input.topic?.trim() ?? null, tko_input.visibility ?? (tko_input.kind === "private" || tko_input.kind === "dm" || tko_input.kind === "group_dm" ? "private" : "internal"), tko_actor.memberId]);
      const tko_memberIds = Array.from(new Set([tko_actor.memberId, ...tko_input.memberIds]));
      for (const tko_memberId of tko_memberIds) await tko_client.query(`insert into channel_members (tenant_id,channel_id,member_id) values ($1,$2,$3)`, [tko_actor.tenantId, tko_result.rows[0].id, tko_memberId]);
      const tko_channel = await this.tko_channel(tko_client, tko_result.rows[0]);
      await this.tko_emit(tko_client, tko_actor, "chat.channel_created.v1", "chat.channel", { channelId: tko_channel.id, kind: tko_channel.kind }, "chat.channel.created", "channel", tko_channel.id, tko_actor.correlationId);
      return tko_channel;
    });
  }

  async updateChannel(tko_actor: PlatformActor, tko_channelId: string, tko_input: UpdateChannelInput, tko_correlationId: string): Promise<Channel> {
    return this.tko_transaction(tko_actor.tenantId, async tko_client => {
      const tko_result = await tko_client.query(`update channels set name=coalesce($1,name), topic=case when $2::boolean then $3 else topic end, visibility=coalesce($4,visibility), updated_at=now() where tenant_id=$5 and id=$6 and archived_at is null returning *`, [tko_input.name?.trim() ?? null, tko_input.topic !== undefined, tko_input.topic?.trim() || null, tko_input.visibility ?? null, tko_actor.tenantId, tko_channelId]);
      if (!tko_result.rowCount) throw new Error("CHAT_CHANNEL_NOT_FOUND");
      const tko_channel = await this.tko_channel(tko_client, tko_result.rows[0]);
      await this.tko_emit(tko_client, tko_actor, "chat.channel_updated.v1", "chat.channel", { channelId: tko_channelId }, "chat.channel.updated", "channel", tko_channelId, tko_correlationId);
      return tko_channel;
    });
  }

  async archiveChannel(tko_actor: PlatformActor, tko_channelId: string, tko_correlationId: string): Promise<Channel> {
    return this.tko_transaction(tko_actor.tenantId, async tko_client => {
      const tko_result = await tko_client.query(`update channels set archived_at=now(),updated_at=now() where tenant_id=$1 and id=$2 and archived_at is null returning *`, [tko_actor.tenantId, tko_channelId]);
      if (!tko_result.rowCount) throw new Error("CHAT_CHANNEL_NOT_FOUND");
      const tko_channel = await this.tko_channel(tko_client, tko_result.rows[0]);
      await this.tko_emit(tko_client, tko_actor, "chat.channel_archived.v1", "chat.channel", { channelId: tko_channelId }, "chat.channel.archived", "channel", tko_channelId, tko_correlationId);
      return tko_channel;
    });
  }

  async deleteChannel(tko_actor: PlatformActor, tko_channelId: string, tko_correlationId: string): Promise<void> {
    await this.tko_transaction(tko_actor.tenantId, async tko_client => {
      const tko_result = await tko_client.query(`delete from channels where tenant_id=$1 and id=$2 returning id`, [tko_actor.tenantId, tko_channelId]);
      if (!tko_result.rowCount) throw new Error("CHAT_CHANNEL_NOT_FOUND");
      await this.tko_emit(tko_client, tko_actor, "chat.channel_deleted.v1", "chat.channel", { channelId: tko_channelId }, "chat.channel.deleted", "channel", tko_channelId, tko_correlationId);
    });
  }

  async addChannelMembers(tko_actor: PlatformActor, tko_channelId: string, tko_memberIds: string[], tko_correlationId: string): Promise<Channel> {
    return this.tko_transaction(tko_actor.tenantId, async tko_client => {
      const tko_channelResult = await tko_client.query(`select * from channels where tenant_id=$1 and id=$2 and archived_at is null for update`, [tko_actor.tenantId, tko_channelId]);
      if (!tko_channelResult.rowCount) throw new Error("CHAT_CHANNEL_NOT_FOUND");
      for (const tko_memberId of tko_memberIds) await tko_client.query(`insert into channel_members (tenant_id,channel_id,member_id) values ($1,$2,$3) on conflict (channel_id,member_id) do nothing`, [tko_actor.tenantId, tko_channelId, tko_memberId]);
      const tko_channel = await this.tko_channel(tko_client, tko_channelResult.rows[0]);
      await this.tko_emit(tko_client, tko_actor, "chat.channel_members_added.v1", "chat.channel", { channelId: tko_channelId, memberIds: tko_memberIds }, "chat.channel.members_added", "channel", tko_channelId, tko_correlationId);
      return tko_channel;
    });
  }

  async removeChannelMember(tko_actor: PlatformActor, tko_channelId: string, tko_memberId: string, tko_correlationId: string): Promise<Channel> {
    return this.tko_transaction(tko_actor.tenantId, async tko_client => {
      const tko_channelResult = await tko_client.query(`select * from channels where tenant_id=$1 and id=$2 and archived_at is null for update`, [tko_actor.tenantId, tko_channelId]);
      if (!tko_channelResult.rowCount) throw new Error("CHAT_CHANNEL_NOT_FOUND");
      await tko_client.query(`delete from channel_members where tenant_id=$1 and channel_id=$2 and member_id=$3`, [tko_actor.tenantId, tko_channelId, tko_memberId]);
      const tko_channel = await this.tko_channel(tko_client, tko_channelResult.rows[0]);
      await this.tko_emit(tko_client, tko_actor, "chat.channel_member_removed.v1", "chat.channel", { channelId: tko_channelId, memberId: tko_memberId }, "chat.channel.member_removed", "channel", tko_channelId, tko_correlationId);
      return tko_channel;
    });
  }

  async sendMessage(tko_actor: PlatformActor, tko_input: SendMessageInput, tko_correlationId: string): Promise<ChatMessage> {
    return this.tko_transaction(tko_actor.tenantId, async tko_client => {
      const tko_existing = await tko_client.query(`select * from messages where tenant_id=$1 and channel_id=$2 and client_message_id=$3`, [tko_actor.tenantId, tko_input.channelId, tko_input.clientMessageId]);
      if (tko_existing.rowCount) return this.tko_message(tko_client, tko_existing.rows[0]);
      const tko_channel = await tko_client.query(`select * from channels where tenant_id=$1 and id=$2 for update`, [tko_actor.tenantId, tko_input.channelId]);
      if (!tko_channel.rowCount) throw new Error("CHAT_CHANNEL_NOT_FOUND");
      const tko_sequence = Number(tko_channel.rows[0].last_sequence) + 1;
      await tko_client.query(`update channels set last_sequence=$1,updated_at=now() where id=$2`, [tko_sequence, tko_input.channelId]);
      const tko_result = await tko_client.query(`insert into messages (id,tenant_id,channel_id,sequence,client_message_id,author_member_id,body,plain_text,parent_message_id) values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9) returning *`, [crypto.randomUUID(), tko_actor.tenantId, tko_input.channelId, tko_sequence, tko_input.clientMessageId, tko_actor.memberId, JSON.stringify(tko_input.body), tko_input.body.text, tko_input.parentMessageId ?? null]);
      const tko_messageId = String(tko_result.rows[0].id);
      for (const tko_attachment of tko_input.attachments ?? []) await tko_client.query(`insert into message_attachments (id,tenant_id,message_id,object_key,filename,content_type) values ($1,$2,$3,$4,$5,$6)`, [tko_attachment.id, tko_actor.tenantId, tko_messageId, tko_attachment.objectKey, tko_attachment.filename, tko_attachment.contentType]);
      const tko_message = await this.tko_message(tko_client, tko_result.rows[0]);
      if (tko_message.parentMessageId) await tko_client.query(`update messages set reply_count=reply_count+1,latest_reply_at=now() where tenant_id=$1 and id=$2`, [tko_actor.tenantId, tko_message.parentMessageId]);
      const tko_mentions = Array.from(new Set(tko_message.body.mentions ?? [])).filter(tko_memberId => tko_memberId !== tko_actor.memberId);
      if (tko_mentions.length) await tko_client.query(`update channel_members set unread_mentions=unread_mentions+1,last_notified_seq=greatest(last_notified_seq,$3) where tenant_id=$1 and channel_id=$2 and member_id=any($4::uuid[])`, [tko_actor.tenantId, tko_message.channelId, tko_message.sequence, tko_mentions]);
      await this.tko_emit(tko_client, tko_actor, "chat.message_created.v1", "chat.message", { channelId: tko_message.channelId, messageId: tko_message.id, sequence: tko_message.sequence, parentMessageId: tko_message.parentMessageId, attachmentCount: tko_message.attachments.length, mentionCount: tko_mentions.length }, "chat.message.created", "message", tko_message.id, tko_correlationId);
      return tko_message;
    });
  }

  async editMessage(tko_actor: PlatformActor, tko_messageId: string, tko_text: string, tko_correlationId: string): Promise<ChatMessage> {
    return this.tko_transaction(tko_actor.tenantId, async tko_client => {
      const tko_result = await tko_client.query(`update messages set body=jsonb_set(body,'{text}',to_jsonb($1::text)),plain_text=$1,edited_at=now() where tenant_id=$2 and id=$3 and deleted_at is null returning *`, [tko_text.trim(), tko_actor.tenantId, tko_messageId]);
      if (!tko_result.rowCount) throw new Error("CHAT_MESSAGE_NOT_FOUND");
      const tko_message = await this.tko_message(tko_client, tko_result.rows[0]);
      await this.tko_emit(tko_client, tko_actor, "chat.message_updated.v1", "chat.message", { channelId: tko_message.channelId, messageId: tko_message.id }, "chat.message.edited", "message", tko_message.id, tko_correlationId);
      return tko_message;
    });
  }

  async deleteMessage(tko_actor: PlatformActor, tko_messageId: string, tko_correlationId: string): Promise<ChatMessage> {
    return this.tko_transaction(tko_actor.tenantId, async tko_client => {
      const tko_result = await tko_client.query(`update messages set body=$1::jsonb,plain_text='',deleted_at=now() where tenant_id=$2 and id=$3 and deleted_at is null returning *`, [JSON.stringify({ type: "text", text: "This message was deleted." }), tko_actor.tenantId, tko_messageId]);
      if (!tko_result.rowCount) throw new Error("CHAT_MESSAGE_NOT_FOUND");
      const tko_message = await this.tko_message(tko_client, tko_result.rows[0]);
      await this.tko_emit(tko_client, tko_actor, "chat.message_deleted.v1", "chat.message", { channelId: tko_message.channelId, messageId: tko_message.id }, "chat.message.deleted", "message", tko_message.id, tko_correlationId);
      return tko_message;
    });
  }

  async toggleReaction(tko_actor: PlatformActor, tko_messageId: string, tko_emoji: string, tko_correlationId: string): Promise<{ added: boolean }> {
    return this.tko_transaction(tko_actor.tenantId, async tko_client => {
      const tko_removed = await tko_client.query(`delete from message_reactions where tenant_id=$1 and message_id=$2 and member_id=$3 and emoji=$4 returning message_id`, [tko_actor.tenantId, tko_messageId, tko_actor.memberId, tko_emoji]);
      const tko_added = !tko_removed.rowCount;
      if (tko_added) await tko_client.query(`insert into message_reactions (tenant_id,message_id,member_id,emoji) values ($1,$2,$3,$4)`, [tko_actor.tenantId, tko_messageId, tko_actor.memberId, tko_emoji]);
      await this.tko_emit(tko_client, tko_actor, "chat.reaction_toggled.v1", "chat.message", { messageId: tko_messageId, emoji: tko_emoji, added: tko_added }, "chat.reaction.toggled", "message", tko_messageId, tko_correlationId);
      return { added: tko_added };
    });
  }

  async listReadStates(tko_tenantId: string, tko_memberId: string): Promise<ChannelReadState[]> {
    return this.tko_read(tko_tenantId, async tko_client => {
      const tko_result = await tko_client.query(`select cm.* from channel_members cm join channels c on c.id=cm.channel_id and c.tenant_id=cm.tenant_id where cm.tenant_id=$1 and cm.member_id=$2 union all select $1::uuid as tenant_id,c.id as channel_id,$2::uuid as member_id,0::bigint as last_read_seq,0::bigint as last_notified_seq,0::integer as unread_mentions,'mentions'::text as notification_level,now() as created_at from channels c where c.tenant_id=$1 and c.kind='public' and not exists (select 1 from channel_members cm where cm.channel_id=c.id and cm.member_id=$2) order by channel_id`, [tko_tenantId, tko_memberId]);
      return tko_result.rows.map(this.tko_readState);
    });
  }

  async updateReadState(tko_actor: PlatformActor, tko_channelId: string, tko_lastReadSeq: number): Promise<ChannelReadState> {
    return this.tko_transaction(tko_actor.tenantId, async tko_client => {
      const tko_result = await tko_client.query(`insert into channel_members (tenant_id,channel_id,member_id,last_read_seq) values ($1,$2,$3,$4) on conflict (channel_id,member_id) do update set last_read_seq=greatest(channel_members.last_read_seq,excluded.last_read_seq), unread_mentions=(select count(*) from messages m where m.tenant_id=$1 and m.channel_id=$2 and m.sequence>greatest(channel_members.last_read_seq,excluded.last_read_seq) and coalesce(m.body->'mentions','[]'::jsonb) ? $3::text) returning *`, [tko_actor.tenantId, tko_channelId, tko_actor.memberId, tko_lastReadSeq]);
      const tko_state = this.tko_readState(tko_result.rows[0]);
      await this.tko_emit(tko_client, tko_actor, "chat.read_cursor_updated.v1", "chat.read", { channelId: tko_channelId, lastReadSeq: tko_state.lastReadSeq }, "chat.read_cursor.updated", "channel", tko_channelId, tko_actor.correlationId);
      return tko_state;
    });
  }

  async setNotificationPreference(tko_actor: PlatformActor, tko_channelId: string, tko_notificationLevel: ChannelNotificationLevel, tko_correlationId: string): Promise<ChannelReadState> {
    return this.tko_transaction(tko_actor.tenantId, async tko_client => {
      const tko_result = await tko_client.query(`insert into channel_members (tenant_id,channel_id,member_id,notification_level) values ($1,$2,$3,$4) on conflict (channel_id,member_id) do update set notification_level=excluded.notification_level returning *`, [tko_actor.tenantId, tko_channelId, tko_actor.memberId, tko_notificationLevel]);
      const tko_state = this.tko_readState(tko_result.rows[0]);
      await this.tko_emit(tko_client, tko_actor, "chat.notification_preference_updated.v1", "chat.notification", { channelId: tko_channelId, notificationLevel: tko_notificationLevel }, "chat.notification.preference_updated", "channel", tko_channelId, tko_correlationId);
      return tko_state;
    });
  }

  async listSavedMessages(tko_tenantId: string, tko_memberId: string): Promise<SavedMessage[]> {
    return this.tko_read(tko_tenantId, async tko_client => {
      const tko_result = await tko_client.query(`select * from saved_messages where tenant_id=$1 and member_id=$2 order by created_at desc`, [tko_tenantId, tko_memberId]);
      return tko_result.rows.map(this.tko_savedMessage);
    });
  }

  async saveMessage(tko_actor: PlatformActor, tko_messageId: string, tko_input: SaveMessageInput, tko_correlationId: string): Promise<SavedMessage> {
    return this.tko_transaction(tko_actor.tenantId, async tko_client => {
      const tko_result = await tko_client.query(`insert into saved_messages (tenant_id,message_id,member_id,status,note,reminder_at) values ($1,$2,$3,$4,$5,$6) on conflict (message_id,member_id) do update set status=excluded.status,note=excluded.note,reminder_at=excluded.reminder_at returning *`, [tko_actor.tenantId, tko_messageId, tko_actor.memberId, tko_input.status ?? "open", tko_input.note ?? null, tko_input.reminderAt ?? null]);
      const tko_saved = this.tko_savedMessage(tko_result.rows[0]);
      await this.tko_emit(tko_client, tko_actor, "chat.message_saved.v1", "chat.saved", { messageId: tko_messageId, status: tko_saved.status }, "chat.message.saved", "message", tko_messageId, tko_correlationId);
      return tko_saved;
    });
  }

  async search(tko_tenantId: string, tko_memberId: string, tko_query: string): Promise<ChatSearchResult[]> {
    return this.tko_read(tko_tenantId, async tko_client => {
      const tko_result = await tko_client.query(`select m.*,c.id as channel_ref,c.kind as channel_kind,c.name as channel_name,c.topic as channel_topic,c.visibility as channel_visibility,c.last_sequence as channel_last_sequence,c.created_at as channel_created_at from messages m join channels c on c.id=m.channel_id and c.tenant_id=m.tenant_id left join channel_members cm on cm.channel_id=c.id and cm.member_id=$2 where m.tenant_id=$1 and m.deleted_at is null and (c.kind='public' or cm.member_id=$2) and m.plain_text ilike $3 order by m.created_at desc limit 50`, [tko_tenantId, tko_memberId, `%${tko_query.trim()}%`]);
      return Promise.all(tko_result.rows.map(async tko_row => ({ message: await this.tko_message(tko_client, tko_row), channel: await this.tko_channel(tko_client, { ...tko_row, id: tko_row.channel_ref, kind: tko_row.channel_kind, name: tko_row.channel_name, topic: tko_row.channel_topic, visibility: tko_row.channel_visibility, last_sequence: tko_row.channel_last_sequence, created_at: tko_row.channel_created_at }), snippet: String(tko_row.plain_text).slice(0, 220) })));
    });
  }

  async linkWorkItem(tko_actor: PlatformActor, tko_messageId: string, tko_workItemId: string, tko_correlationId: string): Promise<ChatMessage> {
    return this.tko_transaction(tko_actor.tenantId, async tko_client => {
      const tko_workItem = await tko_client.query(`select id from work_items where tenant_id=$1 and id=$2`, [tko_actor.tenantId, tko_workItemId]);
      if (!tko_workItem.rowCount) throw new Error("WORK_ITEM_NOT_FOUND");
      const tko_result = await tko_client.query(`update messages set linked_work_item_id=$1 where tenant_id=$2 and id=$3 returning *`, [tko_workItemId, tko_actor.tenantId, tko_messageId]);
      if (!tko_result.rowCount) throw new Error("CHAT_MESSAGE_NOT_FOUND");
      const tko_message = await this.tko_message(tko_client, tko_result.rows[0]);
      await this.tko_emit(tko_client, tko_actor, "chat.message_linked_work_item.v1", "chat.message", { messageId: tko_message.id, workItemId: tko_workItemId }, "chat.message.work_item_linked", "message", tko_message.id, tko_correlationId);
      return tko_message;
    });
  }

  async seedDemo(tko_actor: PlatformActor): Promise<Channel> {
    const tko_channels = await this.listChannels(tko_actor.tenantId, tko_actor.memberId);
    const tko_existing = tko_channels.find(tko_channel => tko_channel.name === "product");
    if (tko_existing) return tko_existing;
    const tko_channel = await this.createChannel(tko_actor, { tenantId: tko_actor.tenantId, kind: "public", name: "product", topic: "Product team pilot", memberIds: [tko_actor.memberId] });
    await this.sendMessage(tko_actor, { tenantId: tko_actor.tenantId, channelId: tko_channel.id, authorMemberId: tko_actor.memberId, clientMessageId: crypto.randomUUID(), body: { type: "text", text: "Welcome to the Tasko product channel." } }, tko_actor.correlationId);
    return tko_channel;
  }

  private async tko_channel(tko_client: PoolClient, tko_row: Row): Promise<Channel> {
    const tko_members = await tko_client.query(`select member_id from channel_members where tenant_id=$1 and channel_id=$2 order by member_id`, [String(tko_row.tenant_id), String(tko_row.id)]);
    const tko_memberIds = tko_members.rows.map(tko_member => String(tko_member.member_id));
    return { id: String(tko_row.id), tenantId: String(tko_row.tenant_id), type: "channel", kind: tko_row.kind as Channel["kind"], name: tko_row.name ? String(tko_row.name) : null, topic: tko_row.topic ? String(tko_row.topic) : null, visibility: tko_row.visibility as Channel["visibility"], memberIds: tko_memberIds, explicitMemberIds: tko_memberIds, lastSequence: Number(tko_row.last_sequence), createdByMemberId: tko_row.created_by_member_id ? String(tko_row.created_by_member_id) : null, archivedAt: tko_date(tko_row.archived_at), createdAt: new Date(String(tko_row.created_at)) };
  }

  private async tko_message(tko_client: PoolClient, tko_row: Row): Promise<ChatMessage> {
    const tko_attachmentRows = await tko_client.query(`select * from message_attachments where tenant_id=$1 and message_id=$2 order by created_at`, [String(tko_row.tenant_id), String(tko_row.id)]);
    return { id: String(tko_row.id), tenantId: String(tko_row.tenant_id), channelId: String(tko_row.channel_id), sequence: Number(tko_row.sequence), clientMessageId: String(tko_row.client_message_id), authorMemberId: String(tko_row.author_member_id), body: tko_body(tko_row.body), plainText: String(tko_row.plain_text), attachments: tko_attachmentRows.rows.map((tko_attachment: Row) => ({ id: String(tko_attachment.id), tenantId: String(tko_attachment.tenant_id), objectKey: String(tko_attachment.object_key), filename: String(tko_attachment.filename), contentType: String(tko_attachment.content_type), url: `/manus-storage/${String(tko_attachment.object_key)}` })), parentMessageId: tko_row.parent_message_id ? String(tko_row.parent_message_id) : null, replyCount: Number(tko_row.reply_count ?? 0), latestReplyAt: tko_date(tko_row.latest_reply_at), linkedWorkItemId: tko_row.linked_work_item_id ? String(tko_row.linked_work_item_id) : null, editedAt: tko_date(tko_row.edited_at), deletedAt: tko_date(tko_row.deleted_at), createdAt: new Date(String(tko_row.created_at)) };
  }

  private tko_readState = (tko_row: Row): ChannelReadState => ({ channelId: String(tko_row.channel_id), memberId: String(tko_row.member_id), lastReadSeq: Number(tko_row.last_read_seq), lastNotifiedSeq: Number(tko_row.last_notified_seq), unreadMentions: Number(tko_row.unread_mentions), notificationLevel: tko_row.notification_level as ChannelNotificationLevel });
  private tko_savedMessage = (tko_row: Row): SavedMessage => ({ tenantId: String(tko_row.tenant_id), messageId: String(tko_row.message_id), memberId: String(tko_row.member_id), status: tko_row.status as SavedMessage["status"], note: tko_row.note ? String(tko_row.note) : null, reminderAt: tko_date(tko_row.reminder_at), createdAt: new Date(String(tko_row.created_at)) });

  private async tko_emit(tko_client: PoolClient, tko_actor: PlatformActor, tko_eventType: string, tko_topic: string, tko_payload: Record<string, unknown>, tko_action: string, tko_resourceType: string, tko_resourceId: string, tko_correlationId: string): Promise<void> {
    await tko_client.query(`insert into audit_logs (id,tenant_id,actor_auth_subject,action,resource_type,resource_id,correlation_id,metadata_json) values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`, [crypto.randomUUID(), tko_actor.tenantId, tko_actor.authSubject, tko_action, tko_resourceType, tko_resourceId, tko_correlationId, JSON.stringify({ source: "collaboration-alpha" })]);
    await tko_client.query(`insert into outbox (id,event_id,tenant_id,topic,event_type,payload_json,actor_auth_subject,correlation_id) values ($1,$2,$3,$4,$5,$6::jsonb,$7,$8)`, [crypto.randomUUID(), crypto.randomUUID(), tko_actor.tenantId, tko_topic, tko_eventType, JSON.stringify(tko_payload), tko_actor.authSubject, tko_correlationId]);
  }

  private async tko_read<T>(tko_tenantId: string, tko_callback: (tko_client: PoolClient) => Promise<T>): Promise<T> { const tko_client = await this.tko_pool.connect(); try { await tko_client.query("begin"); await tko_client.query("select set_config('app.tenant_id',$1,true)", [tko_tenantId]); const tko_value = await tko_callback(tko_client); await tko_client.query("commit"); return tko_value; } catch (tko_error) { await tko_client.query("rollback"); throw tko_error; } finally { tko_client.release(); } }
  private async tko_transaction<T>(tko_tenantId: string, tko_callback: (tko_client: PoolClient) => Promise<T>): Promise<T> { return this.tko_read(tko_tenantId, tko_callback); }
}
