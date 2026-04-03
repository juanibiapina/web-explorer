/**
 * ExplorationDO - A single day's exploration.
 *
 * Created by IndexDO via newUniqueId(). Runs 12 exploration steps to
 * completion via the alarm loop, persisting each step to storage. Viewers
 * connect via WebSocket and get a replay of stored cards plus live updates
 * if the exploration is still generating.
 *
 * Each alarm runs one agent step: the agent searches the web, optionally
 * reads pages, and creates a card. The full conversation history is persisted
 * between steps so the agent maintains continuity.
 *
 * Lifecycle:
 * 1. IndexDO calls start(date) to kick off the alarm loop.
 * 2. Each alarm runs one agent step that produces one card.
 * 3. After 12 cards, status flips to "complete". No more alarms.
 * 4. Viewers connecting after completion get the full replay + done event.
 */

import { DurableObject } from "cloudflare:workers";
import type { ModelMessage } from "ai";
import type { Card, StreamEvent } from "../explorer/types";
import { runAgentStep } from "../explorer/agent";
import type { AgentKeys } from "../explorer/agent";

const STEPS_PER_EXPLORATION = 12;
const STEP_INTERVAL_MS = 60_000; // 1 minute between steps (avoids rate limits)
const RETRY_BASE_MS = 5000;
const RETRY_MAX_MS = 120000;
const MAX_CONSECUTIVE_ERRORS = 3;

export class ExplorationDO extends DurableObject<Env> {
  /**
   * RPC: Start (or restart) the exploration for a given date.
   * Called by IndexDO. Clears all state and starts fresh.
   */
  async start(date: string): Promise<void> {
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();

    await this.ctx.storage.put({
      date,
      status: "generating",
      step: 0,
      messages: [] as ModelMessage[],
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
    status: "generating" | "complete" | "failed";
    error: string | null;
  } | null> {
    const date = await this.ctx.storage.get<string>("date");
    if (!date) return null;

    const seed = (await this.ctx.storage.get<{ query: string; reason: string }>("seed")) ?? null;
    const cards = await this.getCards();
    const status = (await this.ctx.storage.get<string>("status")) as "generating" | "complete" | "failed";
    const error = (await this.ctx.storage.get<string>("error")) ?? null;

    return { date, seed, cards, status, error };
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
   * Alarm handler. Runs one agent step per alarm.
   */
  async alarm(): Promise<void> {
    const keys: AgentKeys = {
      tavilyKey: this.env.TAVILY_API_KEY,
      ai: this.env.AI as unknown as Ai,
    };

    const step = (await this.ctx.storage.get<number>("step")) ?? 0;
    const consecutiveErrors = (await this.ctx.storage.get<number>("consecutiveErrors")) ?? 0;

    try {
      const newStep = step + 1;
      const cards = await this.getCards();
      const messages = (await this.ctx.storage.get<ModelMessage[]>("messages")) ?? [];

      this.broadcast({
        event: "status",
        data: { step: newStep, total: STEPS_PER_EXPLORATION, query: "exploring..." },
      });

      const result = await runAgentStep(messages, cards, newStep, keys);

      // On the first card, derive and broadcast a seed event
      if (newStep === 1) {
        const seed = {
          query: result.card.thread.reasoning,
          reason: result.card.whyInteresting,
        };
        await this.ctx.storage.put("seed", seed);
        this.broadcast({ event: "seed", data: seed });
      }

      // Persist the card, updated messages, and step count
      await this.ctx.storage.put({
        [`card:${newStep}`]: result.card,
        step: newStep,
        messages: result.messages,
        consecutiveErrors: 0,
      });

      this.broadcast({ event: "card", data: result.card });

      // Check if exploration is complete
      if (newStep >= STEPS_PER_EXPLORATION) {
        await this.ctx.storage.put("status", "complete");
        const totalCards = (await this.getCards()).length;
        this.broadcast({ event: "done", data: { totalCards } });
      } else {
        await this.ctx.storage.setAlarm(Date.now() + STEP_INTERVAL_MS);
      }
    } catch (err) {
      const newErrors = consecutiveErrors + 1;
      const message = err instanceof Error ? err.message : String(err);

      if (newErrors >= MAX_CONSECUTIVE_ERRORS) {
        this.broadcast({
          event: "error",
          data: { message: `${message} — failed after ${MAX_CONSECUTIVE_ERRORS} attempts` },
        });
        await this.ctx.storage.put({
          status: "failed",
          error: message,
        });
        return;
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
