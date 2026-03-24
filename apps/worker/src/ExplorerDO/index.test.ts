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
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
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

/**
 * Wait until a condition is true, polling every 10ms.
 * Useful when alarm chaining makes delivery timing unpredictable.
 */
async function waitFor(
  condition: () => boolean,
  timeoutMs = 2000
): Promise<void> {
  const start = Date.now();
  while (!condition() && Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 10));
  }
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
    it("sends history-end, stats, and viewer count to new connections with empty buffer", async () => {
      const stub = getStub(uniqueName());
      const { messages } = await connectWs(stub);

      expect(messages).toHaveLength(3);
      expect(messages[0]).toEqual({ event: "history-end", data: {} });
      expect(messages[1]).toEqual({
        event: "stats",
        data: { totalCards: 0, roundsCompleted: 0, startedAt: null },
      });
      expect(messages[2]).toEqual({ event: "viewers", data: { count: 1 } });
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

    it("does not restart exploration when a second viewer connects", async () => {
      const stub = getStub(uniqueName());
      await connectWs(stub);

      // First alarm picks seed and starts exploration
      await runDurableObjectAlarm(stub);
      expect(mockPickSeed).toHaveBeenCalledTimes(1);

      // Second viewer connects while exploration is running
      await connectWs(stub);

      // pickSeed should NOT have been called again.
      // If the second connection incorrectly triggered a new alarm chain,
      // it would reset state and call pickSeed for a fresh round.
      expect(mockPickSeed).toHaveBeenCalledTimes(1);

      // running flag should still be true
      const running = await runInDurableObject(stub, (instance) => {
        return (instance as unknown as { state: { running: boolean } }).state
          .running;
      });
      expect(running).toBe(true);
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
    // NOTE: In the test environment, alarms may auto-fire during connectWs's
    // yieldEvent. Set rejection mocks BEFORE connecting to avoid races where
    // the alarm runs with the default success mock.

    it("broadcasts error when exploration step fails", async () => {
      const stub = getStub(uniqueName());

      // All exploreStep calls fail. This avoids races with auto-fired alarms:
      // even if alarms chain during connectWs, every step produces an error.
      mockExploreStep.mockRejectedValue(new Error("API timeout"));

      const { messages } = await connectWs(stub);
      await runDurableObjectAlarm(stub);
      await waitFor(() => messages.some((m) => m.event === "error"));

      const errorEvent = messages.find((m) => m.event === "error");
      expect(errorEvent).toBeDefined();
      expect(errorEvent!.data).toMatchObject({ message: "API timeout" });
    });

    it("schedules retry alarm after error", async () => {
      const stub = getStub(uniqueName());

      // All calls fail so auto-fired alarms also produce errors + retries
      mockExploreStep.mockRejectedValue(new Error("API timeout"));

      await connectWs(stub);
      await runDurableObjectAlarm(stub);

      // Retry alarm should be scheduled (from error handler's scheduleNext)
      const ran = await runDurableObjectAlarm(stub);
      expect(ran).toBe(true);
    });

    it("resets round after 3 consecutive errors", async () => {
      const stub = getStub(uniqueName());

      // All calls fail
      mockExploreStep.mockRejectedValue(new Error("persistent failure"));

      const { messages } = await connectWs(stub);

      // Fire 3 alarms to hit MAX_CONSECUTIVE_ERRORS
      for (let i = 0; i < 3; i++) {
        await runDurableObjectAlarm(stub);
        await yieldEvent();
      }

      // Third error should trigger round reset
      const resetError = messages.find(
        (m) =>
          m.event === "error" &&
          typeof (m.data as { message: string }).message === "string" &&
          (m.data as { message: string }).message.includes(
            "starting a new round"
          )
      );
      expect(resetError).toBeDefined();

      // Next alarm should pick a new seed (fresh round)
      mockPickSeed.mockResolvedValue({
        query: "fresh start",
        reason: "reset",
      });
      mockExploreStep.mockResolvedValue({
        card: makeCard({ title: "Fresh Card" }),
        nextQuery: "next",
        nextReason: "continuing",
      });

      messages.length = 0;
      await runDurableObjectAlarm(stub);
      await waitFor(() => messages.some((m) => m.event === "seed"));

      const seedEvent = messages.find((m) => m.event === "seed");
      expect(seedEvent).toBeDefined();
      expect(seedEvent!.data).toEqual({
        query: "fresh start",
        reason: "reset",
      });
    });

    it("recovers after a transient error", async () => {
      const stub = getStub(uniqueName());

      // All calls fail initially
      mockExploreStep.mockRejectedValue(new Error("transient"));

      const { messages } = await connectWs(stub);
      await runDurableObjectAlarm(stub);
      await waitFor(() => messages.some((m) => m.event === "error"));

      // Now set recovery mock and run retry
      mockExploreStep.mockResolvedValue({
        card: makeCard({ title: "Recovery Card" }),
        nextQuery: "recovered",
        nextReason: "back on track",
      });
      await runDurableObjectAlarm(stub);
      await waitFor(() =>
        messages.some(
          (m) =>
            m.event === "card" &&
            (m.data as Card).title === "Recovery Card"
        )
      );

      const cardEvent = messages.find(
        (m) =>
          m.event === "card" && (m.data as Card).title === "Recovery Card"
      );
      expect(cardEvent).toBeDefined();
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

  describe("viewer count", () => {
    it("broadcasts viewer count on first connection", async () => {
      const stub = getStub(uniqueName());
      const { messages } = await connectWs(stub);

      const viewersEvent = messages.find((m) => m.event === "viewers");
      expect(viewersEvent).toBeDefined();
      expect(viewersEvent!.data).toEqual({ count: 1 });
    });

    it("broadcasts updated count when a second viewer connects", async () => {
      const stub = getStub(uniqueName());
      const { messages: msgs1 } = await connectWs(stub);
      msgs1.length = 0;

      await connectWs(stub);
      await yieldEvent();

      // First viewer gets updated count of 2
      const viewersEvent = msgs1.find(
        (m) => m.event === "viewers" && (m.data as { count: number }).count === 2
      );
      expect(viewersEvent).toBeDefined();
    });

    it("broadcasts decreased count when a viewer disconnects", async () => {
      const stub = getStub(uniqueName());
      const { ws: ws1 } = await connectWs(stub);
      const { messages: msgs2 } = await connectWs(stub);
      msgs2.length = 0;

      ws1.close();
      await yieldEvent();

      const viewersEvent = msgs2.find(
        (m) => m.event === "viewers" && (m.data as { count: number }).count === 1
      );
      expect(viewersEvent).toBeDefined();
    });

    it("does not include viewer count in replay buffer", async () => {
      const stub = getStub(uniqueName());
      const { ws: ws1 } = await connectWs(stub);

      // Trigger at least one alarm so there are buffered events
      await runDurableObjectAlarm(stub);
      await yieldEvent();

      // Second viewer connects and gets replay
      const { messages: msgs2 } = await connectWs(stub);
      const historyEnd = msgs2.findIndex((m) => m.event === "history-end");
      const replay = msgs2.slice(0, historyEnd);

      // Replay should not contain viewers events
      expect(replay.some((m) => m.event === "viewers")).toBe(false);

      // But a live viewers event should arrive after history-end
      const liveViewers = msgs2.slice(historyEnd + 1).find((m) => m.event === "viewers");
      expect(liveViewers).toBeDefined();

      ws1.close();
    });
  });

  describe("exploration stats", () => {
    it("sends stats on connect", async () => {
      const stub = getStub(uniqueName());
      const { messages } = await connectWs(stub);

      const statsEvent = messages.find((m) => m.event === "stats");
      expect(statsEvent).toBeDefined();
      expect(statsEvent!.data).toEqual({
        totalCards: 0,
        roundsCompleted: 0,
        startedAt: null,
      });
    });

    it("sends stats after history-end on connect", async () => {
      const stub = getStub(uniqueName());
      const { messages } = await connectWs(stub);

      const historyEndIdx = messages.findIndex(
        (m) => m.event === "history-end"
      );
      const statsIdx = messages.findIndex((m) => m.event === "stats");

      expect(historyEndIdx).toBeGreaterThanOrEqual(0);
      expect(statsIdx).toBeGreaterThan(historyEndIdx);
    });

    it("increments totalCards after each card", async () => {
      const stub = getStub(uniqueName());
      const { messages } = await connectWs(stub);
      messages.length = 0;

      await runDurableObjectAlarm(stub);
      await waitFor(() => messages.some((m) => m.event === "stats"));

      const statsEvent = messages.find((m) => m.event === "stats");
      expect(statsEvent).toBeDefined();
      expect(
        (statsEvent!.data as { totalCards: number }).totalCards
      ).toBe(1);
    });

    it("increments roundsCompleted after a full round", async () => {
      const stub = getStub(uniqueName());
      const { messages } = await connectWs(stub);

      for (let i = 0; i < 12; i++) {
        mockExploreStep.mockResolvedValue({
          card: makeCard({ id: i + 1 }),
          nextQuery: `q${i + 2}`,
          nextReason: "continuing",
        });
        await runDurableObjectAlarm(stub);
      }
      await yieldEvent();

      // Find the last stats event (after the done event)
      const allStats = messages.filter((m) => m.event === "stats");
      const lastStats = allStats[allStats.length - 1];
      expect(lastStats).toBeDefined();
      expect(
        (lastStats!.data as { roundsCompleted: number }).roundsCompleted
      ).toBe(1);
      expect(
        (lastStats!.data as { totalCards: number }).totalCards
      ).toBe(12);
    });

    it("sets startedAt on first alarm", async () => {
      const stub = getStub(uniqueName());
      const { messages } = await connectWs(stub);
      messages.length = 0;

      await runDurableObjectAlarm(stub);
      await waitFor(() => messages.some((m) => m.event === "stats"));

      const statsEvent = messages.find((m) => m.event === "stats");
      expect(
        (statsEvent!.data as { startedAt: string | null }).startedAt
      ).toBeTruthy();
    });

    it("persists stats across connections", async () => {
      const stub = getStub(uniqueName());
      const { ws: ws1 } = await connectWs(stub);

      // Generate a card
      await runDurableObjectAlarm(stub);
      await yieldEvent();

      ws1.close();
      await yieldEvent();

      // New viewer sees persisted stats on connect
      const { messages: msgs2 } = await connectWs(stub);
      const statsEvent = msgs2.find((m) => m.event === "stats");
      expect(statsEvent).toBeDefined();
      expect(
        (statsEvent!.data as { totalCards: number }).totalCards
      ).toBeGreaterThanOrEqual(1);
    });

    it("does not include stats in replay buffer", async () => {
      const stub = getStub(uniqueName());
      const { ws: ws1 } = await connectWs(stub);

      await runDurableObjectAlarm(stub);
      await yieldEvent();

      const { messages: msgs2 } = await connectWs(stub);
      const historyEnd = msgs2.findIndex((m) => m.event === "history-end");
      const replay = msgs2.slice(0, historyEnd);

      expect(replay.some((m) => m.event === "stats")).toBe(false);

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
      // Block the alarm from producing events during this test
      mockPickSeed.mockReturnValue(new Promise(() => {}));

      const stub = getStub(uniqueName());
      const { ws, messages } = await connectWs(stub);
      messages.length = 0;

      ws.send("not json");
      ws.send(JSON.stringify({ type: "unknown" }));
      await yieldEvent();

      // No crash, no messages sent back (filter viewer broadcasts from alarm race)
      const responses = messages.filter((m) => {
        const event = (m as { event?: string }).event;
        return event !== "viewers";
      });
      expect(responses).toHaveLength(0);
    });
  });
});
