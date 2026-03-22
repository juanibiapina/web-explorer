/**
 * Z.AI LLM client (GLM-4.7-Flash).
 */

const BASE_URL = "https://api.z.ai/api/coding/paas/v4";
const MODEL = "glm-4.7-flash";

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
      reasoning_effort: "medium",
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
