/**
 * HTTP API using Hono.
 *
 * Routes:
 * - GET  /api/health              - Health check
 * - GET  /api/explorations        - List available exploration dates
 * - GET  /api/exploration/:date   - Get a specific day's exploration data
 * - GET  /api/stream              - WebSocket upgrade to today's exploration
 * - GET  /api/stream?date=:date   - WebSocket upgrade to a specific day
 * - POST /api/trigger             - Manually trigger today's exploration (same as cron)
 */

import { Hono } from "hono";
import type { ExplorationDO } from "./ExplorationDO";

/**
 * Get today's date as YYYY-MM-DD in UTC.
 */
function todayUTC(): string {
  return new Date().toISOString().split("T")[0];
}

export const createApp = (env: Env) => {
  const app = new Hono<{ Bindings: Env }>();

  app.get("/api/health", (c) => c.json({ ok: true }));

  app.get("/api/explorations", async (c) => {
    const indexId = env.INDEX_DO.idFromName("index");
    const index = env.INDEX_DO.get(indexId);
    const days = await index.listDays();
    return c.json({ days });
  });

  app.get("/api/exploration/:date", async (c) => {
    const date = c.req.param("date");

    const indexId = env.INDEX_DO.idFromName("index");
    const index = env.INDEX_DO.get(indexId);
    const hexId = await index.getExplorationId(date);

    if (!hexId) {
      return c.json({ error: "No exploration for this date" }, 404);
    }

    const explorationId = env.EXPLORATION_DO.idFromString(hexId);
    const exploration = env.EXPLORATION_DO.get(explorationId) as DurableObjectStub<ExplorationDO>;
    const data = await exploration.getExploration();

    if (!data) {
      return c.json({ error: "Exploration not found" }, 404);
    }

    return c.json(data);
  });

  app.get("/api/stream", async (c) => {
    const upgradeHeader = c.req.header("Upgrade");
    if (upgradeHeader !== "websocket") {
      return c.json({ error: "Expected WebSocket upgrade" }, 426);
    }

    const date = c.req.query("date") ?? todayUTC();

    const indexId = env.INDEX_DO.idFromName("index");
    const index = env.INDEX_DO.get(indexId);
    const hexId = await index.getExplorationId(date);

    if (!hexId) {
      return c.json({ error: "No exploration for this date" }, 404);
    }

    const explorationId = env.EXPLORATION_DO.idFromString(hexId);
    const stub = env.EXPLORATION_DO.get(explorationId) as DurableObjectStub<ExplorationDO>;
    return stub.fetch(c.req.raw);
  });

  app.post("/api/trigger", async (c) => {
    const date = c.req.query("date") ?? todayUTC();
    const mode = c.req.query("mode") === "follow" ? "follow" as const : "search" as const;
    const indexId = env.INDEX_DO.idFromName("index");
    const index = env.INDEX_DO.get(indexId);
    const hexId = await index.createExploration(date, mode);
    return c.json({ date, mode, explorationId: hexId });
  });

  return app;
};
