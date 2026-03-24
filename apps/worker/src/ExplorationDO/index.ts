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

const STEPS_PER_EXPLORATION = 12;
const RETRY_BASE_MS = 5000;
const RETRY_MAX_MS = 120000;
const MAX_CONSECUTIVE_ERRORS = 3;

export class ExplorationDO extends DurableObject<Env> {
  /**
   * RPC: Start the exploration for a given date.
   * Called by IndexDO. Idempotent: does nothing if already started.
   */
  async start(date: string): Promise<void> {
    const existing = await this.ctx.storage.get("status");
    if (existing) return; // Already started

    await this.ctx.storage.put({
      date,
      status: "generating",
      step: 0,
      query: null,
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
   */
  async alarm(): Promise<void> {
    const keys = {
      tavilyKey: this.env.TAVILY_API_KEY,
      llmKey: this.env.ZAI_API_KEY,
    };

    const step = (await this.ctx.storage.get<number>("step")) ?? 0;
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

      const query = await this.ctx.storage.get<string>("query");
      if (!query) throw new Error("No query in storage");

      const newStep = step + 1;
      const cards = await this.getCards();

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

      // Check if exploration is complete
      if (newStep >= STEPS_PER_EXPLORATION) {
        await this.ctx.storage.put("status", "complete");
        this.broadcast({ event: "done", data: { totalCards: newStep } });
        // No more alarms - exploration is done
      } else {
        await this.ctx.storage.setAlarm(Date.now() + 100);
      }
    } catch (err) {
      const newErrors = consecutiveErrors + 1;
      const message = err instanceof Error ? err.message : String(err);

      if (newErrors >= MAX_CONSECUTIVE_ERRORS) {
        // Too many errors in a row. Reset step and try a fresh seed.
        this.broadcast({
          event: "error",
          data: { message: `${message} — too many errors, retrying with a new seed` },
        });
        // Clear stale seed and cards from the failed run so replays
        // and context for the next run start clean.
        const staleKeys = await this.ctx.storage.list({ prefix: "card:" });
        await this.ctx.storage.delete(["seed", ...staleKeys.keys()]);

        await this.ctx.storage.put({
          step: 0,
          query: null,
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
