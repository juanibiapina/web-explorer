/**
 * Agent-based exploration using Vercel AI SDK with tool calling.
 *
 * Replaces the multi-function pipeline (pickSeed, exploreStep, followStep,
 * pickLink) with a single agent that decides what to do. The agent has
 * three tools: web_search, fetch_page, and create_card. It searches the
 * web, optionally reads pages, and creates cards when it finds something
 * interesting.
 *
 * Each call to `runAgentStep` produces exactly one card. The conversation
 * history is passed in and returned, so the ExplorationDO can persist it
 * between alarm-driven steps.
 */

import { generateText, tool, hasToolCall } from "ai";
import type { ModelMessage } from "ai";
import { createWorkersAI } from "workers-ai-provider";
import { z } from "zod";
import { search } from "./search";
import { extract } from "./extract";
import type { Card } from "./types";

const MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

const SYSTEM_PROMPT = `You are a curious web explorer. You browse the internet following threads of genuine interest, like a fascinating friend who always finds the most interesting corners of the web.

You have three tools:
- web_search: Search the web for a query.
- fetch_page: Extract the full content of a URL (use when you want to read a page more deeply or follow a link).
- create_card: Create a card about something interesting you found.

Your goal: explore the web and create cards about the most interesting things you find.

How to explore:
1. Search for something interesting (or follow up on what you found before).
2. Optionally fetch a page to read it more deeply.
3. Create a card about the most interesting finding.

Card types: article, repo, person, thread, paper, tool, video, community.

The "details" object depends on the card type. Include whatever you can extract:
- article: { "author", "publication", "date", "readingMinutes" }
- repo: { "owner", "name", "description", "language", "stars", "topics" }
- person: { "name", "role", "knownFor", "affiliations" }
- thread: { "platform", "subreddit", "commentCount", "topComment" }
- paper: { "authors", "year", "venue", "abstract" }
- tool: { "name", "tagline", "platform", "pricing", "useCase" }
- video: { "channel", "duration", "platform" }
- community: { "platform", "name", "memberCount", "focus" }

Rules:
- Be genuinely curious. Don't pick the most obvious result.
- Follow surprising connections. The best threads come from unexpected links between topics.
- Each card should explore a DIFFERENT angle from the previous ones.
- Write like a real person, not a content summarizer.
- The feed should be a mix of content types, like a magazine: profiles, reviews, essays, interviews, recommendations.
- Craft diverse searches: "github X" for repos, "creator of X" for people, "tool for X" for tools, "reddit X" for discussions, "arxiv X" for papers.
- For the thread field: "from" should be the title of the previous card (or "origin" if this is the first), and "reasoning" should explain the curiosity thread that led you here.`;

export interface AgentKeys {
  tavilyKey: string;
  ai: Ai;
}

export interface AgentStepResult {
  card: Card;
  messages: ModelMessage[];
}

/**
 * Run one agent step that produces exactly one card.
 *
 * The agent calls tools (search, fetch, create) as needed. The conversation
 * stops when create_card is called (via stopWhen). Returns the card and the
 * full updated conversation history for the next step.
 */
export async function runAgentStep(
  messages: ModelMessage[],
  previousCards: Card[],
  stepNum: number,
  keys: AgentKeys,
): Promise<AgentStepResult> {
  const workersai = createWorkersAI({ binding: keys.ai });

  let createdCard: Card | null = null;

  const diversityHint = buildDiversityHint(previousCards);

  // Build the user message for this step
  const userMessage = stepNum === 1
    ? `Today is ${new Date().toISOString().split("T")[0]}. Pick a fascinating topic to explore and create your first card. Something surprising, niche, or at the intersection of unexpected fields.`
    : `Continue exploring. Create card ${stepNum}.${diversityHint}`;

  const inputMessages: ModelMessage[] = [
    ...messages,
    { role: "user", content: userMessage },
  ];

  const tavilyKey = keys.tavilyKey;
  const cardStepNum = stepNum;

  const result = await generateText({
    model: workersai(MODEL),
    system: SYSTEM_PROMPT,
    messages: inputMessages,
    tools: {
      web_search: tool({
        description: "Search the web. Returns titles, URLs, and content snippets.",
        inputSchema: z.object({
          query: z.string().describe("The search query"),
        }),
        execute: async ({ query }) => {
          const results = await search(query, tavilyKey);
          return results.map((r) => ({
            title: r.title,
            url: r.url,
            snippet: r.content?.slice(0, 500) || "No preview",
          }));
        },
      }),
      fetch_page: tool({
        description: "Extract the full text content of a URL. Use to read a page more deeply before creating a card, or to find links to follow.",
        inputSchema: z.object({
          url: z.string().describe("The URL to extract content from"),
        }),
        execute: async ({ url }) => {
          const { results, failures } = await extract([url], tavilyKey);
          if (results.length === 0) {
            const reason = failures[0]?.error || "unknown error";
            return { error: `Failed to extract content: ${reason}` };
          }
          const content = results[0].rawContent;
          return {
            url,
            content: content.length > 8000
              ? content.slice(0, 8000) + "\n\n[content truncated]"
              : content,
          };
        },
      }),
      create_card: tool({
        description: "Create an exploration card about something interesting you found. Call this exactly once per step.",
        inputSchema: z.object({
          title: z.string().describe("Short, punchy title (max ~60 chars)"),
          type: z.string().describe("Card type: article, repo, person, thread, paper, tool, video, or community"),
          summary: z.string().describe("2-3 sentences. Write like texting a friend about something cool."),
          url: z.string().describe("URL of the source"),
          whyInteresting: z.string().describe("Why this caught your eye. Specific and genuine."),
          threadFrom: z.string().describe("Title of previous card, or 'origin' if first"),
          threadReasoning: z.string().describe("The curiosity thread: how the previous discovery led you here"),
          details: z.record(z.string(), z.unknown()).optional().describe("Type-specific details (author, language, stars, etc.)"),
        }),
        execute: async (params) => {
          createdCard = {
            id: cardStepNum,
            title: params.title,
            type: params.type,
            summary: params.summary,
            url: params.url,
            whyInteresting: params.whyInteresting,
            thread: {
              from: params.threadFrom,
              reasoning: params.threadReasoning,
            },
            details: params.details ?? {},
          };
          return { success: true, cardNumber: cardStepNum };
        },
      }),
    },
    stopWhen: hasToolCall("create_card"),
    temperature: 0.9,
    maxRetries: 1,
  });

  if (!createdCard) {
    throw new Error("Agent did not create a card");
  }

  // Build the full conversation history for the next step
  const updatedMessages: ModelMessage[] = [
    ...inputMessages,
    ...result.response.messages,
  ];

  return {
    card: createdCard,
    messages: updatedMessages,
  };
}

/**
 * Card types for diversity tracking.
 */
const CARD_TYPES = [
  "article", "repo", "person", "thread",
  "paper", "tool", "video", "community",
];

/**
 * Build a diversity hint when recent cards are too same-typed.
 * Returns an empty string when the feed is already varied.
 */
export function buildDiversityHint(previousCards: Card[]): string {
  if (previousCards.length < 2) return "";

  const lastType = previousCards[previousCards.length - 1].type;
  let streak = 0;
  for (let i = previousCards.length - 1; i >= 0; i--) {
    if (previousCards[i].type === lastType) streak++;
    else break;
  }

  if (streak < 2) return "";

  const recentTypes = new Set(previousCards.slice(-5).map((c) => c.type));
  const underrepresented = CARD_TYPES.filter((t) => !recentTypes.has(t));

  const suggestions =
    underrepresented.length > 0
      ? ` Try finding: ${underrepresented.slice(0, 3).join(", ")}.`
      : "";

  return `\n\nDIVERSITY NOTE: The last ${streak} cards have all been "${lastType}" type. Mix it up! Craft your search to surface a different kind of content.${suggestions}`;
}
