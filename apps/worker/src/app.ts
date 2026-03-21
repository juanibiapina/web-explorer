/**
 * HTTP API using Hono.
 *
 * Routes:
 * - GET /api/stream - WebSocket upgrade to the shared exploration stream
 * - GET /api/health - Health check
 */

import { Hono } from "hono";
import type { Env } from "./types";
import type { ExplorerDO } from "./ExplorerDO";

export const createApp = (env: Env) => {
  const app = new Hono<{ Bindings: Env }>();

  app.get("/api/health", (c) => c.json({ ok: true }));

  app.get("/api/stream", async (c) => {
    const upgradeHeader = c.req.header("Upgrade");
    if (upgradeHeader !== "websocket") {
      return c.json({ error: "Expected WebSocket upgrade" }, 426);
    }

    // All viewers connect to the same DO instance (singleton by name)
    const id = env.EXPLORER_DO.idFromName("global");
    const stub = env.EXPLORER_DO.get(id) as DurableObjectStub<ExplorerDO>;
    return stub.fetch(c.req.raw);
  });

  return app;
};
