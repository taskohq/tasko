import { describe, expect, it } from "vitest";
import { tko_chatMessageHref, tko_isChatMessageMutationEvent, tko_mergeMessages, tko_parseChatPermalink, tko_pruneTyping, tko_stringPayloadId } from "./chat-realtime";

describe("chat realtime client helpers", () => {
  it("parses permalink params emitted by the workspace search indexer", () => {
    expect(tko_parseChatPermalink("?channel=abc&message=123")).toEqual({ channelId: "abc", messageRef: "123" });
    expect(tko_parseChatPermalink("?channel=%20abc%20")).toEqual({ channelId: "abc", messageRef: null });
    expect(tko_parseChatPermalink("")).toEqual({ channelId: null, messageRef: null });
  });

  it("builds message hrefs for copy-link and inbox deep links", () => {
    expect(tko_chatMessageHref("c-1", "m-2")).toBe("/chat?channel=c-1&message=m-2");
  });

  it("prunes expired typing indicators", () => {
    const tko_entries = [
      { channelId: "c", memberId: "m1", expiresAt: 100 },
      { channelId: "c", memberId: "m2", expiresAt: 300 },
    ];
    expect(tko_pruneTyping(tko_entries, 200).map(tko_entry => tko_entry.memberId)).toEqual(["m2"]);
    expect(tko_pruneTyping(tko_entries, 400)).toEqual([]);
  });

  it("classifies message mutation events for cache patching", () => {
    expect(tko_isChatMessageMutationEvent("chat.message_updated.v1")).toBe(true);
    expect(tko_isChatMessageMutationEvent("chat.message_deleted.v1")).toBe(true);
    expect(tko_isChatMessageMutationEvent("chat.reaction_toggled.v1")).toBe(true);
    expect(tko_isChatMessageMutationEvent("chat.message_created.v1")).toBe(false);
  });

  it("extracts string payload ids defensively", () => {
    expect(tko_stringPayloadId({ messageId: "m1" }, "messageId")).toBe("m1");
    expect(tko_stringPayloadId({ messageId: 12 }, "messageId")).toBeNull();
    expect(tko_stringPayloadId(undefined, "messageId")).toBeNull();
  });

  it("merges live messages into the cache without duplicates and keeps sequence order", () => {
    const tko_root = { id: "root", sequence: 1, replyCount: 0, createdAt: "2026-01-01T00:00:00Z" };
    const tko_existing = [tko_root];
    const tko_merged = tko_mergeMessages(tko_existing, [
      { id: "reply", sequence: 3, parentMessageId: "root", createdAt: "2026-01-01T00:02:00Z" },
      { id: "mid", sequence: 2, createdAt: "2026-01-01T00:01:00Z" },
      { id: "root", sequence: 1, replyCount: 1, createdAt: "2026-01-01T00:00:00Z" },
    ]);
    expect(tko_merged.map(tko_message => tko_message.id)).toEqual(["root", "mid", "reply"]);
    expect(tko_merged.find(tko_message => tko_message.id === "root")?.replyCount).toBe(1);
  });
});
