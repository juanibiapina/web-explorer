/**
 * Card and stream event types for the exploration feed.
 */

export interface CardThread {
  from: string;
  reasoning: string;
}

export interface Card {
  id: number;
  title: string;
  type: string;
  summary: string;
  url: string;
  whyInteresting: string;
  thread: CardThread;
  details: Record<string, unknown>;
}

export type StreamEvent =
  | { event: "seed"; data: { query: string; reason: string } }
  | { event: "status"; data: { step: number; total: number; query: string } }
  | { event: "card"; data: Card }
  | { event: "error"; data: { message: string; retryInMs?: number } }
  | { event: "done"; data: { totalCards: number } }
  | { event: "history-end"; data: Record<string, never> };
