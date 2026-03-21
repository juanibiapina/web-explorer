/**
 * Vitest config for Durable Object integration tests.
 *
 * Uses the Cloudflare Workers pool (workerd runtime). Only picks up
 * tests under ExplorerDO/ which need the DO runtime, WebSocketPair, etc.
 * Requires a standard Linux environment (won't work on NixOS locally).
 */

import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    include: ["src/ExplorerDO/**/*.test.ts"],
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.test.jsonc" },
        miniflare: {
          bindings: {
            TAVILY_API_KEY: "test-tavily-key",
            ZAI_API_KEY: "test-zai-key",
          },
        },
      },
    },
  },
});
