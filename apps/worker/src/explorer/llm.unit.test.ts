/**
 * Unit tests for Z.AI LLM client.
 * Mocks fetch — no API key needed.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { llm } from "./llm";

describe("llm", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("parses JSON from LLM response content", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          choices: [
            {
              message: {
                content: '{"query": "quantum computing", "reason": "fascinating"}',
              },
            },
          ],
        }),
    });

    const result = await llm(
      [{ role: "user", content: "pick a topic" }],
      "fake-key"
    );

    expect(result).toEqual({
      query: "quantum computing",
      reason: "fascinating",
    });
  });

  it("sends correct request to Z.AI API", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          choices: [{ message: { content: '{"ok": true}' } }],
        }),
    });
    globalThis.fetch = mockFetch;

    const messages = [
      { role: "system" as const, content: "You are helpful." },
      { role: "user" as const, content: "Hello" },
    ];
    await llm(messages, "my-key");

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe(
      "https://api.z.ai/api/coding/paas/v4/chat/completions"
    );
    expect(options.headers.Authorization).toBe("Bearer my-key");

    const body = JSON.parse(options.body);
    expect(body.model).toBe("glm-4.7-flash");
    expect(body.messages).toEqual(messages);
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.max_tokens).toBe(4096);
  });

  it("throws on non-OK response with status and body", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: () => Promise.resolve("Unauthorized"),
    });

    await expect(
      llm([{ role: "user", content: "test" }], "bad-key")
    ).rejects.toThrow("LLM API error 401: Unauthorized");
  });

  it("throws when response content is not valid JSON", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          choices: [{ message: { content: "not json at all" } }],
        }),
    });

    await expect(
      llm([{ role: "user", content: "test" }], "key")
    ).rejects.toThrow("LLM returned non-JSON content: not json at all");
  });

  it("throws when response has no choices", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ choices: [] }),
    });

    await expect(
      llm([{ role: "user", content: "test" }], "key")
    ).rejects.toThrow("LLM returned no choices");
  });

  it("retries once on finish_reason: length, then throws", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          choices: [
            {
              message: { content: "" },
              finish_reason: "length",
            },
          ],
        }),
    });
    globalThis.fetch = mockFetch;

    await expect(
      llm([{ role: "user", content: "test" }], "key")
    ).rejects.toThrow("empty content (finish_reason: length)");

    // Should have called fetch twice (original + one retry)
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("succeeds on retry when first attempt hits finish_reason: length", async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              choices: [
                { message: { content: "" }, finish_reason: "length" },
              ],
            }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            choices: [
              { message: { content: '{"recovered": true}' } },
            ],
          }),
      });
    });

    const result = await llm(
      [{ role: "user", content: "test" }],
      "key"
    );
    expect(result).toEqual({ recovered: true });
    expect(callCount).toBe(2);
  });

  it("does not retry on finish_reason other than length", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          choices: [
            {
              message: { content: "" },
              finish_reason: "stop",
            },
          ],
        }),
    });
    globalThis.fetch = mockFetch;

    await expect(
      llm([{ role: "user", content: "test" }], "key")
    ).rejects.toThrow("empty content (finish_reason: stop)");

    // Only one call — no retry for non-length reasons
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("throws with finish_reason when content is null", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          choices: [
            {
              message: { content: null },
              finish_reason: "stop",
            },
          ],
        }),
    });
    globalThis.fetch = mockFetch;

    await expect(
      llm([{ role: "user", content: "test" }], "key")
    ).rejects.toThrow("empty content");

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
