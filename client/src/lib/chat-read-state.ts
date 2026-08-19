export function tko_readCursorAttemptKey(tko_channelId: string, tko_lastMessageSequence: number): string {
  return `${tko_channelId}:${tko_lastMessageSequence}`;
}

export function tko_shouldSyncReadCursor(input: {
  channelId: string | null;
  lastMessageSequence: number;
  lastReadSequence: number | undefined;
  lastAttemptKey: string | null;
}): boolean {
  if (!input.channelId || input.lastMessageSequence <= 0) return false;
  if ((input.lastReadSequence ?? 0) >= input.lastMessageSequence) return false;
  return input.lastAttemptKey !== tko_readCursorAttemptKey(input.channelId, input.lastMessageSequence);
}
