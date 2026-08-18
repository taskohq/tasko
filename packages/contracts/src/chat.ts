
export type ChannelKind = "public" | "private" | "dm" | "group_dm";
export type MessageBody = { type: "text"; text: string; mentions?: string[] };
export type ChannelNotificationLevel = "all" | "mentions" | "none";
export type SavedMessageStatus = "open" | "done";

export interface MessageAttachment {
  id: string;
  tenantId: string;
  objectKey: string;
  filename: string;
  contentType: string;
  url: string;
}

export interface ChatAttachmentUpload {
  filename: string;
  contentType: string;
  dataBase64: string;
}

export interface Channel {
  id: string;
  tenantId: string;
  type: "channel";
  kind: ChannelKind;
  name: string | null;
  topic: string | null;
  visibility: "internal" | "private";
  memberIds: string[];
  explicitMemberIds: string[];
  lastSequence: number;
  createdAt: Date;
}

export interface ChatMessage {
  id: string;
  tenantId: string;
  channelId: string;
  sequence: number;
  clientMessageId: string;
  authorMemberId: string;
  body: MessageBody;
  plainText: string;
  attachments: MessageAttachment[];
  parentMessageId: string | null;
  replyCount: number;
  latestReplyAt: Date | null;
  linkedWorkItemId: string | null;
  editedAt: Date | null;
  deletedAt: Date | null;
  createdAt: Date;
}

export interface ChannelReadState {
  channelId: string;
  memberId: string;
  lastReadSeq: number;
  lastNotifiedSeq: number;
  unreadMentions: number;
  notificationLevel: ChannelNotificationLevel;
}

export interface SavedMessage {
  tenantId: string;
  messageId: string;
  memberId: string;
  status: SavedMessageStatus;
  note: string | null;
  reminderAt: Date | null;
  createdAt: Date;
}

export interface MessageReaction {
  messageId: string;
  memberId: string;
  emoji: string;
  createdAt: Date;
}

export interface ChatPresence {
  memberId: string;
  status: "online" | "away" | "offline";
  expiresAt: number;
}

export interface ChatTypingIndicator {
  channelId: string;
  memberId: string;
  isTyping: boolean;
  expiresAt: number;
}

export interface ChatSearchResult {
  message: ChatMessage;
  channel: Pick<Channel, "id" | "kind" | "name">;
  snippet: string;
}

export interface CreateChannelInput {
  tenantId: string;
  kind: ChannelKind;
  name?: string;
  topic?: string;
  memberIds: string[];
  visibility?: "internal" | "private";
}

export interface SendMessageInput {
  tenantId: string;
  channelId: string;
  authorMemberId: string;
  clientMessageId: string;
  body: MessageBody;
  attachments?: MessageAttachment[];
  parentMessageId?: string | null;
}

export interface SaveMessageInput {
  status?: SavedMessageStatus;
  note?: string | null;
  reminderAt?: Date | null;
}
