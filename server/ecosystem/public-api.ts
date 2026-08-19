import type { Express, Request, Response } from "express";
import crypto from "node:crypto";
import { getDeveloperService } from "../../modules/ecosystem/src/developer-service";
import { getImportService } from "../../modules/ecosystem/src/import-service";

const tko_token = (tko_request: Request): string | null => { const tko_header = tko_request.header("authorization"); return tko_header?.startsWith("Bearer tko_") ? tko_header.slice(7) : null; };
const tko_correlation = (tko_request: Request): string => String(tko_request.headers["x-correlation-id"] ?? crypto.randomUUID());
const tko_fail = (tko_response: Response, tko_error: unknown): void => { const tko_message = tko_error instanceof Error ? tko_error.message : "PUBLIC_API_ERROR"; const tko_status = tko_message.includes("SCOPE_DENIED") || tko_message.includes("AUTHORIZATION") ? 403 : tko_message.includes("TOKEN") ? 401 : 400; tko_response.status(tko_status).json({ error: { code: tko_message, requestId: tko_response.locals.correlationId ?? undefined } }); };

export function registerPublicApiRoutes(tko_app: Express): void {
  tko_app.get("/api/v1/imports/:jobId/preview", async (tko_request, tko_response) => { try { const tko_actor = await getDeveloperService().authenticatePublicToken(tko_token(tko_request) ?? "", "imports:read", tko_correlation(tko_request)); tko_response.json({ data: await getImportService().preview(tko_actor, tko_request.params.jobId), requestId: tko_correlation(tko_request) }); } catch (tko_error) { tko_fail(tko_response, tko_error); } });
  tko_app.get("/api/v1/webhooks/deliveries", async (tko_request, tko_response) => { try { const tko_actor = await getDeveloperService().authenticatePublicToken(tko_token(tko_request) ?? "", "webhooks:manage", tko_correlation(tko_request)); tko_response.json({ data: await getDeveloperService().listDeliveries(tko_actor, typeof tko_request.query.subscriptionId === "string" ? tko_request.query.subscriptionId : undefined), requestId: tko_correlation(tko_request) }); } catch (tko_error) { tko_fail(tko_response, tko_error); } });
}
