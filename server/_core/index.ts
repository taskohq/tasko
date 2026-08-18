import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import pinoHttp from "pino-http";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { registerStorageProxy } from "./storageProxy";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { createCorrelationId, tko_logger } from "../../packages/observability/src/logger";
import { getPlatformHealth, getPlatformReadiness } from "../platform/health";
import { registerWebSocketGateway } from "../platform/websocket-gateway";

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
  const app = express();
  const server = createServer(app);
  app.use(
    pinoHttp({
      logger: tko_logger,
      genReqId: tko_request => createCorrelationId(tko_request.headers["x-correlation-id"] as string | undefined),
      redact: ["req.headers.authorization", "req.headers.cookie"],
    }),
  );
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  registerStorageProxy(app);
  registerOAuthRoutes(app);
  registerWebSocketGateway(server);
  app.get("/health", async (_req, res) => {
    res.status(200).json(await getPlatformHealth());
  });
  app.get("/ready", async (_req, res) => {
    const tko_readiness = await getPlatformReadiness();
    res.status(tko_readiness.status === "ready" ? 200 : 503).json(tko_readiness);
  });
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}

startServer().catch(console.error);
