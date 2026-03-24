/**
 * Unit tests for exploration logic.
 * Mocks search and llm modules — no API keys needed.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./search", () => ({
  search: vi.fn(),
}));

vi.mock("./llm", () => ({
  llm: vi.fn(),
}));

import { pickSeed, exploreStep, buildDiversityHint } from "./explore";
import { search } from "./search";
import { llm } from "./llm";
import type { Card } from "./types";

const mockSearch = vi.mocked(search);
const mockLlm = vi.mocked(llm);

const KEYS = { tavilyKey: "fake-tavily", llmKey: "fake-llm" };

function makeCard(overrides: Partial<Card> = {}): Card {
  return {
    id: 1,
    title: "Test Card",
    type: "article",
    summary: "A test card",
    url: "https://example.com",
    whyInteresting: "It's interesting",
    thread: { from: "origin", reasoning: "Starting fresh" },
    details: {},
    ...overrides,
  };
}

describe("pickSeed", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns query and reason from LLM", async () => {
    mockLlm.mockResolvedValue({
      query: "bioluminescent organisms",
      reason: "Nature's own light show",
    });

    const seed = await pickSeed(KEYS);

    expect(seed.query).toBe("bioluminescent organisms");
    expect(seed.reason).toBe("Nature's own light show");
  });

  it("passes the LLM key to the llm function", async () => {
    mockLlm.mockResolvedValue({ query: "test", reason: "test" });

    await pickSeed(KEYS);

    expect(mockLlm).toHaveBeenCalledWith(
      expect.any(Array),
      "fake-llm"
    );
  });

  it("throws on invalid LLM response shape", async () => {
    mockLlm.mockResolvedValue({ something: "wrong" });

    await expect(pickSeed(KEYS)).rejects.toThrow(
      "LLM returned invalid seed response"
    );
  });

  it("throws when LLM returns non-string query", async () => {
    mockLlm.mockResolvedValue({ query: 42, reason: "test" });

    await expect(pickSeed(KEYS)).rejects.toThrow(
      "LLM returned invalid seed response"
    );
  });
});

describe("exploreStep", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("searches, calls LLM, and returns card with next query", async () => {
    mockSearch.mockResolvedValue([
      {
        title: "Deep sea creatures",
        url: "https://ocean.org/creatures",
        content: "Fascinating organisms live in the deep ocean",
      },
    ]);

    const card = makeCard({
      title: "Anglerfish Lures",
      type: "article",
      url: "https://ocean.org/creatures",
    });

    mockLlm.mockResolvedValue({
      card,
      nextQuery: "anglerfish bioluminescence mechanism",
      nextReason: "How do they actually produce light?",
    });

    const result = await exploreStep("deep sea creatures", [], 1, KEYS);

    expect(result.card.title).toBe("Anglerfish Lures");
    expect(result.card.id).toBe(1);
    expect(result.nextQuery).toBe("anglerfish bioluminescence mechanism");
  });

  it("passes search results to LLM prompt", async () => {
    mockSearch.mockResolvedValue([
      { title: "Result A", url: "https://a.com", content: "Content A" },
      { title: "Result B", url: "https://b.com", content: "Content B" },
    ]);

    mockLlm.mockResolvedValue({
      card: makeCard(),
      nextQuery: "next",
      nextReason: "reason",
    });

    await exploreStep("test query", [], 1, KEYS);

    const llmCall = mockLlm.mock.calls[0];
    const userMessage = llmCall[0].find((m) => m.role === "user");
    expect(userMessage?.content).toContain("Result A");
    expect(userMessage?.content).toContain("Result B");
    expect(userMessage?.content).toContain("test query");
  });

  it("includes recent card context in LLM prompt", async () => {
    mockSearch.mockResolvedValue([
      { title: "Result", url: "https://r.com", content: "Content" },
    ]);

    mockLlm.mockResolvedValue({
      card: makeCard(),
      nextQuery: "next",
      nextReason: "reason",
    });

    const previousCards = [
      makeCard({ title: "Card One", type: "repo", whyInteresting: "Cool repo" }),
      makeCard({ title: "Card Two", type: "thread", whyInteresting: "Hot thread" }),
    ];

    await exploreStep("follow up", previousCards, 3, KEYS);

    const userMessage = mockLlm.mock.calls[0][0].find(
      (m) => m.role === "user"
    );
    expect(userMessage?.content).toContain("Card One");
    expect(userMessage?.content).toContain("Card Two");
  });

  it("sets card id from step number", async () => {
    mockSearch.mockResolvedValue([
      { title: "R", url: "https://r.com", content: "C" },
    ]);

    mockLlm.mockResolvedValue({
      card: makeCard({ id: 999 }),
      nextQuery: "next",
      nextReason: "reason",
    });

    const result = await exploreStep("query", [], 7, KEYS);
    expect(result.card.id).toBe(7);
  });

  it("throws when search returns no results", async () => {
    mockSearch.mockResolvedValue([]);

    await expect(
      exploreStep("empty query", [], 1, KEYS)
    ).rejects.toThrow('No search results for "empty query"');
  });

  it("passes tavily key to search and llm key to llm", async () => {
    mockSearch.mockResolvedValue([
      { title: "R", url: "https://r.com", content: "C" },
    ]);

    mockLlm.mockResolvedValue({
      card: makeCard(),
      nextQuery: "next",
      nextReason: "reason",
    });

    await exploreStep("query", [], 1, KEYS);

    expect(mockSearch).toHaveBeenCalledWith("query", "fake-tavily");
    expect(mockLlm).toHaveBeenCalledWith(expect.any(Array), "fake-llm");
  });

  it("throws when LLM returns response without card", async () => {
    mockSearch.mockResolvedValue([
      { title: "R", url: "https://r.com", content: "C" },
    ]);

    mockLlm.mockResolvedValue({
      nextQuery: "next",
      nextReason: "reason",
    });

    await expect(
      exploreStep("query", [], 1, KEYS)
    ).rejects.toThrow("LLM returned invalid explore response");
  });

  it("throws when LLM returns card missing required fields", async () => {
    mockSearch.mockResolvedValue([
      { title: "R", url: "https://r.com", content: "C" },
    ]);

    mockLlm.mockResolvedValue({
      card: { title: "Incomplete" },
      nextQuery: "next",
      nextReason: "reason",
    });

    await expect(
      exploreStep("query", [], 1, KEYS)
    ).rejects.toThrow("LLM returned invalid explore response");
  });

  it("defaults details to empty object when LLM omits it", async () => {
    mockSearch.mockResolvedValue([
      { title: "R", url: "https://r.com", content: "C" },
    ]);

    const cardWithoutDetails = {
      title: "Test",
      type: "article",
      summary: "Summary",
      url: "https://example.com",
      whyInteresting: "Why",
      thread: { from: "origin", reasoning: "Starting" },
      // no details field
    };

    mockLlm.mockResolvedValue({
      card: cardWithoutDetails,
      nextQuery: "next",
      nextReason: "reason",
    });

    const result = await exploreStep("query", [], 1, KEYS);
    expect(result.card.details).toEqual({});
  });
});

describe("buildDiversityHint", () => {
  it("returns empty string when fewer than 2 cards", () => {
    expect(buildDiversityHint([])).toBe("");
    expect(buildDiversityHint([makeCard()])).toBe("");
  });

  it("returns empty string when recent types are varied", () => {
    const cards = [
      makeCard({ type: "article" }),
      makeCard({ type: "repo" }),
      makeCard({ type: "person" }),
    ];
    expect(buildDiversityHint(cards)).toBe("");
  });

  it("returns a hint when same type appears 2+ times consecutively", () => {
    const cards = [
      makeCard({ type: "article" }),
      makeCard({ type: "article" }),
    ];
    const hint = buildDiversityHint(cards);
    expect(hint).toContain("DIVERSITY NOTE");
    expect(hint).toContain('"article"');
    expect(hint).toContain("2");
  });

  it("counts the full streak length", () => {
    const cards = [
      makeCard({ type: "repo" }),
      makeCard({ type: "article" }),
      makeCard({ type: "article" }),
      makeCard({ type: "article" }),
    ];
    const hint = buildDiversityHint(cards);
    expect(hint).toContain("3 cards");
  });

  it("suggests underrepresented types", () => {
    const cards = [
      makeCard({ type: "article" }),
      makeCard({ type: "article" }),
    ];
    const hint = buildDiversityHint(cards);
    expect(hint).toContain("Try finding:");
    // The suggestions should not include the overrepresented type
    const suggestionsMatch = hint.match(/Try finding: (.+)\./);
    expect(suggestionsMatch).not.toBeNull();
    const suggestions = suggestionsMatch![1];
    expect(suggestions).not.toContain("article");
    // Should suggest some valid card types
    expect(suggestions).toMatch(/repo|person|thread|paper|tool|video|community/);
  });

  it("does not trigger when streak is broken", () => {
    const cards = [
      makeCard({ type: "article" }),
      makeCard({ type: "article" }),
      makeCard({ type: "repo" }),
    ];
    expect(buildDiversityHint(cards)).toBe("");
  });

  it("includes diversity hint in LLM prompt when types repeat", async () => {
    vi.restoreAllMocks();
    mockSearch.mockResolvedValue([
      { title: "R", url: "https://r.com", content: "C" },
    ]);

    mockLlm.mockResolvedValue({
      card: makeCard(),
      nextQuery: "next",
      nextReason: "reason",
    });

    const previousCards = [
      makeCard({ type: "article" }),
      makeCard({ type: "article" }),
      makeCard({ type: "article" }),
    ];

    await exploreStep("query", previousCards, 4, KEYS);

    const userMessage = mockLlm.mock.calls[0][0].find(
      (m: { role: string }) => m.role === "user"
    );
    expect(userMessage?.content).toContain("DIVERSITY NOTE");
  });

  it("does not include diversity hint when types are varied", async () => {
    vi.restoreAllMocks();
    mockSearch.mockResolvedValue([
      { title: "R", url: "https://r.com", content: "C" },
    ]);

    mockLlm.mockResolvedValue({
      card: makeCard(),
      nextQuery: "next",
      nextReason: "reason",
    });

    const previousCards = [
      makeCard({ type: "article" }),
      makeCard({ type: "repo" }),
      makeCard({ type: "person" }),
    ];

    await exploreStep("query", previousCards, 4, KEYS);

    const userMessage = mockLlm.mock.calls[0][0].find(
      (m: { role: string }) => m.role === "user"
    );
    expect(userMessage?.content).not.toContain("DIVERSITY NOTE");
  });
});
