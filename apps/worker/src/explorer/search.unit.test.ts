/**
 * Unit tests for web search with provider fallback.
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

  describe("tavily provider", () => {
    it("parses Tavily response into SearchResult array", async () => {
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
          }),
      });

      const results = await search("linux kernel", { tavilyKey: "fake-key" }, 5);

      expect(results).toEqual([
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
    });

    it("sends correct request to Tavily API", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ results: [] }),
      });
      globalThis.fetch = mockFetch;

      await search("test query", { tavilyKey: "my-api-key" }, 3);

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe("https://api.tavily.com/search");
      expect(options.method).toBe("POST");

      const body = JSON.parse(options.body);
      expect(body.api_key).toBe("my-api-key");
      expect(body.query).toBe("test query");
      expect(body.max_results).toBe(3);
      expect(body.include_raw_content).toBe(false);
    });

    it("defaults to 8 results", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ results: [] }),
      });
      globalThis.fetch = mockFetch;

      await search("test", { tavilyKey: "key" });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.max_results).toBe(8);
    });

    it("throws on non-OK response with status and body", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve("Internal Server Error"),
      });

      await expect(search("test", { tavilyKey: "key" })).rejects.toThrow(
        "Tavily API error 500: Internal Server Error"
      );
    });

    it("returns empty array when API returns no results", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ results: [] }),
      });

      const results = await search("obscure query", { tavilyKey: "key" });
      expect(results).toEqual([]);
    });
  });

  describe("brave provider", () => {
    it("parses Brave response into SearchResult array", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            web: {
              results: [
                {
                  title: "Linux Kernel",
                  url: "https://kernel.org",
                  description: "The main kernel site",
                },
                {
                  title: "Kernel Docs",
                  url: "https://docs.kernel.org",
                  description: "Documentation",
                  extra_snippets: ["More info about docs"],
                },
              ],
            },
          }),
      });

      const results = await search("linux kernel", { braveKey: "fake-key" }, 5);

      expect(results).toEqual([
        {
          title: "Linux Kernel",
          url: "https://kernel.org",
          content: "The main kernel site",
        },
        {
          title: "Kernel Docs",
          url: "https://docs.kernel.org",
          content: "Documentation\nMore info about docs",
        },
      ]);
    });

    it("sends correct request to Brave API", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ web: { results: [] } }),
      });
      globalThis.fetch = mockFetch;

      await search("test query", { braveKey: "brave-key" }, 3);

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toContain("https://api.search.brave.com/res/v1/web/search");
      expect(url).toContain("q=test+query");
      expect(url).toContain("count=3");
      expect(options.headers["X-Subscription-Token"]).toBe("brave-key");
    });

    it("returns empty array when web results are missing", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
      });

      const results = await search("test", { braveKey: "key" });
      expect(results).toEqual([]);
    });

    it("throws on non-OK response", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 422,
        text: () => Promise.resolve("Invalid token"),
      });

      await expect(search("test", { braveKey: "bad-key" })).rejects.toThrow(
        "Brave Search API error 422: Invalid token"
      );
    });
  });

  describe("fallback behavior", () => {
    it("falls back to Brave on Tavily quota error (432)", async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: false,
          status: 432,
          text: () => Promise.resolve("usage limit exceeded"),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              web: {
                results: [
                  {
                    title: "Brave Result",
                    url: "https://brave.com",
                    description: "Found via Brave",
                  },
                ],
              },
            }),
        });
      globalThis.fetch = mockFetch;

      const results = await search(
        "test",
        { tavilyKey: "tavily", braveKey: "brave" }
      );

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(results[0].title).toBe("Brave Result");
    });

    it("falls back to Brave on Tavily rate limit (429)", async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          text: () => Promise.resolve("rate limit"),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              web: {
                results: [
                  {
                    title: "Brave Result",
                    url: "https://brave.com",
                    description: "Fallback",
                  },
                ],
              },
            }),
        });
      globalThis.fetch = mockFetch;

      const results = await search(
        "test",
        { tavilyKey: "tavily", braveKey: "brave" }
      );

      expect(results[0].title).toBe("Brave Result");
    });

    it("does not fall back on non-quota Tavily errors", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve("Internal Server Error"),
      });

      await expect(
        search("test", { tavilyKey: "tavily", braveKey: "brave" })
      ).rejects.toThrow("Tavily API error 500");
    });

    it("throws when the only configured provider fails", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 432,
        text: () => Promise.resolve("usage limit"),
      });

      await expect(
        search("test", { tavilyKey: "tavily" })
      ).rejects.toThrow("Tavily API error 432");
    });

    it("throws when no keys are configured", async () => {
      await expect(search("test", {})).rejects.toThrow(
        "No search API keys configured"
      );
    });

    it("uses Tavily first when both keys are present", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            results: [
              {
                title: "Tavily Result",
                url: "https://tavily.com",
                content: "From Tavily",
              },
            ],
          }),
      });
      globalThis.fetch = mockFetch;

      const results = await search(
        "test",
        { tavilyKey: "tavily", braveKey: "brave" }
      );

      expect(mockFetch).toHaveBeenCalledOnce();
      expect(results[0].title).toBe("Tavily Result");
    });
  });
});
