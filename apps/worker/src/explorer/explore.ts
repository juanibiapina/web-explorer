/**
 * Core exploration logic.
 *
 * Each step: search the web, pick the most interesting result via LLM,
 * emit a structured card, and decide where to explore next.
 */

import { z } from "zod";
import { search } from "./search";
import { llm } from "./llm";
import type { Card, StreamEvent } from "./types";

/**
 * Zod schemas for validating LLM responses.
 * The LLM often returns unexpected shapes. Validation turns silent
 * data corruption into clear, retryable errors.
 */
const SeedResponseSchema = z.object({
  query: z.string(),
  reason: z.string(),
});

const CardSchema = z.object({
  title: z.string(),
  type: z.string(),
  summary: z.string(),
  url: z.string(),
  whyInteresting: z.string(),
  thread: z.object({
    from: z.string(),
    reasoning: z.string(),
  }),
  details: z.record(z.string(), z.unknown()).optional().default({}),
});

const ExploreResponseSchema = z.object({
  card: CardSchema,
  nextQuery: z.string(),
  nextReason: z.string(),
});

const SYSTEM_PROMPT = `You are a curious web explorer. You browse the internet following threads of genuine interest. You're like a fascinating friend who always finds the most interesting corners of the web.

Your job: given search results, pick the MOST interesting finding and create a card about it, then decide what to explore next.

You must respond with valid JSON matching this schema:
{
  "card": {
    "title": "Short, punchy title (max ~60 chars)",
    "type": "article|repo|person|thread|paper|tool|video|community",
    "summary": "2-3 sentences. Write like you're texting a friend about something cool.",
    "url": "URL of the source",
    "whyInteresting": "Why this caught your eye. Specific and genuine.",
    "thread": {
      "from": "Title of previous card, or 'origin' if first",
      "reasoning": "The curiosity thread: how the previous discovery led you here"
    },
    "details": {}
  },
  "nextQuery": "The next web search query. Follow the most interesting thread.",
  "nextReason": "One sentence: why you want to explore this next."
}

The "details" object depends on the card type. Include whatever you can extract:

- article: { "author", "publication", "date", "readingMinutes" }
- repo: { "owner", "name", "description", "language", "stars", "topics" }
- person: { "name", "role", "knownFor", "affiliations" }
- thread: { "platform", "subreddit", "commentCount", "topComment" }
- paper: { "authors", "year", "venue", "abstract" }
- tool: { "name", "tagline", "platform", "pricing", "useCase" }
- video: { "channel", "duration", "platform" }
- community: { "platform", "name", "memberCount", "focus" }

All detail fields are optional. Include what the search results tell you. Skip what you'd have to guess.

Rules:
- Be genuinely curious. Don't pick the most obvious result.
- Follow surprising connections. The best threads come from unexpected links between topics.
- CRITICAL: Your nextQuery must explore a DIFFERENT angle, not the same story again.
- Write like a real person, not a content summarizer.
- Your nextQuery should feel like a natural thought: "Wait, if they did X, what about Y?"

Content diversity:
- The feed must be a mix of content types: articles, GitHub repos, tools, people, discussions, videos, papers, communities.
- Don't default to articles. Actively look for the person behind the project, the tool that enables the technique, the community where practitioners gather, the repo where the code lives.
- Craft nextQuery to surface different content types. Examples:
  - To find repos: include "github", "open source", or "library" in the query.
  - To find people: search for "creator of", "inventor of", "interview with".
  - To find tools: search for "tool for", "app for", "alternative to".
  - To find discussions: include "reddit", "forum", "discussion", "debate".
  - To find videos: include "talk", "conference", "presentation", "documentary".
  - To find papers: include "research paper", "study", "arxiv".
- Think of the feed like a magazine, not a news ticker. A good magazine has profiles, reviews, essays, interviews, and recommendations, not just article after article.`;

const CARD_TYPES = [
  "article",
  "repo",
  "person",
  "thread",
  "paper",
  "tool",
  "video",
  "community",
];

/**
 * Build a diversity hint when recent cards are too same-typed.
 * Returns an empty string when the feed is already varied.
 */
export function buildDiversityHint(previousCards: Card[]): string {
  if (previousCards.length < 2) return "";

  // Check for a streak of the same type at the end
  const lastType = previousCards[previousCards.length - 1].type;
  let streak = 0;
  for (let i = previousCards.length - 1; i >= 0; i--) {
    if (previousCards[i].type === lastType) streak++;
    else break;
  }

  if (streak < 2) return "";

  // Suggest types that haven't appeared recently
  const recentTypes = new Set(previousCards.slice(-5).map((c) => c.type));
  const underrepresented = CARD_TYPES.filter((t) => !recentTypes.has(t));

  const suggestions =
    underrepresented.length > 0
      ? ` Try finding: ${underrepresented.slice(0, 3).join(", ")}.`
      : "";

  return `\n\nDIVERSITY NOTE: The last ${streak} cards have all been "${lastType}" type. Mix it up! Craft your nextQuery to surface a different kind of content.${suggestions}`;
}

interface ExploreKeys {
  tavilyKey: string;
  llmKey: string;
}

export async function pickSeed(keys: ExploreKeys): Promise<{
  query: string;
  reason: string;
}> {
  const result = await llm(
    [
      {
        role: "system",
        content:
          'You are a curious web explorer. Pick a fascinating topic to start exploring. Something surprising, niche, or at the intersection of unexpected fields. Return JSON: {"query": "your search query", "reason": "why this is interesting"}',
      },
      {
        role: "user",
        content: `Today is ${new Date().toISOString().split("T")[0]}. Pick something to explore.`,
      },
    ],
    keys.llmKey
  );

  const parsed = SeedResponseSchema.safeParse(result);
  if (!parsed.success) {
    throw new Error(
      `LLM returned invalid seed response: ${parsed.error.issues.map((i) => i.message).join(", ")}`
    );
  }
  return parsed.data;
}

export async function exploreStep(
  query: string,
  previousCards: Card[],
  stepNum: number,
  keys: ExploreKeys
): Promise<{
  card: Card;
  nextQuery: string;
  nextReason: string;
}> {
  const results = await search(query, keys.tavilyKey);

  if (!results.length) {
    throw new Error(`No search results for "${query}"`);
  }

  const resultsText = results
    .map(
      (r, i) =>
        `[${i + 1}] ${r.title}\n    URL: ${r.url}\n    ${r.content?.slice(0, 500) || "No preview"}`
    )
    .join("\n\n");

  const recentCards = previousCards.slice(-3);
  const contextText = recentCards.length
    ? `\nRecent exploration path:\n${recentCards.map((c) => `> "${c.title}" (${c.type}) - ${c.whyInteresting}`).join("\n")}\n`
    : "";

  const diversityHint = buildDiversityHint(previousCards);

  const result = await llm(
    [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: `Search query: "${query}"${contextText}\nSearch results:\n${resultsText}${diversityHint}\n\nPick the most interesting result, create a card, and tell me where to go next.`,
      },
    ],
    keys.llmKey
  );

  const parsed = ExploreResponseSchema.safeParse(result);
  if (!parsed.success) {
    throw new Error(
      `LLM returned invalid explore response: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", ")}`
    );
  }

  const card: Card = { ...parsed.data.card, id: stepNum };
  return {
    card,
    nextQuery: parsed.data.nextQuery,
    nextReason: parsed.data.nextReason,
  };
}

/**
 * Run a full exploration round, calling `emit` for each event.
 */
export async function exploreRound(
  emit: (event: StreamEvent) => void,
  keys: ExploreKeys,
  maxSteps = 12
): Promise<void> {
  const seed = await pickSeed(keys);
  emit({ event: "seed", data: { query: seed.query, reason: seed.reason } });

  const cards: Card[] = [];
  let query = seed.query;

  for (let step = 1; step <= maxSteps; step++) {
    emit({
      event: "status",
      data: { step, total: maxSteps, query },
    });

    try {
      const { card, nextQuery } = await exploreStep(
        query,
        cards,
        step,
        keys
      );
      cards.push(card);
      emit({ event: "card", data: card });
      query = nextQuery;
    } catch (err) {
      emit({
        event: "error",
        data: { message: err instanceof Error ? err.message : String(err) },
      });
    }
  }

  emit({ event: "done", data: { totalCards: cards.length } });
}
