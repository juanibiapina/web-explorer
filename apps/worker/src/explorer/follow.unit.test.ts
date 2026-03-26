/**
 * Unit tests for link-following exploration logic.
 * Mocks extract and llm modules — no API keys or external calls needed.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./extract", () => ({
  extract: vi.fn(),
}));

vi.mock("./llm", () => ({
  llm: vi.fn(),
}));

import { followStep, pickLink } from "./follow";
import { extract } from "./extract";
import { llm } from "./llm";
import type { AiBinding } from "./llm";

const mockExtract = vi.mocked(extract);
const mockLlm = vi.mocked(llm);

const fakeAi = { run: vi.fn() } as unknown as AiBinding;
const keys = { tavilyKey: "tavily-key", ai: fakeAi };

const validFollowResponse = {
  card: {
    title: "The Secret Life of Airports",
    type: "article",
    summary:
      "Airports are designed with hidden psychological tricks to make you spend money.",
    url: "https://example.com/page",
    whyInteresting: "The carpet patterns are actually wayfinding tools.",
    thread: {
      from: "origin",
      reasoning: "Started exploring urban design and found this gem.",
    },
    details: { author: "Jane Smith", publication: "Wired" },
  },
  follow: {
    type: "url" as const,
    value: "https://en.wikipedia.org/wiki/Mehran_Karimi_Nasseri",
    reasoning:
      "The article mentions a man who lived in an airport for 18 years. That's wild.",
  },
};

describe("followStep", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("extracts page content and creates card with next follow target", async () => {
    mockExtract.mockResolvedValue({
      results: [{ url: "https://example.com/page", rawContent: "Airport design involves many hidden tricks..." }],
      failures: [],
    });
    mockLlm.mockResolvedValue(validFollowResponse);

    const result = await followStep(
      "https://example.com/page",
      [],
      1,
      keys,
    );

    expect(result.card.title).toBe("The Secret Life of Airports");
    expect(result.card.type).toBe("article");
    expect(result.card.id).toBe(1);
    expect(result.follow.type).toBe("url");
    expect(result.follow.value).toBe(
      "https://en.wikipedia.org/wiki/Mehran_Karimi_Nasseri",
    );
  });

  it("includes previous cards as context in LLM prompt", async () => {
    const previousCards = [
      {
        id: 1,
        title: "Card One",
        type: "article",
        summary: "Summary one",
        url: "https://a.com",
        whyInteresting: "Reason one",
        thread: { from: "origin", reasoning: "First" },
        details: {},
      },
    ];

    mockExtract.mockResolvedValue({
      results: [{ url: "https://example.com/page", rawContent: "Some page content" }],
      failures: [],
    });
    mockLlm.mockResolvedValue(validFollowResponse);

    await followStep("https://example.com/page", previousCards, 2, keys);

    const userMessage = mockLlm.mock.calls[0][0].find(
      (m) => m.role === "user",
    );
    expect(userMessage?.content).toContain("Card One");
    expect(userMessage?.content).toContain("Exploration path so far");
  });

  it("supports search fallback in follow target", async () => {
    const searchFallback = {
      ...validFollowResponse,
      follow: {
        type: "search",
        value: "Mehran Karimi Nasseri airport terminal life",
        reasoning: "The page mentions him but doesn't link to anything.",
      },
    };

    mockExtract.mockResolvedValue({
      results: [{ url: "https://example.com/page", rawContent: "Content mentioning Nasseri" }],
      failures: [],
    });
    mockLlm.mockResolvedValue(searchFallback);

    const result = await followStep(
      "https://example.com/page",
      [],
      1,
      keys,
    );

    expect(result.follow.type).toBe("search");
    expect(result.follow.value).toContain("Mehran Karimi Nasseri");
  });

  it("throws when extraction fails", async () => {
    mockExtract.mockResolvedValue({
      results: [],
      failures: [{ url: "https://example.com/page", error: "403 Forbidden" }],
    });

    await expect(
      followStep("https://example.com/page", [], 1, keys),
    ).rejects.toThrow("Failed to extract content from https://example.com/page: 403 Forbidden");
  });

  it("truncates long page content", async () => {
    const longContent = "x".repeat(10000);

    mockExtract.mockResolvedValue({
      results: [{ url: "https://example.com/page", rawContent: longContent }],
      failures: [],
    });
    mockLlm.mockResolvedValue(validFollowResponse);

    await followStep("https://example.com/page", [], 1, keys);

    const userMessage = mockLlm.mock.calls[0][0].find(
      (m) => m.role === "user",
    );
    expect(userMessage?.content).toContain("[content truncated]");
    expect(userMessage!.content.length).toBeLessThan(9000);
  });

  it("throws on invalid llm response", async () => {
    mockExtract.mockResolvedValue({
      results: [{ url: "https://example.com/page", rawContent: "Content" }],
      failures: [],
    });
    mockLlm.mockResolvedValue({ card: { title: "Missing fields" } });

    await expect(
      followStep("https://example.com/page", [], 1, keys),
    ).rejects.toThrow("LLM returned invalid follow response");
  });
});

describe("pickLink", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("extracts page and picks an interesting link", async () => {
    mockExtract.mockResolvedValue({
      results: [{ url: "https://example.com/airports", rawContent: "Page about airports mentioning stateless people..." }],
      failures: [],
    });
    mockLlm.mockResolvedValue({
      type: "url",
      value: "https://en.wikipedia.org/wiki/Statelessness",
      reasoning: "The article mentions stateless people in airports.",
    });

    const result = await pickLink("https://example.com/airports", [], keys);

    expect(result.type).toBe("url");
    expect(result.value).toBe(
      "https://en.wikipedia.org/wiki/Statelessness",
    );
    expect(result.reasoning).toContain("stateless");
  });

  it("supports search fallback", async () => {
    mockExtract.mockResolvedValue({
      results: [{ url: "https://example.com/science", rawContent: "Content about science" }],
      failures: [],
    });
    mockLlm.mockResolvedValue({
      type: "search",
      value: "cargo cult science Feynman",
      reasoning: "The page mentions Feynman's speech but doesn't link to it.",
    });

    const result = await pickLink("https://example.com/science", [], keys);

    expect(result.type).toBe("search");
    expect(result.value).toContain("Feynman");
  });

  it("throws when extraction fails", async () => {
    mockExtract.mockResolvedValue({
      results: [],
      failures: [{ url: "https://example.com", error: "Timeout" }],
    });

    await expect(
      pickLink("https://example.com", [], keys),
    ).rejects.toThrow("Failed to extract content from https://example.com: Timeout");
  });
});
