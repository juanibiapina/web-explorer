import { describe, it, expect } from "vitest";
import { search } from "./search";

describe("search", () => {
  it("returns results from Tavily API", async () => {
    // This test requires TAVILY_API_KEY in the environment.
    // It is skipped in CI if not set.
    const apiKey = process.env.TAVILY_API_KEY;
    if (!apiKey) {
      console.log("Skipping: TAVILY_API_KEY not set");
      return;
    }

    const results = await search("linux kernel", { tavilyKey: apiKey }, 3);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]).toHaveProperty("title");
    expect(results[0]).toHaveProperty("url");
    expect(results[0]).toHaveProperty("content");
  });

  it("returns results from Brave Search API", async () => {
    const apiKey = process.env.BRAVE_API_KEY;
    if (!apiKey) {
      console.log("Skipping: BRAVE_API_KEY not set");
      return;
    }

    const results = await search("linux kernel", { braveKey: apiKey }, 3);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]).toHaveProperty("title");
    expect(results[0]).toHaveProperty("url");
    expect(results[0]).toHaveProperty("content");
  });

  it("throws on invalid Tavily API key", async () => {
    await expect(
      search("test", { tavilyKey: "invalid-key" }, 1)
    ).rejects.toThrow();
  });
});
