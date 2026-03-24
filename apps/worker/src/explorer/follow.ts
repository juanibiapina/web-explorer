/**
 * Link-following exploration logic.
 *
 * Instead of searching for every step, this mode follows links and
 * references found in the content of the previous card's source page.
 * Only the first step uses a web search. Subsequent steps extract the
 * previous card's URL, read the full page, and have the LLM pick the
 * most interesting outgoing link or reference to follow next.
 *
 * The goal: wilder topic jumps between cards. Start on airport architecture,
 * end up on Cold War espionage. Each card should be as different as possible
 * from the last, connected by a single thin thread of curiosity.
 */

import { z } from "zod";
import { extract } from "./extract";
import { llm } from "./llm";
import type { Card } from "./types";

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

const FollowTargetSchema = z.object({
  type: z.enum(["url", "search"]),
  value: z.string(),
  reasoning: z.string(),
});

const FollowResponseSchema = z.object({
  card: CardSchema,
  follow: FollowTargetSchema,
});

export type FollowTarget = z.infer<typeof FollowTargetSchema>;

/**
 * System prompt for the follow step. Emphasizes wild topic jumps and
 * finding the most unexpected tangent in the page content.
 */
const FOLLOW_SYSTEM_PROMPT = `You are a curious web explorer with a short attention span and wide interests. You're reading a web page and your job is to:

1. Create a card about this page (what makes it interesting).
2. Find the most unexpected link, reference, or tangent in the content and follow it.

The CRITICAL rule: each card should be as DIFFERENT as possible from the previous one. You want wild jumps. If the last card was about architecture, don't follow another architecture link. Follow the footnote about a person, the aside about a historical event, the tool mentioned in passing. The thinner the thread connecting two cards, the better. That's what makes rabbit holes addictive.

You must respond with valid JSON:
{
  "card": {
    "title": "Short, punchy title (max ~60 chars)",
    "type": "article|repo|person|thread|paper|tool|video|community",
    "summary": "2-3 sentences. Write like you're texting a friend about something cool.",
    "url": "URL of this page",
    "whyInteresting": "Why this caught your eye. Specific and genuine.",
    "thread": {
      "from": "Title of previous card",
      "reasoning": "The curiosity thread: how the previous discovery led you here"
    },
    "details": {}
  },
  "follow": {
    "type": "url" or "search",
    "value": "https://..." or "a search query",
    "reasoning": "Why this tangent is irresistible. What rabbit hole might it open?"
  }
}

For "follow":
- Prefer "url" when you find an actual link in the content (a hyperlink, a referenced URL, a GitHub repo, a Wikipedia article).
- Use "search" as fallback when the page mentions something fascinating but doesn't link to it directly (a person's name, a concept, an event).
- The follow target should take us in a COMPLETELY DIFFERENT direction from the current page.

The "details" object depends on the card type:
- article: { "author", "publication", "date", "readingMinutes" }
- repo: { "owner", "name", "description", "language", "stars", "topics" }
- person: { "name", "role", "knownFor", "affiliations" }
- thread: { "platform", "subreddit", "commentCount", "topComment" }
- paper: { "authors", "year", "venue", "abstract" }
- tool: { "name", "tagline", "platform", "pricing", "useCase" }
- video: { "channel", "duration", "platform" }
- community: { "platform", "name", "memberCount", "focus" }

All detail fields are optional. Include what the page tells you. Skip what you'd have to guess.

Rules:
- Never follow the same topic twice. Check the exploration path.
- The best follow is the one that surprises even you.
- Write like a real person, not a content summarizer.`;

export interface FollowKeys {
  tavilyKey: string;
  llmKey: string;
}

/**
 * Follow a URL: extract its content and create a card + pick next link.
 *
 * This is the core step for the link-following mode. It:
 * 1. Extracts the page content using Tavily extract
 * 2. Asks the LLM to create a card and pick the next link to follow
 * 3. Returns the card and the next target (URL or search query)
 */
export async function followStep(
  targetUrl: string,
  previousCards: Card[],
  stepNum: number,
  keys: FollowKeys
): Promise<{
  card: Card;
  follow: { type: "url" | "search"; value: string; reasoning: string };
}> {
  const { results, failures } = await extract([targetUrl], keys.tavilyKey);

  if (results.length === 0) {
    const reason = failures.length > 0 ? failures[0].error : "unknown error";
    throw new Error(
      `Failed to extract content from ${targetUrl}: ${reason}`
    );
  }

  const pageContent = results[0].rawContent;

  // Truncate to ~8000 chars to stay within token limits
  const truncated =
    pageContent.length > 8000
      ? pageContent.slice(0, 8000) + "\n\n[content truncated]"
      : pageContent;

  const recentCards = previousCards.slice(-3);
  const pathText = recentCards.length
    ? `\nExploration path so far:\n${recentCards.map((c) => `> "${c.title}" (${c.type}) — ${c.whyInteresting}`).join("\n")}\n`
    : "";

  const result = await llm(
    [
      { role: "system", content: FOLLOW_SYSTEM_PROMPT },
      {
        role: "user",
        content: `Page URL: ${targetUrl}\n\nPage content:\n${truncated}${pathText}\nCreate a card about this page and pick the most surprising tangent to follow next.`,
      },
    ],
    keys.llmKey
  );

  const parsed = FollowResponseSchema.safeParse(result);
  if (!parsed.success) {
    throw new Error(
      `LLM returned invalid follow response: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", ")}`
    );
  }

  const card: Card = { ...parsed.data.card, id: stepNum };
  return { card, follow: parsed.data.follow };
}

/**
 * Pick the most interesting link from a page's content.
 *
 * Used to bridge between a search-based first step and the follow chain.
 * Extracts the source page, has the LLM read it, and picks the most
 * surprising outgoing link or reference to follow.
 */

const PICK_LINK_PROMPT = `You are a curious web explorer reading a page. Your ONLY job is to find the most interesting outgoing link, reference, or tangent mentioned in this content.

Pick something that leads to a COMPLETELY DIFFERENT topic. If the page is about airports, don't pick another airport link. Pick the footnote about a person, the aside about a historical event, the tool mentioned in passing.

Return JSON:
{
  "type": "url" or "search",
  "value": "https://..." or "a search query",
  "reasoning": "Why this tangent is irresistible"
}

- Use "url" when you find an actual URL or can construct one (e.g. a Wikipedia link, a GitHub repo URL).
- Use "search" when the page mentions something fascinating but doesn't link to it.
- The target should be as DIFFERENT as possible from the current page's main topic.`;

export async function pickLink(
  sourceUrl: string,
  previousCards: Card[],
  keys: FollowKeys
): Promise<FollowTarget> {
  const { results, failures } = await extract([sourceUrl], keys.tavilyKey);

  if (results.length === 0) {
    const reason = failures.length > 0 ? failures[0].error : "unknown error";
    throw new Error(
      `Failed to extract content from ${sourceUrl}: ${reason}`
    );
  }

  const pageContent = results[0].rawContent;
  const truncated =
    pageContent.length > 8000
      ? pageContent.slice(0, 8000) + "\n\n[content truncated]"
      : pageContent;

  const recentCards = previousCards.slice(-3);
  const pathText = recentCards.length
    ? `\nExploration path so far:\n${recentCards.map((c) => `> "${c.title}" (${c.type}) — ${c.whyInteresting}`).join("\n")}\n`
    : "";

  const result = await llm(
    [
      { role: "system", content: PICK_LINK_PROMPT },
      {
        role: "user",
        content: `Page URL: ${sourceUrl}\n\nPage content:\n${truncated}${pathText}\nPick the most surprising link or reference to follow.`,
      },
    ],
    keys.llmKey
  );

  const parsed = FollowTargetSchema.safeParse(result);
  if (!parsed.success) {
    throw new Error(
      `LLM returned invalid link pick: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", ")}`
    );
  }

  return parsed.data;
}
