/**
 * Cloudflare Worker entry point.
 *
 * Serves the React frontend via static assets and routes /api/* to the Hono app.
 * The scheduled handler triggers daily exploration creation at 6:00 UTC.
 */

import { createApp } from "./app";

/**
 * Get today's date as YYYY-MM-DD in UTC.
 */
function todayUTC(): string {
  return new Date().toISOString().split("T")[0];
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext) {
    return createApp(env).fetch(req, env, ctx);
  },

  async scheduled(_event: ScheduledEvent, env: Env, _ctx: ExecutionContext) {
    const indexId = env.INDEX_DO.idFromName("index");
    const index = env.INDEX_DO.get(indexId);
    await index.createExploration(todayUTC());
  },
};
