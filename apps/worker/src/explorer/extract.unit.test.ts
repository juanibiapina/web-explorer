import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { extract } from "./extract";

const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("extract", () => {
  it("extracts content from urls", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: [
          {
            url: "https://example.com/article",
            raw_content: "This is the article content.",
          },
        ],
        failed_results: [],
      }),
    });

    const { results, failures } = await extract(
      ["https://example.com/article"],
      "test-key"
    );

    expect(results).toHaveLength(1);
    expect(results[0].url).toBe("https://example.com/article");
    expect(results[0].rawContent).toBe("This is the article content.");
    expect(failures).toHaveLength(0);

    expect(mockFetch).toHaveBeenCalledWith("https://api.tavily.com/extract", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: "test-key",
        urls: ["https://example.com/article"],
      }),
    });
  });

  it("returns failures for urls that could not be extracted", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: [
          { url: "https://a.com", raw_content: "Content A" },
        ],
        failed_results: [
          { url: "https://b.com", error: "403 Forbidden" },
        ],
      }),
    });

    const { results, failures } = await extract(
      ["https://a.com", "https://b.com"],
      "test-key"
    );

    expect(results).toHaveLength(1);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toEqual({ url: "https://b.com", error: "403 Forbidden" });
  });

  it("throws on api error", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => "Internal Server Error",
    });

    await expect(extract(["https://example.com"], "key")).rejects.toThrow(
      "Tavily extract API error 500: Internal Server Error"
    );
  });
});
