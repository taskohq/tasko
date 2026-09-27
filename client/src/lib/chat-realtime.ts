/**
 * Pure helpers for the M2 chat realtime client: permalink parsing (workspace search indexer emits
 * hrefs like /chat?channel=<id>&message=<id|sequence>), canonical message link building, typing
 * indicator expiry and WS event classification.
 */

export type TkoChatPermalink = { channelId: string | null; messageRef: string | null };

export function tko_parseChatPermalink(tko_search: string): TkoChatPermalink {
  const tko_params = new URLSearchParams(tko_search.startsWith("?") ? tko_search.slice(1) : tko_search);
  const tko_channelId = tko_params.get("channel");
  const tko_messageRef = tko_params.get("message");
  return {
    channelId: tko_channelId && tko_channelId.trim() ? tko_channelId.trim() : null,
    messageRef: tko_messageRef && tko_messageRef.trim() ? tko_messageRef.trim() : null,
  };
}

export function tko_chatMessageHref(tko_channelId: string, tko_messageId: string): string {
  return `/chat?channel=${encodeURIComponent(tko_channelId)}&message=${encodeURIComponent(tko_messageId)}`;
}

export function tko_chatMessageAbsoluteUrl(tko_channelId: string, tko_messageId: string): string {
  return `${window.location.origin}${tko_chatMessageHref(tko_channelId, tko_messageId)}`;
}

export type TkoLiveTypingEntry = { channelId: string; memberId: string; expiresAt: number };

/** Drop expired typing indicators; `now` defaults to wall clock (injectable in tests). */
export function tko_pruneTyping(tko_entries: TkoLiveTypingEntry[], tko_now = Date.now()): TkoLiveTypingEntry[] {
  return tko_entries.filter(tko_entry => tko_entry.expiresAt > tko_now);
}

export type TkoRealtimeEnvelope = {
  type?: string;
  eventId?: string;
  eventType?: string;
  payload?: Record<string, unknown>;
};

/** Chat-domain events that mutate message content and can be merged incrementally. */
export function tko_isChatMessageMutationEvent(tko_eventType: string): boolean {
  return tko_eventType === "chat.message_updated.v1" || tko_eventType === "chat.message_deleted.v1" || tko_eventType === "chat.reaction_toggled.v1";
}

export function tko_stringPayloadId(tko_payload: Record<string, unknown> | undefined, tko_name: string): string | null {
  const tko_value = tko_payload?.[tko_name];
  return typeof tko_value === "string" && tko_value ? tko_value : null;
}

/** Merge fetched messages into an existing cache page: dedupe by id, keep sequence order, and bump
 * thread metadata on parents that received new replies. Generic so it fits the react-query cache
 * element type exactly. */
export function tko_mergeMessages<T extends { id: string; sequence: number; parentMessageId?: string | null; replyCount?: number; latestReplyAt?: Date | string | null; createdAt: Date | string }>(tko_existing: T[], tko_incoming: T[]): T[] {
  const tko_byId = new Map<string, T>();
  for (const tko_message of tko_existing) tko_byId.set(tko_message.id, tko_message);
  for (const tko_message of tko_incoming) {
    const tko_previous = tko_byId.get(tko_message.id);
    tko_byId.set(tko_message.id, tko_previous ? { ...tko_previous, ...tko_message } : tko_message);
  }
  const tko_merged = Array.from(tko_byId.values()).sort((tko_left, tko_right) => tko_left.sequence - tko_right.sequence);
  for (const tko_message of tko_merged) {
    if (!tko_message.parentMessageId) continue;
    const tko_parent = tko_byId.get(tko_message.parentMessageId);
    if (!tko_parent || (tko_parent.replyCount ?? 0) > 0) continue;
    const tko_replyCount = tko_merged.filter(tko_candidate => tko_candidate.parentMessageId === tko_parent.id).length;
    if (tko_replyCount > 0) tko_byId.set(tko_parent.id, { ...tko_parent, replyCount: tko_replyCount, latestReplyAt: tko_message.createdAt });
  }
  return Array.from(tko_byId.values()).sort((tko_left, tko_right) => tko_left.sequence - tko_right.sequence);
}
