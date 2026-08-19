import { describe, expect, it } from "vitest";
import { tko_readCursorAttemptKey, tko_shouldSyncReadCursor } from "../../client/src/lib/chat-read-state";

describe("chat read cursor sync guard", () => {
  it("only syncs an unread channel once for the same message sequence", () => {
    const tko_key = tko_readCursorAttemptKey("channel-a", 8);
    expect(tko_shouldSyncReadCursor({ channelId: "channel-a", lastMessageSequence: 8, lastReadSequence: 3, lastAttemptKey: null })).toBe(true);
    expect(tko_shouldSyncReadCursor({ channelId: "channel-a", lastMessageSequence: 8, lastReadSequence: 3, lastAttemptKey: tko_key })).toBe(false);
  });

  it("retries only when a newer message arrives and never syncs an already-read channel", () => {
    expect(tko_shouldSyncReadCursor({ channelId: "channel-a", lastMessageSequence: 9, lastReadSequence: 8, lastAttemptKey: tko_readCursorAttemptKey("channel-a", 8) })).toBe(true);
    expect(tko_shouldSyncReadCursor({ channelId: "channel-a", lastMessageSequence: 9, lastReadSequence: 9, lastAttemptKey: null })).toBe(false);
  });
});
