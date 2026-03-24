/**
 * Unit tests for Tavily search client.
 * Mocks fetch — no API key needed.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { search } from "./search";

describe("search", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("parses Tavily response into SearchResponse", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          results: [
            {
              title: "Linux Kernel",
              url: "https://kernel.org",
              content: "The main kernel site",
              score: 0.95,
              extra_field: "ignored",
            },
            {
              title: "Kernel Docs",
              url: "https://docs.kernel.org",
              content: "Documentation",
              score: 0.8,
            },
          ],
          images: [
            "https://example.com/tux.png",
            { url: "https://example.com/kernel.jpg" },
          ],
        }),
    });

    const response = await search("linux kernel", "fake-key", 5);

    expect(response.results).toEqual([
      {
        title: "Linux Kernel",
        url: "https://kernel.org",
        content: "The main kernel site",
      },
      {
        title: "Kernel Docs",
        url: "https://docs.kernel.org",
        content: "Documentation",
      },
    ]);
    expect(response.images).toEqual([
      "https://example.com/tux.png",
      "https://example.com/kernel.jpg",
    ]);
  });

  it("sends correct request to Tavily API", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ results: [], images: [] }),
    });
    globalThis.fetch = mockFetch;

    await search("test query", "my-api-key", 3);

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.tavily.com/search");
    expect(options.method).toBe("POST");

    const body = JSON.parse(options.body);
    expect(body.api_key).toBe("my-api-key");
    expect(body.query).toBe("test query");
    expect(body.max_results).toBe(3);
    expect(body.include_raw_content).toBe(false);
    expect(body.include_images).toBe(true);
  });

  it("defaults to 8 results", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ results: [], images: [] }),
    });
    globalThis.fetch = mockFetch;

    await search("test", "key");

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.max_results).toBe(8);
  });

  it("throws on non-OK response with status and body", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      text: () => Promise.resolve("Rate limit exceeded"),
    });

    await expect(search("test", "key")).rejects.toThrow(
      "Tavily API error 429: Rate limit exceeded"
    );
  });

  it("returns empty results and images when API returns none", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ results: [], images: [] }),
    });

    const response = await search("obscure query", "key");
    expect(response.results).toEqual([]);
    expect(response.images).toEqual([]);
  });

  it("handles missing images field gracefully", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          results: [{ title: "Test", url: "https://test.com", content: "x" }],
        }),
    });

    const response = await search("test", "key");
    expect(response.results).toHaveLength(1);
    expect(response.images).toEqual([]);
  });
});
