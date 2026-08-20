import type { IncomingMessage, Server } from "http";
import type { Request } from "express";
import { WebSocketServer, WebSocket } from "ws";
import { sdk } from "../_core/sdk";
import { resolveTenantRequestContext, type TenantRequestContext } from "../../modules/tenancy/src/tenant-context";
import { can } from "../../modules/permissions/src/authorization";
import { getRedisAdapter, type TenantMessage } from "../../packages/redis/src/redis-adapter";
import { tko_logger } from "../../packages/observability/src/logger";
import { getWorkStore } from "../../packages/database/src/work-store";

type ConnectedClient = {
  socket: WebSocket;
  context: TenantRequestContext;
  projectId: string | null;
  unsubscribe: (() => Promise<void>) | null;
};

function getHeader(tko_request: IncomingMessage, tko_header: string): string | undefined {
  const tko_value = tko_request.headers[tko_header];
  return Array.isArray(tko_value) ? tko_value[0] : tko_value;
}

function sendJson(tko_socket: WebSocket, tko_body: Record<string, unknown>): void {
  if (tko_socket.readyState === WebSocket.OPEN) tko_socket.send(JSON.stringify(tko_body));
}

export function registerWebSocketGateway(tko_server: Server): { close(): Promise<void> } {
  const tko_gateway = new WebSocketServer({ noServer: true });
  const tko_clients = new Set<ConnectedClient>();

  const tko_handleTenantMessage = async (tko_message: TenantMessage) => {
    const tko_eventProjectId = typeof tko_message.payload.projectId === "string"
      ? tko_message.payload.projectId
      : typeof tko_message.payload.workItemId === "string"
        ? (await getWorkStore().getWorkItem(tko_message.tenantId, tko_message.payload.workItemId))?.projectId ?? null
        : null;
    for (const tko_client of Array.from(tko_clients)) {
      if (tko_client.context.actor.tenantId === tko_message.tenantId && tko_client.projectId === tko_eventProjectId) {
        sendJson(tko_client.socket, { type: "event", ...tko_message });
      }
    }
  };

  tko_server.on("upgrade", async (tko_request, tko_socket, tko_head) => {
    if (!tko_request.url?.startsWith("/api/realtime")) {
      tko_socket.destroy();
      return;
    }

    try {
      const tko_user = await sdk.authenticateRequest(tko_request as Request);
      const tko_context = await resolveTenantRequestContext({
        authSubject: tko_user.openId,
        candidateTenantSlug: getHeader(tko_request, "x-tasko-workspace"),
        correlationId: getHeader(tko_request, "x-correlation-id"),
      });
      if (!tko_context) throw new Error("Active workspace membership is required");
      const tko_decision = can(tko_context.actor, "realtime.connect", {
        tenantId: tko_context.actor.tenantId,
        type: "realtime_gateway",
        id: "gateway",
        visibility: "internal",
      });
      if (!tko_decision.allowed) throw new Error(`Authorization denied: ${tko_decision.reason}`);

      tko_gateway.handleUpgrade(tko_request, tko_socket, tko_head, tko_ws => {
        const tko_client: ConnectedClient = { socket: tko_ws, context: tko_context, projectId: null, unsubscribe: null };
        tko_clients.add(tko_client);
        sendJson(tko_ws, {
          type: "connected",
          tenantSlug: tko_context.actor.tenantSlug,
          correlationId: tko_context.actor.correlationId,
        });

        tko_ws.on("message", async tko_rawMessage => {
          try {
            const tko_message = JSON.parse(tko_rawMessage.toString()) as { type?: string; tenantId?: string; projectId?: string };
            if (tko_message.type !== "subscribe") throw new Error("Unsupported realtime message");
            if (tko_message.tenantId && tko_message.tenantId !== tko_context.actor.tenantId) {
              throw new Error("TASKO_AUTHORIZATION_DENIED:tenant_mismatch");
            }
            if (!tko_message.projectId) throw new Error("WORK_PROJECT_REQUIRED");
            const tko_project = await getWorkStore().getProject(tko_context.actor.tenantId, tko_message.projectId);
            if (!tko_project) throw new Error("WORK_PROJECT_NOT_FOUND");
            const tko_projectDecision = can(tko_context.actor, "work.project.read", tko_project);
            if (!tko_projectDecision.allowed) throw new Error(`Authorization denied: ${tko_projectDecision.reason}`);
            tko_client.projectId = tko_project.id;
            if (!tko_client.unsubscribe) {
              tko_client.unsubscribe = await getRedisAdapter().subscribeTenant(
                tko_context.actor.tenantId,
                tko_handleTenantMessage,
              );
            }
            sendJson(tko_ws, { type: "subscribed", tenantSlug: tko_context.actor.tenantSlug, projectId: tko_project.id });
          } catch (tko_error) {
            sendJson(tko_ws, { type: "error", code: "forbidden" });
            tko_logger.warn({ err: tko_error, tenantId: tko_context.actor.tenantId }, "realtime subscription rejected");
          }
        });

        tko_ws.on("close", () => {
          tko_clients.delete(tko_client);
          if (tko_client.unsubscribe) void tko_client.unsubscribe();
        });
      });
    } catch (tko_error) {
      tko_socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      tko_socket.destroy();
      tko_logger.warn({ err: tko_error }, "realtime upgrade rejected");
    }
  });

  return {
    async close() {
      for (const tko_client of Array.from(tko_clients)) {
        if (tko_client.unsubscribe) await tko_client.unsubscribe();
        tko_client.socket.close();
      }
      await new Promise<void>(tko_resolve => tko_gateway.close(() => tko_resolve()));
    },
  };
}
