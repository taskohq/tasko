import crypto from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AIToolName } from "../../packages/contracts/src/ai";
import { getDeveloperService } from "../../modules/ecosystem/src/developer-service";
import { requireCapability } from "../../modules/permissions/src/authorization";
import { proposeAction } from "../../modules/ai/src/ai-service";
import { getAITool, listAITools } from "../../modules/ai/src/tool-registry";
import { getRedisAdapter } from "../../packages/redis/src/redis-adapter";

const tko_token = (tko_request: FastifyRequest): string | null => {
  const tko_raw = tko_request.headers.authorization;
  const tko_header = Array.isArray(tko_raw) ? tko_raw[0] : tko_raw;
  return tko_header?.startsWith("Bearer tko_") ? tko_header.slice(7) : null;
};
const tko_correlation = (tko_request: FastifyRequest): string => String(tko_request.headers["x-correlation-id"] ?? `mcp:${crypto.randomUUID()}`);
const tko_body = (tko_request: FastifyRequest): Record<string, any> => (tko_request.body ?? {}) as Record<string, any>;
const tko_send = (tko_reply: FastifyReply, tko_id: unknown, tko_result: unknown, tko_status = 200) => tko_reply.code(tko_status).send({ jsonrpc: "2.0", id: tko_id ?? null, result: tko_result });
const tko_error = (tko_reply: FastifyReply, tko_id: unknown, tko_errorValue: unknown) => {
  const tko_message = tko_errorValue instanceof Error ? tko_errorValue.message : "MCP_REQUEST_FAILED";
  const tko_status = /TOKEN|SCOPE|AUTHORIZATION|FORBIDDEN/.test(tko_message) ? 403 : 400;
  return tko_reply.code(tko_status).send({ jsonrpc: "2.0", id: tko_id ?? null, error: { code: tko_status === 403 ? -32003 : -32602, message: tko_message } });
};

export function registerMCPRoutes(tko_fastify: FastifyInstance): void {
  tko_fastify.post("/api/mcp", async (tko_request, tko_reply) => {
    const tko_id = tko_body(tko_request)?.id;
    try {
      const tko_actor = await getDeveloperService().authenticatePublicToken(tko_token(tko_request) ?? "", "mcp:connect", tko_correlation(tko_request));
      requireCapability(tko_actor, "mcp.connect", { tenantId: tko_actor.tenantId, type: "mcp_connection", id: "beta", visibility: "internal" });
      const tko_limit = await getRedisAdapter().takeRateLimit(`mcp:${tko_actor.tenantId}:${tko_actor.memberId}`, 60, 60_000);
      if (!tko_limit.allowed) throw new Error("MCP_RATE_LIMITED");
      const tko_method = tko_body(tko_request)?.method;
      if (tko_method === "initialize") return tko_send(tko_reply, tko_id, { protocolVersion: "2025-03-26", serverInfo: { name: "tasko-mcp", version: "0.1.0-beta" }, capabilities: { tools: {} } });
      if (tko_method === "tools/list") return tko_send(tko_reply, tko_id, { tools: listAITools().map(tko_tool => ({ name: tko_tool.name, description: tko_tool.requiresConfirmation ? `${tko_tool.description} This call creates a confirmation-required proposal only.` : tko_tool.description, inputSchema: { type: "object", additionalProperties: true } })) });
      if (tko_method === "tools/call") {
        const tko_name = String(tko_body(tko_request)?.params?.name ?? "") as AIToolName;
        const tko_arguments = tko_body(tko_request)?.params?.arguments;
        if (!tko_arguments || typeof tko_arguments !== "object" || Array.isArray(tko_arguments)) throw new Error("MCP_TOOL_ARGUMENTS_INVALID");
        const tko_tool = getAITool(tko_name);
        const tko_result = tko_tool.requiresConfirmation
          ? await proposeAction(tko_actor, { toolName: tko_name, input: tko_arguments as Record<string, unknown>, correlationId: tko_correlation(tko_request) })
          : await tko_tool.execute(tko_actor, tko_arguments as Record<string, unknown>, tko_correlation(tko_request));
        return tko_send(tko_reply, tko_id, { content: [{ type: "text", text: JSON.stringify(tko_result) }] });
      }
      throw new Error("MCP_METHOD_NOT_SUPPORTED");
    } catch (tko_failure) { return tko_error(tko_reply, tko_id, tko_failure); }
  });
}
