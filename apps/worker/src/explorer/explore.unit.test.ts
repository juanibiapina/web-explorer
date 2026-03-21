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

import { pickSeed, exploreStep, exploreRound } from "./explore";
import { search } from "./search";
import { llm } from "./llm";
import type { Card, StreamEvent } from "./types";

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
});

describe("exploreRound", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("emits seed, status, card, and done events", async () => {
    mockLlm
      .mockResolvedValueOnce({ query: "starting topic", reason: "curious" })
      .mockResolvedValue({
        card: makeCard(),
        nextQuery: "next thing",
        nextReason: "following the thread",
      });

    mockSearch.mockResolvedValue([
      { title: "Result", url: "https://r.com", content: "Content" },
    ]);

    const events: StreamEvent[] = [];
    await exploreRound((e) => events.push(e), KEYS, 2);

    const types = events.map((e) => e.event);
    expect(types[0]).toBe("seed");
    expect(types).toContain("status");
    expect(types).toContain("card");
    expect(types[types.length - 1]).toBe("done");
  });

  it("runs the specified number of steps", async () => {
    mockLlm
      .mockResolvedValueOnce({ query: "seed", reason: "start" })
      .mockResolvedValue({
        card: makeCard(),
        nextQuery: "next",
        nextReason: "reason",
      });

    mockSearch.mockResolvedValue([
      { title: "R", url: "https://r.com", content: "C" },
    ]);

    const events: StreamEvent[] = [];
    await exploreRound((e) => events.push(e), KEYS, 4);

    const cardEvents = events.filter((e) => e.event === "card");
    expect(cardEvents).toHaveLength(4);

    const doneEvent = events.find((e) => e.event === "done");
    expect(doneEvent?.data).toEqual({ totalCards: 4 });
  });

  it("emits error event on step failure but continues", async () => {
    mockLlm
      .mockResolvedValueOnce({ query: "seed", reason: "start" })
      .mockRejectedValueOnce(new Error("API timeout"))
      .mockResolvedValue({
        card: makeCard(),
        nextQuery: "next",
        nextReason: "reason",
      });

    mockSearch.mockResolvedValue([
      { title: "R", url: "https://r.com", content: "C" },
    ]);

    const events: StreamEvent[] = [];
    await exploreRound((e) => events.push(e), KEYS, 3);

    const errorEvents = events.filter((e) => e.event === "error");
    expect(errorEvents).toHaveLength(1);
    expect(errorEvents[0].data).toEqual({ message: "API timeout" });

    // Should still complete all steps (2 cards + 1 error = 3 steps)
    const doneEvent = events.find((e) => e.event === "done");
    expect(doneEvent).toBeDefined();
  });
});
