/**
 * Integration tests for ExplorerDO.
 *
 * Uses @cloudflare/vitest-pool-workers to run inside workerd.
 * Exploration functions are mocked so no API keys are needed.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  env,
  runDurableObjectAlarm,
  runInDurableObject,
} from "cloudflare:test";

vi.mock("../explorer/explore", () => ({
  pickSeed: vi.fn(),
  exploreStep: vi.fn(),
}));

import { pickSeed, exploreStep } from "../explorer/explore";
import type { ExplorerDO } from "./index";
import type { Card } from "../explorer/types";

declare module "cloudflare:test" {
  interface ProvidedEnv extends Env {}
}

const mockPickSeed = vi.mocked(pickSeed);
const mockExploreStep = vi.mocked(exploreStep);

function makeCard(overrides: Partial<Card> = {}): Card {
  return {
    id: 1,
    title: "Test Card",
    type: "article",
    summary: "A test summary",
    url: "https://example.com",
    whyInteresting: "It's interesting",
    thread: { from: "origin", reasoning: "Starting fresh" },
    details: {},
    ...overrides,
  };
}

function getStub(name: string): DurableObjectStub<ExplorerDO> {
  const id = env.EXPLORER_DO.idFromName(name);
  return env.EXPLORER_DO.get(id);
}

/**
 * Connect a WebSocket to the DO and collect messages into an array.
 * Waits briefly for buffered messages (replay) to arrive.
 */
async function connectWs(stub: DurableObjectStub<ExplorerDO>) {
  const resp = await stub.fetch("http://fake/ws", {
    headers: { Upgrade: "websocket" },
  });
  const ws = resp.webSocket!;
  const messages: Record<string, unknown>[] = [];
  ws.addEventListener("message", (e) => {
    messages.push(JSON.parse(e.data as string));
  });
  ws.accept();
  await yieldEvent();
  return { ws, messages };
}

/** Let queued WebSocket messages deliver. */
async function yieldEvent() {
  await new Promise((r) => setTimeout(r, 50));
}

let testCounter = 0;
function uniqueName() {
  return `test-${++testCounter}`;
}

describe("ExplorerDO", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockPickSeed.mockResolvedValue({
      query: "test seed query",
      reason: "testing",
    });
    mockExploreStep.mockResolvedValue({
      card: makeCard(),
      nextQuery: "next query",
      nextReason: "following up",
    });
  });

  describe("WebSocket upgrade", () => {
    it("rejects non-WebSocket requests with 426", async () => {
      const stub = getStub(uniqueName());
      const resp = await stub.fetch("http://fake/ws");
      expect(resp.status).toBe(426);
    });

    it("accepts WebSocket upgrades with 101", async () => {
      const stub = getStub(uniqueName());
      const resp = await stub.fetch("http://fake/ws", {
        headers: { Upgrade: "websocket" },
      });
      expect(resp.status).toBe(101);
      expect(resp.webSocket).toBeTruthy();
    });
  });

  describe("event buffer replay", () => {
    it("sends history-end to new connections with empty buffer", async () => {
      const stub = getStub(uniqueName());
      const { messages } = await connectWs(stub);

      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual({ event: "history-end", data: {} });
    });

    it("replays buffered seed and card events to new connections", async () => {
      const stub = getStub(uniqueName());

      // First viewer connects and triggers exploration
      const { ws: ws1 } = await connectWs(stub);
      await runDurableObjectAlarm(stub);
      await yieldEvent();

      // Second viewer connects and gets replay
      const { messages: msgs2 } = await connectWs(stub);

      const historyEnd = msgs2.findIndex((m) => m.event === "history-end");
      expect(historyEnd).toBeGreaterThan(0);

      const replay = msgs2.slice(0, historyEnd);
      expect(replay.some((m) => m.event === "seed")).toBe(true);
      expect(replay.some((m) => m.event === "card")).toBe(true);

      ws1.close();
    });

    it("does not replay status or done events", async () => {
      const stub = getStub(uniqueName());
      const { ws: ws1 } = await connectWs(stub);

      // Complete a full round (12 steps)
      for (let i = 0; i < 12; i++) {
        mockExploreStep.mockResolvedValue({
          card: makeCard({ id: i + 1 }),
          nextQuery: `q${i + 2}`,
          nextReason: "continuing",
        });
        await runDurableObjectAlarm(stub);
      }
      await yieldEvent();

      // New viewer should only see seed + card events, not status/done
      const { messages: msgs2 } = await connectWs(stub);
      const historyEnd = msgs2.findIndex((m) => m.event === "history-end");
      const replay = msgs2.slice(0, historyEnd);

      expect(replay.some((m) => m.event === "status")).toBe(false);
      expect(replay.some((m) => m.event === "done")).toBe(false);

      ws1.close();
    });
  });

  describe("alarm loop", () => {
    it("schedules alarm on first connection", async () => {
      const stub = getStub(uniqueName());
      await connectWs(stub);

      const ran = await runDurableObjectAlarm(stub);
      expect(ran).toBe(true);
    });

    it("does not schedule a second alarm from a second connection", async () => {
      const stub = getStub(uniqueName());
      await connectWs(stub);

      // Run first alarm to advance state
      await runDurableObjectAlarm(stub);

      // Second connection should not double-schedule
      await connectWs(stub);

      // Exactly one alarm should be pending: run it, then verify no second one exists
      const firstRan = await runDurableObjectAlarm(stub);
      expect(firstRan).toBe(true);
      const secondRan = await runDurableObjectAlarm(stub);
      expect(secondRan).toBe(false);
    });

    it("picks seed and broadcasts seed event on first alarm", async () => {
      const stub = getStub(uniqueName());
      const { messages } = await connectWs(stub);
      messages.length = 0;

      await runDurableObjectAlarm(stub);
      await yieldEvent();

      const seedEvent = messages.find((m) => m.event === "seed");
      expect(seedEvent).toBeDefined();
      expect(seedEvent!.data).toEqual({
        query: "test seed query",
        reason: "testing",
      });
    });

    it("broadcasts status and card events during exploration step", async () => {
      const stub = getStub(uniqueName());
      const { messages } = await connectWs(stub);
      messages.length = 0;

      await runDurableObjectAlarm(stub);
      await yieldEvent();

      const statusEvent = messages.find((m) => m.event === "status");
      expect(statusEvent).toBeDefined();
      expect(statusEvent!.data).toMatchObject({
        step: 1,
        total: 12,
        query: "test seed query",
      });

      const cardEvent = messages.find((m) => m.event === "card");
      expect(cardEvent).toBeDefined();
      expect((cardEvent!.data as Card).title).toBe("Test Card");
    });

    it("broadcasts to multiple viewers", async () => {
      const stub = getStub(uniqueName());
      const { messages: msgs1 } = await connectWs(stub);
      const { messages: msgs2 } = await connectWs(stub);
      msgs1.length = 0;
      msgs2.length = 0;

      await runDurableObjectAlarm(stub);
      await yieldEvent();

      // Both viewers get the same events
      expect(msgs1.some((m) => m.event === "card")).toBe(true);
      expect(msgs2.some((m) => m.event === "card")).toBe(true);
    });

    it("broadcasts done after completing all steps in a round", async () => {
      const stub = getStub(uniqueName());
      const { messages } = await connectWs(stub);
      messages.length = 0;

      for (let i = 0; i < 12; i++) {
        mockExploreStep.mockResolvedValue({
          card: makeCard({ id: i + 1, title: `Card ${i + 1}` }),
          nextQuery: `q${i + 2}`,
          nextReason: "continuing",
        });
        await runDurableObjectAlarm(stub);
      }
      await yieldEvent();

      const doneEvent = messages.find((m) => m.event === "done");
      expect(doneEvent).toBeDefined();
      expect(doneEvent!.data).toEqual({ totalCards: 12 });
    });

    it("starts a new round with a fresh seed after completing", async () => {
      const stub = getStub(uniqueName());
      const { messages } = await connectWs(stub);

      // Complete first round
      for (let i = 0; i < 12; i++) {
        await runDurableObjectAlarm(stub);
      }

      mockPickSeed.mockResolvedValue({
        query: "round 2 seed",
        reason: "new round",
      });

      // Next alarm starts a new round
      messages.length = 0;
      await runDurableObjectAlarm(stub);
      await yieldEvent();

      const seedEvent = messages.find((m) => m.event === "seed");
      expect(seedEvent).toBeDefined();
      expect(seedEvent!.data).toEqual({
        query: "round 2 seed",
        reason: "new round",
      });
    });

    it("stops when no viewers are connected", async () => {
      const stub = getStub(uniqueName());
      const { ws } = await connectWs(stub);

      ws.close();
      await yieldEvent();

      // Alarm fires but should not reschedule since no viewers
      await runDurableObjectAlarm(stub);

      const ran = await runDurableObjectAlarm(stub);
      expect(ran).toBe(false);
    });

    it("confirms running state via runInDurableObject", async () => {
      const stub = getStub(uniqueName());
      await connectWs(stub);

      const running = await runInDurableObject(stub, (instance) => {
        // Access private state via type assertion
        return (instance as unknown as { state: { running: boolean } }).state
          .running;
      });
      expect(running).toBe(true);
    });
  });

  describe("error recovery", () => {
    it("broadcasts error when exploration step fails", async () => {
      const stub = getStub(uniqueName());
      const { messages } = await connectWs(stub);
      messages.length = 0;

      mockExploreStep.mockRejectedValueOnce(new Error("API timeout"));

      await runDurableObjectAlarm(stub);
      await yieldEvent();

      const errorEvent = messages.find((m) => m.event === "error");
      expect(errorEvent).toBeDefined();
      expect(errorEvent!.data).toEqual({ message: "API timeout" });
    });

    it("schedules retry alarm after error", async () => {
      const stub = getStub(uniqueName());
      await connectWs(stub);

      mockExploreStep.mockRejectedValueOnce(new Error("API timeout"));

      await runDurableObjectAlarm(stub);

      // Retry alarm should be scheduled
      const ran = await runDurableObjectAlarm(stub);
      expect(ran).toBe(true);
    });

    it("recovers after a transient error", async () => {
      const stub = getStub(uniqueName());
      const { messages } = await connectWs(stub);

      // First alarm: seed succeeds but step fails
      mockExploreStep.mockRejectedValueOnce(new Error("transient"));
      await runDurableObjectAlarm(stub);

      // Second alarm: step succeeds
      mockExploreStep.mockResolvedValue({
        card: makeCard({ title: "Recovery Card" }),
        nextQuery: "recovered",
        nextReason: "back on track",
      });
      messages.length = 0;
      await runDurableObjectAlarm(stub);
      await yieldEvent();

      const cardEvent = messages.find((m) => m.event === "card");
      expect(cardEvent).toBeDefined();
      expect((cardEvent!.data as Card).title).toBe("Recovery Card");
    });
  });

  describe("event buffer limits", () => {
    it("caps buffered events at 50", async () => {
      const stub = getStub(uniqueName());
      const { ws: ws1 } = await connectWs(stub);

      // Generate many events across multiple rounds
      // Each round produces 1 seed + 12 cards = 13 buffered events
      // 4 rounds = 52 events, buffer should cap at 50
      for (let round = 0; round < 4; round++) {
        mockPickSeed.mockResolvedValue({
          query: `round ${round + 1}`,
          reason: "test",
        });
        for (let i = 0; i < 12; i++) {
          mockExploreStep.mockResolvedValue({
            card: makeCard({ id: round * 12 + i + 1 }),
            nextQuery: `q${i}`,
            nextReason: "test",
          });
          await runDurableObjectAlarm(stub);
        }
      }

      // New viewer should get at most 50 replayed events + history-end
      const { messages } = await connectWs(stub);
      const historyEnd = messages.findIndex((m) => m.event === "history-end");
      expect(historyEnd).toBeLessThanOrEqual(50);

      ws1.close();
    });
  });

  describe("WebSocket messages", () => {
    it("responds to ping with pong", async () => {
      const stub = getStub(uniqueName());
      const { ws, messages } = await connectWs(stub);
      messages.length = 0;

      ws.send(JSON.stringify({ type: "ping" }));
      await yieldEvent();

      const pong = messages.find((m) => m.type === "pong");
      expect(pong).toBeDefined();
    });

    it("ignores malformed messages", async () => {
      const stub = getStub(uniqueName());
      const { ws, messages } = await connectWs(stub);
      messages.length = 0;

      ws.send("not json");
      ws.send(JSON.stringify({ type: "unknown" }));
      await yieldEvent();

      // No crash, no messages sent back
      expect(messages).toHaveLength(0);
    });
  });
});
