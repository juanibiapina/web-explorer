/**
 * Unit tests for the agent module.
 *
 * Tests buildDiversityHint (pure logic, no mocks needed).
 * The runAgentStep function is tested via ExplorationDO integration tests
 * since it depends on the AI SDK and Workers AI provider.
 */

import { describe, it, expect } from "vitest";
import { buildDiversityHint } from "./agent";
import type { Card } from "./types";

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
    const suggestionsMatch = hint.match(/Try finding: (.+)\./);
    expect(suggestionsMatch).not.toBeNull();
    const suggestions = suggestionsMatch![1];
    expect(suggestions).not.toContain("article");
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
});
