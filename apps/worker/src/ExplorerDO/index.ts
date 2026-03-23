/**
 * ExplorerDO - Shared exploration stream via WebSocket.
 *
 * A singleton Durable Object that runs a continuous exploration loop.
 * All viewers connect to the same instance and see the same live feed.
 *
 * Uses alarms to drive exploration one step at a time, staying within
 * Cloudflare's CPU time limits. Uses hibernatable WebSockets so idle
 * connections are cost-efficient.
 *
 * Lifecycle:
 * 1. First WebSocket connection triggers the exploration loop via alarm.
 * 2. Each alarm fires one exploration step (search + LLM + broadcast).
 * 3. After the step, it schedules the next alarm.
 * 4. When a round finishes, a new round starts after a short pause.
 */

import { DurableObject } from "cloudflare:workers";
import type { Env } from "../types";
import type { Card, StreamEvent } from "../explorer/types";
import { pickSeed, exploreStep } from "../explorer/explore";

const BUFFER_SIZE = 50;
const STEPS_PER_ROUND = 12;
const PAUSE_BETWEEN_ROUNDS_MS = 5000;
const RETRY_BASE_MS = 5000;
const RETRY_MAX_MS = 120000; // 2 minutes
const MAX_CONSECUTIVE_ERRORS = 3;

interface ExplorerState {
  cards: Card[];
  eventBuffer: StreamEvent[];
  query: string | null;
  step: number;
  maxSteps: number;
  running: boolean;
  consecutiveErrors: number;
}

export class ExplorerDO extends DurableObject<Env> {
  private state: ExplorerState = {
    cards: [],
    eventBuffer: [],
    query: null,
    step: 0,
    maxSteps: STEPS_PER_ROUND,
    running: false,
    consecutiveErrors: 0,
  };

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
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

    // Replay buffered events to the new client
    for (const event of this.state.eventBuffer) {
      server.send(JSON.stringify(event));
    }
    server.send(JSON.stringify({ event: "history-end", data: {} }));

    // Broadcast updated viewer count to all clients (including the new one)
    this.broadcastViewerCount();

    // Start the exploration loop if not already running
    if (!this.state.running) {
      this.state.running = true;
      await this.ctx.storage.setAlarm(Date.now() + 100);
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  /**
   * Alarm handler. Drives exploration one step at a time.
   */
  async alarm(): Promise<void> {
    const keys = {
      searchKeys: {
        tavilyKey: this.env.TAVILY_API_KEY,
        braveKey: this.env.BRAVE_API_KEY,
      },
      llmKey: this.env.ZAI_API_KEY,
    };

    try {
      // Start a new round if no query is set
      if (!this.state.query) {
        const seed = await pickSeed(keys);
        this.state.query = seed.query;
        this.state.step = 0;
        this.state.cards = [];
        this.broadcast({
          event: "seed",
          data: { query: seed.query, reason: seed.reason },
        });
      }

      this.state.step++;
      this.broadcast({
        event: "status",
        data: {
          step: this.state.step,
          total: this.state.maxSteps,
          query: this.state.query,
        },
      });

      const { card, nextQuery } = await exploreStep(
        this.state.query,
        this.state.cards,
        this.state.step,
        keys
      );

      this.state.cards.push(card);
      this.broadcast({ event: "card", data: card });
      this.state.query = nextQuery;
      this.state.consecutiveErrors = 0;

      // Schedule next step or start a new round
      if (this.state.step >= this.state.maxSteps) {
        this.broadcast({
          event: "done",
          data: { totalCards: this.state.cards.length },
        });
        this.state.query = null;
        await this.scheduleNext(PAUSE_BETWEEN_ROUNDS_MS);
      } else {
        await this.scheduleNext(100);
      }
    } catch (err) {
      this.state.consecutiveErrors++;
      const message = err instanceof Error ? err.message : String(err);

      // After too many consecutive errors, abandon this round and start
      // fresh. If a query consistently triggers long reasoning or bad
      // results, retrying it forever won't help.
      if (this.state.consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        this.broadcast({
          event: "error",
          data: {
            message: `${message} — too many errors, starting a new round`,
          },
        });
        this.state.query = null;
        this.state.step = 0;
        this.state.cards = [];
        this.state.consecutiveErrors = 0;
        await this.scheduleNext(PAUSE_BETWEEN_ROUNDS_MS);
      } else {
        const retryMs = Math.min(
          RETRY_BASE_MS * 2 ** (this.state.consecutiveErrors - 1),
          RETRY_MAX_MS
        );
        this.broadcast({
          event: "error",
          data: { message, retryInMs: retryMs },
        });
        await this.scheduleNext(retryMs);
      }
    }
  }

  /**
   * Schedule the next alarm, but only if there are still viewers.
   */
  private async scheduleNext(delayMs: number): Promise<void> {
    if (this.ctx.getWebSockets().length > 0) {
      await this.ctx.storage.setAlarm(Date.now() + delayMs);
    } else {
      this.state.running = false;
    }
  }

  /**
   * Broadcast an event to all connected clients and buffer it.
   */
  private broadcast(event: StreamEvent): void {
    // Buffer seed and card events for replay
    if (event.event === "seed" || event.event === "card") {
      this.state.eventBuffer.push(event);
      while (this.state.eventBuffer.length > BUFFER_SIZE) {
        this.state.eventBuffer.shift();
      }
    }

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

  /**
   * Handle client messages (ping/pong keepalive).
   */
  async webSocketMessage(
    ws: WebSocket,
    message: string | ArrayBuffer
  ): Promise<void> {
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

  async webSocketClose(
    ws: WebSocket,
    code: number,
    reason: string
  ): Promise<void> {
    try {
      ws.close(code, reason);
    } catch {
      /* already closed */
    }
    this.broadcastViewerCount();
  }

  async webSocketError(ws: WebSocket, _error: unknown): Promise<void> {
    try {
      ws.close(1011, "WebSocket error");
    } catch {
      /* already closed */
    }
    this.broadcastViewerCount();
  }

  /**
   * Broadcast current viewer count to all connected clients.
   */
  private broadcastViewerCount(): void {
    const count = this.ctx.getWebSockets().length;
    const msg = JSON.stringify({ event: "viewers", data: { count } });
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(msg);
      } catch {
        /* send failed, ignore */
      }
    }
  }
}
