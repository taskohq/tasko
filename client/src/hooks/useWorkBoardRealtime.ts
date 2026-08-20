import { useEffect, useRef } from "react";
import { toast } from "sonner";

type TkoRealtimeEnvelope = {
  type?: string;
  eventId?: string;
  eventType?: string;
  payload?: Record<string, unknown>;
};

function tko_boardUpdateMessage(tko_eventType: string): string {
  if (tko_eventType.includes("workflow_status")) return "A teammate updated workflow columns.";
  if (tko_eventType.includes("work_item_moved") || tko_eventType.includes("status_changed")) return "A teammate moved a task on this board.";
  if (tko_eventType.includes("work_item_created")) return "A teammate created a task on this board.";
  return "A teammate updated this board.";
}

export function useWorkBoardRealtime(tko_input: {
  enabled: boolean;
  projectId: string | undefined;
  memberId: string | undefined;
  onBoardChanged: () => void;
}): void {
  const tko_callbackRef = useRef(tko_input.onBoardChanged);
  useEffect(() => { tko_callbackRef.current = tko_input.onBoardChanged; }, [tko_input.onBoardChanged]);

  useEffect(() => {
    if (!tko_input.enabled || !tko_input.projectId || typeof WebSocket === "undefined") return;
    let tko_socket: WebSocket | null = null;
    let tko_retryTimer: ReturnType<typeof setTimeout> | null = null;
    let tko_closed = false;
    let tko_attempt = 0;

    const tko_connect = () => {
      const tko_scheme = window.location.protocol === "https:" ? "wss" : "ws";
      tko_socket = new WebSocket(`${tko_scheme}://${window.location.host}/api/realtime`);
      tko_socket.onopen = () => {
        tko_attempt = 0;
        tko_socket?.send(JSON.stringify({ type: "subscribe", projectId: tko_input.projectId }));
      };
      tko_socket.onmessage = tko_raw => {
        try {
          const tko_event = JSON.parse(String(tko_raw.data)) as TkoRealtimeEnvelope;
          if (tko_event.type !== "event" || !tko_event.eventType?.startsWith("work.")) return;
          tko_callbackRef.current();
          const tko_actorMemberId = typeof tko_event.payload?.actorMemberId === "string" ? tko_event.payload.actorMemberId : null;
          if (!tko_actorMemberId || tko_actorMemberId !== tko_input.memberId) toast.info(tko_boardUpdateMessage(tko_event.eventType), { id: `work-realtime:${tko_event.eventId ?? tko_event.eventType}` });
        } catch {
          // Drop malformed socket payloads at the client boundary.
        }
      };
      tko_socket.onclose = () => {
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
  }, [tko_input.enabled, tko_input.memberId, tko_input.projectId]);
}
