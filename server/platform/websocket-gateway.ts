import type { IncomingMessage, Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { sdk } from "../_core/sdk";
import { resolveTenantRequestContext, type TenantRequestContext } from "../../modules/tenancy/src/tenant-context";
import { can } from "../../modules/permissions/src/authorization";
import { getRedisAdapter, type TenantMessage } from "../../packages/redis/src/redis-adapter";
import { tko_logger } from "../../packages/observability/src/logger";
import { getWorkStore } from "../../packages/database/src/work-store";
import { getChatStore } from "../../packages/database/src/chat-store";
import type { Channel } from "../../packages/contracts/src/chat";
import type { PlatformActor } from "../../packages/contracts/src/platform";

type ConnectedClient = {
  socket: WebSocket;
  context: TenantRequestContext;
  projectId: string | null;
  channelIds: Set<string>;
  unsubscribe: (() => Promise<void>) | null;
};

type SubscribeMessage = { type?: string; tenantId?: string; projectId?: string; channelId?: string };

function getHeader(tko_request: IncomingMessage, tko_header: string): string | undefined {
  const tko_value = tko_request.headers[tko_header];
  return Array.isArray(tko_value) ? tko_value[0] : tko_value;
}

function sendJson(tko_socket: WebSocket, tko_body: Record<string, unknown>): void {
  if (tko_socket.readyState === WebSocket.OPEN) tko_socket.send(JSON.stringify(tko_body));
}

/** Resolve the routing key of a tenant event. Channel events win because chat payloads carry
 * `channelId`; work events fall back to the project resolved from `projectId`/`workItemId`;
 * ephemeral presence carries neither and stays tenant-wide. */
function resolveEventRouting(tko_payload: Record<string, unknown>, tko_projectIdFallback: string | null): { channelId: string | null; projectId: string | null; tenantWide: boolean } {
  if (typeof tko_payload.channelId === "string") return { channelId: tko_payload.channelId, projectId: null, tenantWide: false };
  const tko_projectId = typeof tko_payload.projectId === "string" ? tko_payload.projectId : tko_projectIdFallback;
  if (tko_projectId) return { channelId: null, projectId: tko_projectId, tenantWide: false };
  return { channelId: null, projectId: null, tenantWide: true };
}

/** Authorization rules for a channel subscription: the channel must exist in the tenant, and
 * non-public channels additionally require explicit membership (Slack-style private membership is
 * authoritative even for owners); `can` then enforces role + guest scoping. */
async function authorizeChannelSubscription(tko_actor: PlatformActor, tko_channelId: string): Promise<Channel> {
  const tko_channel = await getChatStore().getChannel(tko_actor.tenantId, tko_channelId);
  if (!tko_channel || tko_channel.archivedAt) throw new Error("CHAT_CHANNEL_NOT_FOUND");
  if (tko_channel.kind !== "public" && !tko_channel.memberIds.includes(tko_actor.memberId)) throw new Error("TASKO_AUTHORIZATION_DENIED:private_resource");
  const tko_decision = can(tko_actor, "chat.channel.read", { tenantId: tko_actor.tenantId, type: "channel", id: tko_channel.id, visibility: tko_channel.visibility, explicitMemberIds: tko_channel.memberIds });
  if (!tko_decision.allowed) throw new Error(`Authorization denied: ${tko_decision.reason}`);
  return tko_channel;
}

export const tko_realtimeTestHooks = { resolveEventRouting, authorizeChannelSubscription };

export function registerWebSocketGateway(tko_server: Server): { close(): Promise<void> } {
  const tko_gateway = new WebSocketServer({ noServer: true });
  const tko_clients = new Set<ConnectedClient>();

  const tko_handleTenantMessage = async (tko_message: TenantMessage) => {
    let tko_fallbackProjectId: string | null = typeof tko_message.payload.projectId === "string" ? tko_message.payload.projectId : null;
    if (!tko_fallbackProjectId && typeof tko_message.payload.workItemId === "string") {
      tko_fallbackProjectId = (await getWorkStore().getWorkItem(tko_message.tenantId, tko_message.payload.workItemId))?.projectId ?? null;
    }
    const tko_routing = resolveEventRouting(tko_message.payload, tko_fallbackProjectId);
    for (const tko_client of Array.from(tko_clients)) {
      if (tko_client.context.actor.tenantId !== tko_message.tenantId) continue;
      const tko_matched = tko_routing.tenantWide
        || (tko_routing.channelId !== null && tko_client.channelIds.has(tko_routing.channelId))
        || (tko_routing.projectId !== null && tko_client.projectId === tko_routing.projectId);
      if (tko_matched) sendJson(tko_client.socket, { type: "event", ...tko_message });
    }
  };

  tko_server.on("upgrade", async (tko_request, tko_socket, tko_head) => {
    if (!tko_request.url?.startsWith("/api/realtime")) {
      tko_socket.destroy();
      return;
    }

    try {
      const tko_user = await sdk.authenticateRequest(tko_request as unknown as Parameters<typeof sdk.authenticateRequest>[0]);
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
        const tko_client: ConnectedClient = { socket: tko_ws, context: tko_context, projectId: null, channelIds: new Set(), unsubscribe: null };
        tko_clients.add(tko_client);
        sendJson(tko_ws, {
          type: "connected",
          tenantSlug: tko_context.actor.tenantSlug,
          correlationId: tko_context.actor.correlationId,
        });

        const tko_ensureRedisSubscription = async () => {
          if (!tko_client.unsubscribe) {
            tko_client.unsubscribe = await getRedisAdapter().subscribeTenant(
              tko_context.actor.tenantId,
              tko_handleTenantMessage,
            );
          }
        };

        tko_ws.on("message", async tko_rawMessage => {
          try {
            const tko_message = JSON.parse(tko_rawMessage.toString()) as SubscribeMessage;
            if (tko_message.type !== "subscribe") throw new Error("Unsupported realtime message");
            if (tko_message.tenantId && tko_message.tenantId !== tko_context.actor.tenantId) {
              throw new Error("TASKO_AUTHORIZATION_DENIED:tenant_mismatch");
            }
            if (tko_message.channelId) {
              const tko_channel = await authorizeChannelSubscription(tko_context.actor, tko_message.channelId);
              tko_client.channelIds.add(tko_channel.id);
              await tko_ensureRedisSubscription();
              sendJson(tko_ws, { type: "subscribed", tenantSlug: tko_context.actor.tenantSlug, channelId: tko_channel.id });
              return;
            }
            if (!tko_message.projectId) throw new Error("WORK_PROJECT_REQUIRED");
            const tko_project = await getWorkStore().getProject(tko_context.actor.tenantId, tko_message.projectId);
            if (!tko_project) throw new Error("WORK_PROJECT_NOT_FOUND");
            const tko_projectDecision = can(tko_context.actor, "work.project.read", tko_project);
            if (!tko_projectDecision.allowed) throw new Error(`Authorization denied: ${tko_projectDecision.reason}`);
            tko_client.projectId = tko_project.id;
            await tko_ensureRedisSubscription();
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
