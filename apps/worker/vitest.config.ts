/**
 * Vitest config for Durable Object integration tests.
 *
 * Uses the Cloudflare Workers pool (workerd runtime). Picks up tests
 * under ExplorationDO/ and IndexDO/ which need the DO runtime,
 * WebSocketPair, storage, alarms, etc.
 * Requires a standard Linux environment (won't work on NixOS locally).
 */

import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      // Disabled: DO alarm writes (setAlarm) conflict with the storage
      // isolation mechanism. Tests use unique DO names for isolation instead.
      isolatedStorage: false,
      wrangler: { configPath: "./wrangler.test.jsonc" },
      miniflare: {
        bindings: {
          TAVILY_API_KEY: "test-tavily-key",
        },
      },
    }),
  ],
  test: {
    include: [
      "src/ExplorationDO/**/*.test.ts",
      "src/IndexDO/**/*.test.ts",
    ],
  },
});
