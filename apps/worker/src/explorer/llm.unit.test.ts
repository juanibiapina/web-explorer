/**
 * Unit tests for Workers AI LLM client.
 * Mocks the AI binding — no API key or external calls needed.
 */

import { describe, it, expect, vi } from "vitest";
import { llm, extractJson } from "./llm";
import type { AiBinding } from "./llm";

function mockAi(response: string): AiBinding {
  return { run: vi.fn().mockResolvedValue({ response }) };
}

function mockAiError(error: Error): AiBinding {
  return { run: vi.fn().mockRejectedValue(error) };
}

describe("extractJson", () => {
  it("parses clean JSON", () => {
    expect(extractJson('{"a": 1}')).toEqual({ a: 1 });
  });

  it("extracts from ```json fence", () => {
    const text = 'Here is the result:\n\n```json\n{"a": 1}\n```\n\nHope that helps!';
    expect(extractJson(text)).toEqual({ a: 1 });
  });

  it("extracts from ``` fence without json label", () => {
    const text = '```\n{"a": 1}\n```';
    expect(extractJson(text)).toEqual({ a: 1 });
  });

  it("extracts JSON buried in prose", () => {
    const text = 'Here is the most interesting finding:\n\n{"title": "Test", "type": "article"}';
    expect(extractJson(text)).toEqual({ title: "Test", type: "article" });
  });

  it("handles JSON with nested braces in prose", () => {
    const text = 'Result: {"card": {"title": "Test"}, "nextQuery": "q"}';
    expect(extractJson(text)).toEqual({ card: { title: "Test" }, nextQuery: "q" });
  });

  it("returns null for text with no JSON", () => {
    expect(extractJson("no json here")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(extractJson("")).toBeNull();
  });

  it("returns null for malformed JSON in fence", () => {
    expect(extractJson("```json\n{broken\n```")).toBeNull();
  });

  it("handles the real production failure case", () => {
    const text = `Here's the most interesting finding:

\`\`\`
{
  "card": {
    "title": "Mushrooms in Space",
    "type": "article",
    "summary": "Scientists are exploring mushrooms in space."
  }
}
\`\`\``;
    const result = extractJson(text);
    expect(result).not.toBeNull();
    expect((result as Record<string, unknown>)["card"]).toBeDefined();
  });
});

describe("llm", () => {
  it("parses JSON from AI response", async () => {
    const ai = mockAi('{"query": "quantum computing", "reason": "fascinating"}');

    const result = await llm(
      [{ role: "user", content: "pick a topic" }],
      ai,
    );

    expect(result).toEqual({
      query: "quantum computing",
      reason: "fascinating",
    });
  });

  it("extracts JSON from markdown-wrapped response", async () => {
    const ai = mockAi('Here is the result:\n\n```json\n{"query": "test", "reason": "cool"}\n```');

    const result = await llm(
      [{ role: "user", content: "pick a topic" }],
      ai,
    );

    expect(result).toEqual({ query: "test", reason: "cool" });
  });

  it("extracts JSON from prose-wrapped response", async () => {
    const ai = mockAi('The most interesting finding:\n\n{"query": "test", "reason": "cool"}');

    const result = await llm(
      [{ role: "user", content: "pick a topic" }],
      ai,
    );

    expect(result).toEqual({ query: "test", reason: "cool" });
  });

  it("sends correct request to Workers AI", async () => {
    const ai = mockAi('{"ok": true}');

    const messages = [
      { role: "system" as const, content: "You are helpful." },
      { role: "user" as const, content: "Hello" },
    ];
    await llm(messages, ai);

    expect(ai.run).toHaveBeenCalledOnce();
    expect(ai.run).toHaveBeenCalledWith(
      "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
      {
        messages,
        temperature: 0.9,
        max_tokens: 4096,
        response_format: { type: "json_object" },
      },
    );
  });

  it("throws when AI binding rejects", async () => {
    const ai = mockAiError(new Error("Workers AI unavailable"));

    await expect(
      llm([{ role: "user", content: "test" }], ai),
    ).rejects.toThrow("Workers AI unavailable");
  });

  it("throws when response content is not valid JSON", async () => {
    const ai = mockAi("not json at all");

    await expect(
      llm([{ role: "user", content: "test" }], ai),
    ).rejects.toThrow("LLM returned non-JSON content: not json at all");
  });

  it("throws when response is empty", async () => {
    const ai = { run: vi.fn().mockResolvedValue({ response: "" }) };

    await expect(
      llm([{ role: "user", content: "test" }], ai),
    ).rejects.toThrow("LLM returned empty response");
  });

  it("throws when response is null", async () => {
    const ai = { run: vi.fn().mockResolvedValue({ response: null }) };

    await expect(
      llm([{ role: "user", content: "test" }], ai),
    ).rejects.toThrow("LLM returned empty response");
  });

  it("throws when response object is missing response field", async () => {
    const ai = { run: vi.fn().mockResolvedValue({}) };

    await expect(
      llm([{ role: "user", content: "test" }], ai),
    ).rejects.toThrow("LLM returned empty response");
  });
});
