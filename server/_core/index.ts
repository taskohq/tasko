import "dotenv/config";
import Fastify from "fastify";
import fastifyCookie from "@fastify/cookie";
import net from "net";
import { parse as parseCookieHeader } from "cookie";
import { COOKIE_NAME } from "@shared/const";
import { fastifyTRPCPlugin } from "@trpc/server/adapters/fastify";
import {
  tko_extractSessionTokenFromHeaders,
  tko_isOriginAllowed,
  tko_shouldRevokeSessionForRequest,
} from "./security";
import { tko_revokeSessionByToken } from "../../modules/auth/src/session-service";
import { registerOAuthRoutes } from "./oauth";
import { registerStorageProxy } from "./storageProxy";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { createCorrelationId, tko_logger } from "../../packages/observability/src/logger";
import { getPlatformHealth, getPlatformReadiness } from "../platform/health";
import { registerWebSocketGateway } from "../platform/websocket-gateway";
import { registerPublicApiRoutes } from "../ecosystem/public-api";
import { registerPublicFormRoutes } from "../platform/public-forms";
import { registerEcosystemWebhookObserver } from "../../modules/ecosystem/src/developer-service";
import { registerMCPRoutes } from "../ai/mcp-server";
import { registerCRMHandoffWorker } from "../../modules/crm/src/crm-handoff-worker";
import { registerWorkspaceWorker } from "../../modules/workspace/src/workspace-worker";
import { registerWorkRealtimeWorker } from "../../modules/work/src/work-realtime-worker";
import { startWorker } from "../../modules/worker/src/worker-service";
import { deliverChatReminderPush } from "../platform/chat-reminder-push";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  // `loggerInstance` narrows the instance's logger generic to our pino logger;
  // erase it so the route-registration helpers keep their default
  // `FastifyInstance` parameter type (runtime behavior is unchanged).
  const tko_fastify = Fastify({
    loggerInstance: tko_logger,
    genReqId: tko_request => createCorrelationId(
      Array.isArray(tko_request.headers["x-correlation-id"])
        ? tko_request.headers["x-correlation-id"][0]
        : tko_request.headers["x-correlation-id"]
    ),
    // Base64 attachment uploads ride through the JSON API.
    bodyLimit: 50 * 1024 * 1024,
    // tRPC httpBatchLink encodes the whole procedure list as one wildcard path
    // param; Fastify's 100-char default rejects large batches with 414
    // (see tRPC Fastify adapter docs).
    maxParamLength: 5000,
  }) as unknown as import("fastify").FastifyInstance;
  await tko_fastify.register(fastifyCookie);

  // CSRF hardening: Origin/Referer validation for unsafe methods on
  // cookie-authenticated routes (pure verdict from ./security.ts). Requests
  // without the session cookie (Bearer/native clients, health checks) and safe
  // methods pass unconditionally; mismatches are rejected with 403.
  tko_fastify.addHook("onRequest", async (tko_req, tko_reply) => {
    if (!parseCookieHeader(tko_req.headers.cookie ?? "")[COOKIE_NAME]) return;
    const tko_verdict = tko_isOriginAllowed({
      method: tko_req.method,
      origin: tko_req.headers.origin,
      referer: tko_req.headers.referer,
      host: tko_req.headers.host,
      forwardedHost: tko_req.headers["x-forwarded-host"],
    });
    if (!tko_verdict.allowed) {
      void tko_reply.code(403).send({ error: "Cross-origin request rejected", reason: tko_verdict.reason });
    }
  });

  // Acceptance-test K: the logout mutation must revoke the presented session
  // row so its cookie stops working immediately. The tRPC procedure in
  // routers.ts stays untouched; this hook adapts Fastify to the
  // framework-agnostic session service.
  tko_fastify.addHook("onRequest", async tko_req => {
    if (!tko_shouldRevokeSessionForRequest({ method: tko_req.method, path: (tko_req.url ?? "").split("?")[0] })) return;
    const tko_sessionToken = tko_extractSessionTokenFromHeaders({
      cookieHeader: tko_req.headers.cookie,
      authorizationHeader: tko_req.headers.authorization,
      parseCookie: tko_header => parseCookieHeader(tko_header),
    });
    if (!tko_sessionToken) return;
    try {
      await tko_revokeSessionByToken(tko_sessionToken);
    } catch (tko_error) {
      tko_logger.error({ err: tko_error }, "[Auth] Logout session revocation failed");
    }
  });

  registerStorageProxy(tko_fastify);
  registerOAuthRoutes(tko_fastify);
  registerPublicApiRoutes(tko_fastify);
  registerMCPRoutes(tko_fastify);
  registerPublicFormRoutes(tko_fastify);
  registerEcosystemWebhookObserver();
  registerCRMHandoffWorker();
  registerWorkspaceWorker();
  registerWorkRealtimeWorker();
  const tko_stopWorker = startWorker();

  tko_fastify.get("/health", async () => getPlatformHealth());
  tko_fastify.get("/ready", async (_tko_req, tko_reply) => {
    const tko_readiness = await getPlatformReadiness();
    return tko_reply.code(tko_readiness.status === "ready" ? 200 : 503).send(tko_readiness);
  });
  tko_fastify.post("/api/scheduled/chat-reminder-push", async (tko_req, tko_reply) => deliverChatReminderPush(tko_req, tko_reply));

  // tRPC API
  await tko_fastify.register(fastifyTRPCPlugin, {
    prefix: "/api/trpc",
    trpcOptions: {
      router: appRouter,
      createContext,
    },
  });

  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(tko_fastify, tko_fastify.server);
  } else {
    await serveStatic(tko_fastify);
  }

  registerWebSocketGateway(tko_fastify.server);

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  await tko_fastify.listen({ port, host: "0.0.0.0" });

  for (const tko_signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(tko_signal, () => {
      void tko_fastify.close().finally(() => tko_stopWorker());
    });
  }
}

startServer().catch(console.error);
