/**
 * Google Gemini LLM client (Gemini 2.0 Flash).
 * Uses the OpenAI-compatible endpoint.
 *
 * Gemini 2.5 Flash free tier only allows 20 requests/day,
 * which isn't enough for a 13-step exploration.
 * Gemini 2.0 Flash has 1500 requests/day on the free tier.
 */

const BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai";
const MODEL = "gemini-2.0-flash";

export interface LlmMessage {
  role: "system" | "user";
  content: string;
}

export async function llm(
  messages: LlmMessage[],
  apiKey: string
): Promise<Record<string, unknown>> {
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      messages,
      temperature: 0.9,
      max_tokens: 4096,
      response_format: { type: "json_object" },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`LLM API error ${res.status}: ${text}`);
  }

  const data = (await res.json()) as {
    choices: Array<{ message: { content: string }; finish_reason: string }>;
  };

  if (!data.choices?.length) {
    throw new Error("LLM returned no choices");
  }

  const choice = data.choices[0];
  const content = choice.message?.content;
  if (!content) {
    const reason = choice.finish_reason || "unknown";
    throw new Error(
      `LLM returned empty content (finish_reason: ${reason}). ` +
        "This often means all tokens were consumed by reasoning."
    );
  }

  try {
    return JSON.parse(content);
  } catch {
    throw new Error(
      `LLM returned non-JSON content: ${content.slice(0, 200)}`
    );
  }
}
