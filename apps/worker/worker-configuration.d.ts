// Cloudflare Workers runtime types + project-specific env
/// <reference types="@cloudflare/workers-types" />

interface Env {
  EXPLORER_DO: DurableObjectNamespace<import("./src/index").ExplorerDO>;
  TAVILY_API_KEY: string;
  ZAI_API_KEY: string;
}
