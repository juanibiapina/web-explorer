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

  it("extracts JSON wrapped in markdown code fences", async () => {
    const ai = mockAi('```json\n{"query": "robots", "reason": "cool"}\n```');

    const result = await llm(
      [{ role: "user", content: "pick a topic" }],
      ai,
    );

    expect(result).toEqual({ query: "robots", reason: "cool" });
  });

  it("extracts JSON wrapped in plain code fences", async () => {
    const ai = mockAi('```\n{"query": "robots"}\n```');

    const result = await llm(
      [{ role: "user", content: "pick a topic" }],
      ai,
    );

    expect(result).toEqual({ query: "robots" });
  });

  it("extracts JSON with surrounding text", async () => {
    const ai = mockAi('Here is the result:\n{"query": "robots"}\nDone.');

    const result = await llm(
      [{ role: "user", content: "pick a topic" }],
      ai,
    );

    expect(result).toEqual({ query: "robots" });
  });
});

describe("extractJson", () => {
  it("parses clean JSON directly", () => {
    expect(extractJson('{"a": 1}')).toEqual({ a: 1 });
  });

  it("extracts from ```json fence", () => {
    expect(extractJson('```json\n{"a": 1}\n```')).toEqual({ a: 1 });
  });

  it("extracts from plain ``` fence", () => {
    expect(extractJson('```\n{"a": 1}\n```')).toEqual({ a: 1 });
  });

  it("extracts from outermost braces", () => {
    expect(extractJson('Here: {"a": 1} done')).toEqual({ a: 1 });
  });

  it("handles nested braces correctly", () => {
    expect(extractJson('Result: {"a": {"b": 2}} end')).toEqual({ a: { b: 2 } });
  });

  it("returns null for non-JSON text", () => {
    expect(extractJson("no json here")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(extractJson("")).toBeNull();
  });

  it("returns null for malformed JSON in fences", () => {
    expect(extractJson("```json\n{broken\n```")).toBeNull();
  });

  it("handles real Workers AI response format", () => {
    const response = '```json\n{\n  "card": {\n    "title": "Test",\n    "type": "article"\n  }\n}\n```';
    const result = extractJson(response);
    expect(result).toEqual({ card: { title: "Test", type: "article" } });
  });
});
