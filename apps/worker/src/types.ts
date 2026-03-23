/**
 * Cloudflare Worker environment bindings.
 */
export interface Env {
  EXPLORER_DO: DurableObjectNamespace;
  TAVILY_API_KEY: string;
  ZAI_API_KEY: string;
  BRAVE_API_KEY?: string;
}
