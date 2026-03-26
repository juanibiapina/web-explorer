// Cloudflare Workers runtime types + project-specific env
/// <reference types="@cloudflare/workers-types" />

interface Env {
  AI: Ai;
  INDEX_DO: DurableObjectNamespace<import("./src/index").IndexDO>;
  EXPLORATION_DO: DurableObjectNamespace<import("./src/index").ExplorationDO>;
  TAVILY_API_KEY: string;
}

// Cloudflare.Env is used by `import { env } from "cloudflare:workers"` in tests
declare namespace Cloudflare {
  interface Env {
    AI: Ai;
    INDEX_DO: DurableObjectNamespace<import("./src/index").IndexDO>;
    EXPLORATION_DO: DurableObjectNamespace<import("./src/index").ExplorationDO>;
    TAVILY_API_KEY: string;
  }
}
