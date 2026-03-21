/**
 * Cloudflare Worker entry point.
 *
 * Serves the React frontend via static assets and routes /api/* to the Hono app.
 * The ExplorerDO handles the live exploration stream via WebSocket.
 */

import { createApp } from "./app";
import type { Env } from "./types";

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext) {
    return createApp(env).fetch(req, env, ctx);
  },
};
