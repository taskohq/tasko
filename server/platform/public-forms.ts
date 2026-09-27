// Public form intake HTTP layer (spec 10 §5). THIN Fastify registration wrapper around the
// PURE service logic in modules/workspace/src/public-form-service.ts — no business rules live here.
// Both routes are unauthenticated: the share slug is the credential.
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { publicFormDefinition, submitPublicForm } from "../../modules/workspace/src/public-form-service";

const tko_errorStatus = (tko_message: string): number => {
  if (tko_message === "WORKSPACE_FORM_NOT_FOUND") return 404;
  if (tko_message === "WORKSPACE_FORM_RATE_LIMITED") return 429;
  if (tko_message === "WORKSPACE_FORM_HONEYPOT_REJECTED" || tko_message.startsWith("WORKSPACE_FORM_REQUIRED_FIELD")) return 400;
  return 500;
};

const tko_clientIp = (tko_req: FastifyRequest): string => {
  if (typeof tko_req.ip === "string" && tko_req.ip) return tko_req.ip;
  return String(tko_req.socket?.remoteAddress ?? "unknown");
};

export function registerPublicFormRoutes(tko_fastify: FastifyInstance): void {
  tko_fastify.get("/api/public/forms/:slug", async (tko_req: FastifyRequest, tko_reply: FastifyReply) => {
    try {
      void tko_reply.code(200).send(await publicFormDefinition(String((tko_req.params as { slug?: string }).slug ?? "")));
    } catch (tko_error) {
      const tko_message = tko_error instanceof Error ? tko_error.message : "WORKSPACE_FORM_NOT_FOUND";
      void tko_reply.code(tko_errorStatus(tko_message)).send({ error: tko_message });
    }
  });

  tko_fastify.post("/api/public/forms/:slug", async (tko_req: FastifyRequest, tko_reply: FastifyReply) => {
    try {
      const tko_body = (tko_req.body ?? {}) as { values?: Record<string, unknown>; honeypot?: unknown; idempotencyKey?: unknown };
      const tko_idempotencyKey = typeof tko_body.idempotencyKey === "string" && tko_body.idempotencyKey ? tko_body.idempotencyKey : crypto.randomUUID();
      const tko_result = await submitPublicForm({ slug: String((tko_req.params as { slug?: string }).slug ?? ""), values: tko_body.values ?? {}, honeypot: tko_body.honeypot, clientIp: tko_clientIp(tko_req), idempotencyKey: tko_idempotencyKey });
      void tko_reply.code(tko_result.duplicate ? 200 : 201).send(tko_result);
    } catch (tko_error) {
      const tko_message = tko_error instanceof Error ? tko_error.message : "WORKSPACE_FORM_UNKNOWN_ERROR";
      void tko_reply.code(tko_errorStatus(tko_message)).send({ error: tko_message });
    }
  });
}
