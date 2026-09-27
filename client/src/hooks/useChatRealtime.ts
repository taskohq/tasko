import { useEffect, useRef } from "react";

type TkoRealtimeEnvelope = {
  type?: string;
  eventId?: string;
  eventType?: string;
  payload?: Record<string, unknown>;
};

export type TkoChatRealtimeEvent = {
  eventId: string | null;
  eventType: string;
  payload: Record<string, unknown>;
};

/**
 * Chat realtime transport over the shared `/api/realtime` WebSocket gateway. Mirrors the
 * useWorkBoardRealtime pattern: exponential-backoff reconnect, server-authorized channel
 * subscription, and a reconnect resync callback so the page can refetch messages after the last
 * seen channel sequence before resuming the live stream (spec 13 §7).
 */
export function useChatRealtime(tko_input: {
  enabled: boolean;
  channelId: string | null;
  onEvent: (tko_event: TkoChatRealtimeEvent) => void;
  /** Called after every (re)open once the channel subscription was (re)sent; skip work on the
   * initial connect by checking `reconnected`. */
  onSessionOpened: (tko_options: { reconnected: boolean }) => void;
  onStatusChange?: (tko_connected: boolean) => void;
}): void {
  const tko_eventRef = useRef(tko_input.onEvent);
  const tko_sessionRef = useRef(tko_input.onSessionOpened);
  const tko_statusRef = useRef(tko_input.onStatusChange);
  useEffect(() => { tko_eventRef.current = tko_input.onEvent; }, [tko_input.onEvent]);
  useEffect(() => { tko_sessionRef.current = tko_input.onSessionOpened; }, [tko_input.onSessionOpened]);
  useEffect(() => { tko_statusRef.current = tko_input.onStatusChange; }, [tko_input.onStatusChange]);

  useEffect(() => {
    if (!tko_input.enabled || typeof WebSocket === "undefined") return;
    let tko_socket: WebSocket | null = null;
    let tko_retryTimer: ReturnType<typeof setTimeout> | null = null;
    let tko_closed = false;
    let tko_attempt = 0;
    let tko_everConnected = false;

    const tko_connect = () => {
      const tko_scheme = window.location.protocol === "https:" ? "wss" : "ws";
      tko_socket = new WebSocket(`${tko_scheme}://${window.location.host}/api/realtime`);
      tko_socket.onopen = () => {
        const tko_reconnected = tko_everConnected;
        tko_everConnected = true;
        tko_attempt = 0;
        tko_statusRef.current?.(true);
        if (tko_input.channelId) tko_socket?.send(JSON.stringify({ type: "subscribe", channelId: tko_input.channelId }));
        tko_sessionRef.current({ reconnected: tko_reconnected });
      };
      tko_socket.onmessage = tko_raw => {
        try {
          const tko_envelope = JSON.parse(String(tko_raw.data)) as TkoRealtimeEnvelope;
          if (tko_envelope.type !== "event" || !tko_envelope.eventType) return;
          tko_eventRef.current({ eventId: tko_envelope.eventId ?? null, eventType: tko_envelope.eventType, payload: tko_envelope.payload ?? {} });
        } catch {
          // Drop malformed socket payloads at the client boundary.
        }
      };
      tko_socket.onclose = () => {
        tko_statusRef.current?.(false);
        if (tko_closed) return;
        tko_attempt += 1;
        tko_retryTimer = setTimeout(tko_connect, Math.min(8_000, 500 * 2 ** Math.min(tko_attempt, 4)));
      };
    };

    tko_connect();
    return () => {
      tko_closed = true;
      if (tko_retryTimer) clearTimeout(tko_retryTimer);
      tko_socket?.close();
    };
  }, [tko_input.enabled, tko_input.channelId]);
}
