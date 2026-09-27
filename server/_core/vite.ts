import fs from "fs";
import type { FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import middie from "@fastify/middie";
import { type Server } from "http";
import { nanoid } from "nanoid";
import path from "path";
import { createServer as createViteServer } from "vite";
import viteConfig from "../../vite.config";

/** Paths that must never fall through to the SPA HTML handlers. */
function tko_isApiPath(tko_url: string) {
  return tko_url.startsWith("/api/") || tko_url.startsWith("/manus-storage/") || tko_url === "/health" || tko_url === "/ready";
}

export async function setupVite(fastify: FastifyInstance, server: Server) {
  const serverOptions = {
    middlewareMode: true,
    hmr: { server },
    allowedHosts: true as const,
  };

  const vite = await createViteServer({
    ...viteConfig,
    configFile: false,
    server: serverOptions,
    appType: "custom",
  });

  await fastify.register(middie);
  fastify.use(vite.middlewares);
  fastify.use((tko_req, tko_res, tko_next) => {
    const url = tko_req.originalUrl ?? tko_req.url ?? "/";
    if (tko_isApiPath(url)) {
      tko_next();
      return;
    }

    (async () => {
      try {
        const clientTemplate = path.resolve(
          import.meta.dirname,
          "../..",
          "client",
          "index.html"
        );

        // always reload the index.html file from disk incase it changes
        let template = await fs.promises.readFile(clientTemplate, "utf-8");
        template = template.replace(
          `src="/src/main.tsx"`,
          `src="/src/main.tsx?v=${nanoid()}"`
        );
        const page = await vite.transformIndexHtml(url, template);
        tko_res.statusCode = 200;
        tko_res.setHeader("Content-Type", "text/html");
        tko_res.end(page);
      } catch (e) {
        vite.ssrFixStacktrace(e as Error);
        tko_next(e);
      }
    })();
  });
}

export async function serveStatic(fastify: FastifyInstance) {
  const distPath =
    process.env.NODE_ENV === "development"
      ? path.resolve(import.meta.dirname, "../..", "dist", "public")
      : path.resolve(import.meta.dirname, "public");
  if (!fs.existsSync(distPath)) {
    console.error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`
    );
  }

  await fastify.register(fastifyStatic, { root: distPath, wildcard: false });

  // fall through to index.html if the file doesn't exist
  fastify.setNotFoundHandler(async (tko_req, tko_reply) => {
    const url = tko_req.raw.url ?? "/";
    if (tko_isApiPath(url)) {
      void tko_reply.code(404).send({ error: "not_found" });
      return;
    }
    void tko_reply.sendFile(path.resolve(distPath, "index.html"));
  });
}
