/**
 * ExplorationDO - A single day's exploration.
 *
 * Created by IndexDO via newUniqueId(). Runs 12 exploration steps to
 * completion via the alarm loop, persisting each step to storage. Viewers
 * connect via WebSocket and get a replay of stored cards plus live updates
 * if the exploration is still generating.
 *
 * Lifecycle:
 * 1. IndexDO calls start(date) to kick off the alarm loop.
 * 2. First alarm picks a seed topic, stores it, broadcasts to viewers.
 * 3. Each subsequent alarm runs one exploration step (search + LLM).
 * 4. After 12 steps, status flips to "complete". No more alarms.
 * 5. Viewers connecting after completion get the full replay + done event.
 *
 * All state lives in DO storage so it survives hibernation.
 */

import { DurableObject } from "cloudflare:workers";
import type { Card, StreamEvent } from "../explorer/types";
import { pickSeed, exploreStep } from "../explorer/explore";
import { followStep, pickLink } from "../explorer/follow";
import type { FollowTarget } from "../explorer/follow";

const STEPS_PER_EXPLORATION = 12;
const RETRY_BASE_MS = 5000;
const RETRY_MAX_MS = 120000;
const MAX_CONSECUTIVE_ERRORS = 3;

export class ExplorationDO extends DurableObject<Env> {
  /**
   * RPC: Start the exploration for a given date.
   * Called by IndexDO. Idempotent: does nothing if already started.
   *
   * @param mode - "search" uses web search for every step (default).
   *               "follow" searches once, then follows links from page content.
   */
  async start(date: string, mode: "search" | "follow" = "search"): Promise<void> {
    const existing = await this.ctx.storage.get("status");
    if (existing) return; // Already started

    await this.ctx.storage.put({
      date,
      mode,
      status: "generating",
      step: 0,
      query: null,
      nextTarget: null,
      consecutiveErrors: 0,
    });

    await this.ctx.storage.setAlarm(Date.now() + 100);
  }

  /**
   * RPC: Get the full exploration data for REST access.
   */
  async getExploration(): Promise<{
    date: string;
    seed: { query: string; reason: string } | null;
    cards: Card[];
    status: "generating" | "complete";
  } | null> {
    const date = await this.ctx.storage.get<string>("date");
    if (!date) return null;

    const seed = (await this.ctx.storage.get<{ query: string; reason: string }>("seed")) ?? null;
    const cards = await this.getCards();
    const status = (await this.ctx.storage.get<string>("status")) as "generating" | "complete";

    return { date, seed, cards, status };
  }

  /**
   * Handles HTTP requests. Only WebSocket upgrades are accepted.
   */
  async fetch(request: Request): Promise<Response> {
    const upgradeHeader = request.headers.get("Upgrade");
    if (upgradeHeader !== "websocket") {
      return new Response("Expected WebSocket upgrade", { status: 426 });
    }

    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];

    this.ctx.acceptWebSocket(server);

    // Replay stored events to the new client
    const seed = await this.ctx.storage.get<{ query: string; reason: string }>("seed");
    if (seed) {
      server.send(JSON.stringify({ event: "seed", data: seed }));
    }

    const cards = await this.getCards();
    for (const card of cards) {
      server.send(JSON.stringify({ event: "card", data: card }));
    }

    server.send(JSON.stringify({ event: "history-end", data: {} }));

    // If complete, tell the viewer immediately
    const status = await this.ctx.storage.get<string>("status");
    if (status === "complete") {
      server.send(JSON.stringify({ event: "done", data: { totalCards: cards.length } }));
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  /**
   * Alarm handler. Drives exploration one step at a time.
   * Runs to completion regardless of viewer count.
   *
   * In "search" mode (original): every step searches the web.
   * In "follow" mode: step 1 searches, then follows links from page content.
   */
  async alarm(): Promise<void> {
    const keys = {
      tavilyKey: this.env.TAVILY_API_KEY,
      llmKey: this.env.ZAI_API_KEY,
    };

    const step = (await this.ctx.storage.get<number>("step")) ?? 0;
    const mode = (await this.ctx.storage.get<string>("mode")) ?? "search";
    const consecutiveErrors = (await this.ctx.storage.get<number>("consecutiveErrors")) ?? 0;

    try {
      // First step: pick a seed
      if (step === 0) {
        const seed = await pickSeed(keys);
        await this.ctx.storage.put({
          seed,
          query: seed.query,
          step: 0,
        });
        this.broadcast({ event: "seed", data: { query: seed.query, reason: seed.reason } });
      }

      const newStep = step + 1;
      const cards = await this.getCards();

      if (mode === "follow") {
        await this.runFollowStep(newStep, cards, keys);
      } else {
        await this.runSearchStep(newStep, cards, keys);
      }

      // Check if exploration is complete
      if (newStep >= STEPS_PER_EXPLORATION) {
        await this.ctx.storage.put("status", "complete");
        const totalCards = (await this.getCards()).length;
        this.broadcast({ event: "done", data: { totalCards } });
      } else {
        await this.ctx.storage.setAlarm(Date.now() + 100);
      }
    } catch (err) {
      const newErrors = consecutiveErrors + 1;
      const message = err instanceof Error ? err.message : String(err);

      if (newErrors >= MAX_CONSECUTIVE_ERRORS) {
        this.broadcast({
          event: "error",
          data: { message: `${message} — too many errors, retrying with a new seed` },
        });
        const staleKeys = await this.ctx.storage.list({ prefix: "card:" });
        await this.ctx.storage.delete(["seed", ...staleKeys.keys()]);

        await this.ctx.storage.put({
          step: 0,
          query: null,
          nextTarget: null,
          consecutiveErrors: 0,
        });
        await this.ctx.storage.setAlarm(Date.now() + RETRY_BASE_MS);
      } else {
        const retryMs = Math.min(RETRY_BASE_MS * 2 ** (newErrors - 1), RETRY_MAX_MS);
        this.broadcast({
          event: "error",
          data: { message, retryInMs: retryMs },
        });
        await this.ctx.storage.put("consecutiveErrors", newErrors);
        await this.ctx.storage.setAlarm(Date.now() + retryMs);
      }
    }
  }

  /**
   * Search mode: every step searches the web for a new query.
   * This is the original behavior.
   */
  private async runSearchStep(
    newStep: number,
    cards: Card[],
    keys: { tavilyKey: string; llmKey: string }
  ): Promise<void> {
    const query = await this.ctx.storage.get<string>("query");
    if (!query) throw new Error("No query in storage");

    this.broadcast({
      event: "status",
      data: { step: newStep, total: STEPS_PER_EXPLORATION, query },
    });

    const { card, nextQuery } = await exploreStep(query, cards, newStep, keys);

    await this.ctx.storage.put({
      [`card:${newStep}`]: card,
      step: newStep,
      query: nextQuery,
      consecutiveErrors: 0,
    });

    this.broadcast({ event: "card", data: card });
  }

  /**
   * Follow mode: step 1 uses search, then follows links from page content.
   *
   * Step 1: search-based exploreStep, then pickLink from the card's URL.
   * Steps 2+: followStep on the target URL, or exploreStep on a search
   * fallback query (when a page had no good links).
   */
  private async runFollowStep(
    newStep: number,
    cards: Card[],
    keys: { tavilyKey: string; llmKey: string }
  ): Promise<void> {
    const nextTarget = await this.ctx.storage.get<FollowTarget>("nextTarget");

    if (!nextTarget) {
      // Step 1: use search to get the first card, then pick a link to follow.
      const query = await this.ctx.storage.get<string>("query");
      if (!query) throw new Error("No query in storage");

      this.broadcast({
        event: "status",
        data: { step: newStep, total: STEPS_PER_EXPLORATION, query },
      });

      const { card } = await exploreStep(query, cards, newStep, keys);
      const follow = await pickLink(card.url, [card], keys);

      await this.ctx.storage.put({
        [`card:${newStep}`]: card,
        step: newStep,
        nextTarget: follow,
        consecutiveErrors: 0,
      });

      this.broadcast({ event: "card", data: card });
    } else if (nextTarget.type === "url") {
      // Follow a URL: extract the page, create card, pick next link.
      this.broadcast({
        event: "status",
        data: { step: newStep, total: STEPS_PER_EXPLORATION, query: nextTarget.value },
      });

      const { card, follow } = await followStep(
        nextTarget.value,
        cards,
        newStep,
        keys
      );

      await this.ctx.storage.put({
        [`card:${newStep}`]: card,
        step: newStep,
        nextTarget: follow,
        consecutiveErrors: 0,
      });

      this.broadcast({ event: "card", data: card });
    } else {
      // Search fallback: the previous page had no good links.
      // Search for the query, create card, then pick a link to resume following.
      this.broadcast({
        event: "status",
        data: { step: newStep, total: STEPS_PER_EXPLORATION, query: nextTarget.value },
      });

      const { card } = await exploreStep(
        nextTarget.value,
        cards,
        newStep,
        keys
      );
      const follow = await pickLink(card.url, [...cards, card], keys);

      await this.ctx.storage.put({
        [`card:${newStep}`]: card,
        step: newStep,
        nextTarget: follow,
        consecutiveErrors: 0,
      });

      this.broadcast({ event: "card", data: card });
    }
  }

  /**
   * Handle client messages (ping/pong keepalive).
   */
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message === "string") {
      try {
        const data = JSON.parse(message);
        if (data.type === "ping") {
          ws.send(JSON.stringify({ type: "pong" }));
        }
      } catch {
        /* ignore malformed */
      }
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    try {
      ws.close(code, reason);
    } catch {
      /* already closed */
    }
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    try {
      ws.close(1011, "WebSocket error");
    } catch {
      /* already closed */
    }
  }

  /**
   * Read all cards from storage, ordered by step number.
   */
  private async getCards(): Promise<Card[]> {
    const entries = await this.ctx.storage.list<Card>({ prefix: "card:" });
    // Sort by step number (card:1, card:2, ..., card:12)
    const sorted = [...entries.entries()].sort(([a], [b]) => {
      const numA = parseInt(a.replace("card:", ""), 10);
      const numB = parseInt(b.replace("card:", ""), 10);
      return numA - numB;
    });
    return sorted.map(([, card]) => card);
  }

  /**
   * Broadcast an event to all connected WebSocket clients.
   */
  private broadcast(event: StreamEvent): void {
    const msg = JSON.stringify(event);
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(msg);
      } catch {
        try {
          ws.close(1011, "Send failed");
        } catch {
          /* already closed */
        }
      }
    }
  }
}
