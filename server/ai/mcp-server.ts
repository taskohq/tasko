import crypto from "node:crypto";
import type { Express, Request, Response } from "express";
import type { AIToolName } from "../../packages/contracts/src/ai";
import { getDeveloperService } from "../../modules/ecosystem/src/developer-service";
import { requireCapability } from "../../modules/permissions/src/authorization";
import { proposeAction } from "../../modules/ai/src/ai-service";
import { getAITool, listAITools } from "../../modules/ai/src/tool-registry";
import { getRedisAdapter } from "../../packages/redis/src/redis-adapter";

const tko_token = (tko_request: Request): string | null => { const tko_header = tko_request.header("authorization"); return tko_header?.startsWith("Bearer tko_") ? tko_header.slice(7) : null; };
const tko_correlation = (tko_request: Request): string => String(tko_request.headers["x-correlation-id"] ?? `mcp:${crypto.randomUUID()}`);
const tko_reply = (tko_response: Response, tko_id: unknown, tko_result: unknown, tko_status = 200) => tko_response.status(tko_status).json({ jsonrpc: "2.0", id: tko_id ?? null, result: tko_result });
const tko_error = (tko_response: Response, tko_id: unknown, tko_errorValue: unknown) => { const tko_message = tko_errorValue instanceof Error ? tko_errorValue.message : "MCP_REQUEST_FAILED"; const tko_status = /TOKEN|SCOPE|AUTHORIZATION|FORBIDDEN/.test(tko_message) ? 403 : 400; return tko_response.status(tko_status).json({ jsonrpc: "2.0", id: tko_id ?? null, error: { code: tko_status === 403 ? -32003 : -32602, message: tko_message } }); };

export function registerMCPRoutes(tko_app: Express): void {
  tko_app.post("/api/mcp", async (tko_request, tko_response) => {
    const tko_id = tko_request.body?.id;
    try {
      const tko_actor = await getDeveloperService().authenticatePublicToken(tko_token(tko_request) ?? "", "mcp:connect", tko_correlation(tko_request));
      requireCapability(tko_actor, "mcp.connect", { tenantId: tko_actor.tenantId, type: "mcp_connection", id: "beta", visibility: "internal" });
      const tko_limit = await getRedisAdapter().takeRateLimit(`mcp:${tko_actor.tenantId}:${tko_actor.memberId}`, 60, 60_000);
      if (!tko_limit.allowed) throw new Error("MCP_RATE_LIMITED");
      const tko_method = tko_request.body?.method;
      if (tko_method === "initialize") return tko_reply(tko_response, tko_id, { protocolVersion: "2025-03-26", serverInfo: { name: "tasko-mcp", version: "0.1.0-beta" }, capabilities: { tools: {} } });
      if (tko_method === "tools/list") return tko_reply(tko_response, tko_id, { tools: listAITools().map(tko_tool => ({ name: tko_tool.name, description: tko_tool.requiresConfirmation ? `${tko_tool.description} This call creates a confirmation-required proposal only.` : tko_tool.description, inputSchema: { type: "object", additionalProperties: true } })) });
      if (tko_method === "tools/call") {
        const tko_name = String(tko_request.body?.params?.name ?? "") as AIToolName;
        const tko_arguments = tko_request.body?.params?.arguments;
        if (!tko_arguments || typeof tko_arguments !== "object" || Array.isArray(tko_arguments)) throw new Error("MCP_TOOL_ARGUMENTS_INVALID");
        const tko_tool = getAITool(tko_name);
        const tko_result = tko_tool.requiresConfirmation
          ? await proposeAction(tko_actor, { toolName: tko_name, input: tko_arguments as Record<string, unknown>, correlationId: tko_correlation(tko_request) })
          : await tko_tool.execute(tko_actor, tko_arguments as Record<string, unknown>, tko_correlation(tko_request));
        return tko_reply(tko_response, tko_id, { content: [{ type: "text", text: JSON.stringify(tko_result) }] });
      }
      throw new Error("MCP_METHOD_NOT_SUPPORTED");
    } catch (tko_failure) { return tko_error(tko_response, tko_id, tko_failure); }
  });
}
