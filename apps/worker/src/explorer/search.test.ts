import { describe, it, expect } from "vitest";
import { search } from "./search";

describe("search", () => {
  it("returns results and images from Tavily API", async () => {
    // This test requires TAVILY_API_KEY in the environment.
    // It is skipped in CI if not set.
    const apiKey = process.env.TAVILY_API_KEY;
    if (!apiKey) {
      console.log("Skipping: TAVILY_API_KEY not set");
      return;
    }

    const response = await search("linux kernel", apiKey, 3);
    expect(response.results.length).toBeGreaterThan(0);
    expect(response.results[0]).toHaveProperty("title");
    expect(response.results[0]).toHaveProperty("url");
    expect(response.results[0]).toHaveProperty("content");
    expect(Array.isArray(response.images)).toBe(true);
  });

  it("throws on invalid API key", async () => {
    await expect(search("test", "invalid-key", 1)).rejects.toThrow();
  });
});
