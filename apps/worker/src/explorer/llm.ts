/**
 * LLM client using Cloudflare Workers AI.
 *
 * Runs inference on Cloudflare's edge network via the AI binding.
 * No external API keys needed. No per-day request quotas.
 *
 * Model history (external):
 * - gemini-2.5-flash: 20 RPD free tier, not enough for 13-step explorations.
 * - gemini-2.0-flash: deprecated Feb 2026, free tier quota set to 0.
 * - gemini-2.5-flash-lite: 20 RPD free tier, still too low.
 *
 * Switched to Workers AI to eliminate rate limit issues entirely.
 */

const MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

export interface LlmMessage {
  role: "system" | "user";
  content: string;
}

/**
 * Minimal interface for the Workers AI binding.
 * Matches the subset of Ai we actually use, making it easy to mock in tests.
 */
export interface AiBinding {
  run(
    model: string,
    inputs: {
      messages: { role: string; content: string }[];
      max_tokens?: number;
      temperature?: number;
      response_format?: { type: string };
    },
  ): Promise<{ response: string }>;
}

export async function llm(
  messages: LlmMessage[],
  ai: AiBinding,
): Promise<Record<string, unknown>> {
  const result = await ai.run(MODEL, {
    messages,
    temperature: 0.9,
    max_tokens: 4096,
    response_format: { type: "json_object" },
  });

  const content = result?.response;
  if (!content) {
    throw new Error("LLM returned empty response");
  }

  const parsed = extractJson(content);
  if (!parsed) {
    throw new Error(
      `LLM returned non-JSON content: ${content.slice(0, 200)}`,
    );
  }

  return parsed;
}

/**
 * Extract JSON from a string that may be wrapped in markdown code fences.
 *
 * Workers AI models (e.g. llama-3.3-70b) sometimes wrap JSON responses in
 * ```json ... ``` blocks despite response_format: { type: "json_object" }.
 *
 * Tries in order:
 * 1. Direct JSON.parse
 * 2. Extract from markdown code fence (```json ... ``` or ``` ... ```)
 * 3. Find outermost { ... } braces
 */
export function extractJson(text: string): Record<string, unknown> | null {
  // 1. Direct parse
  try {
    return JSON.parse(text);
  } catch {
    // continue
  }

  // 2. Strip markdown code fences
  const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (fenceMatch) {
    try {
      return JSON.parse(fenceMatch[1]);
    } catch {
      // continue
    }
  }

  // 3. Find outermost braces
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    try {
      return JSON.parse(text.slice(firstBrace, lastBrace + 1));
    } catch {
      // continue
    }
  }

  return null;
}
