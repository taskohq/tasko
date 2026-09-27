import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import crypto from "node:crypto";
import { getDeveloperService } from "../../modules/ecosystem/src/developer-service";
import { getImportService } from "../../modules/ecosystem/src/import-service";

const tko_token = (tko_request: FastifyRequest): string | null => {
  const tko_raw = tko_request.headers.authorization;
  const tko_header = Array.isArray(tko_raw) ? tko_raw[0] : tko_raw;
  return tko_header?.startsWith("Bearer tko_") ? tko_header.slice(7) : null;
};
const tko_correlation = (tko_request: FastifyRequest): string => String(tko_request.headers["x-correlation-id"] ?? crypto.randomUUID());
const tko_fail = (tko_reply: FastifyReply, tko_error: unknown): void => {
  const tko_message = tko_error instanceof Error ? tko_error.message : "PUBLIC_API_ERROR";
  const tko_status = tko_message.includes("SCOPE_DENIED") || tko_message.includes("AUTHORIZATION") ? 403 : tko_message.includes("TOKEN") ? 401 : 400;
  void tko_reply.code(tko_status).send({ error: { code: tko_message, requestId: undefined } });
};

export function registerPublicApiRoutes(tko_fastify: FastifyInstance): void {
  tko_fastify.get("/api/v1/imports/:jobId/preview", async (tko_request, tko_reply) => {
    try {
      const tko_actor = await getDeveloperService().authenticatePublicToken(tko_token(tko_request) ?? "", "imports:read", tko_correlation(tko_request));
      void tko_reply.send({ data: await getImportService().preview(tko_actor, (tko_request.params as { jobId: string }).jobId), requestId: tko_correlation(tko_request) });
    } catch (tko_error) {
      tko_fail(tko_reply, tko_error);
    }
  });
  tko_fastify.get("/api/v1/webhooks/deliveries", async (tko_request, tko_reply) => {
    try {
      const tko_actor = await getDeveloperService().authenticatePublicToken(tko_token(tko_request) ?? "", "webhooks:manage", tko_correlation(tko_request));
      const tko_query = (tko_request.query ?? {}) as Record<string, unknown>;
      void tko_reply.send({ data: await getDeveloperService().listDeliveries(tko_actor, typeof tko_query.subscriptionId === "string" ? tko_query.subscriptionId : undefined), requestId: tko_correlation(tko_request) });
    } catch (tko_error) {
      tko_fail(tko_reply, tko_error);
    }
  });
}
