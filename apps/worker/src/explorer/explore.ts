/**
 * Core exploration logic.
 *
 * Each step: search the web, pick the most interesting result via LLM,
 * emit a structured card, and decide where to explore next.
 */

import { search } from "./search";
import { llm } from "./llm";
import type { Card, StreamEvent } from "./types";

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
- Vary your card types. Don't just pick articles.
- CRITICAL: Your nextQuery must explore a DIFFERENT angle, not the same story again.
- Write like a real person, not a content summarizer.
- Your nextQuery should feel like a natural thought: "Wait, if they did X, what about Y?"`;

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
  return result as { query: string; reason: string };
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

  const result = await llm(
    [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: `Search query: "${query}"${contextText}\nSearch results:\n${resultsText}\n\nPick the most interesting result, create a card, and tell me where to go next.`,
      },
    ],
    keys.llmKey
  );

  const card = (result as { card: Card }).card;
  card.id = stepNum;

  return {
    card,
    nextQuery: (result as { nextQuery: string }).nextQuery,
    nextReason: (result as { nextReason: string }).nextReason,
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
