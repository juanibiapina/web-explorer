// Cloudflare Workers runtime types + project-specific env
/// <reference types="@cloudflare/workers-types" />

interface Env {
  INDEX_DO: DurableObjectNamespace<import("./src/index").IndexDO>;
  EXPLORATION_DO: DurableObjectNamespace<import("./src/index").ExplorationDO>;
  TAVILY_API_KEY: string;
  ZAI_API_KEY: string;
}
