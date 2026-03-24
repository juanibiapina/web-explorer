/**
 * Integration tests for ExplorationDO.
 *
 * Uses @cloudflare/vitest-pool-workers to run inside workerd.
 * Exploration functions are mocked so no API keys are needed.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  env,
  runDurableObjectAlarm,
} from "cloudflare:test";

vi.mock("../explorer/explore", () => ({
  pickSeed: vi.fn(),
  exploreStep: vi.fn(),
}));

vi.mock("../explorer/follow", () => ({
  followStep: vi.fn(),
  pickLink: vi.fn(),
}));

import { pickSeed, exploreStep } from "../explorer/explore";
import { followStep, pickLink } from "../explorer/follow";
import type { ExplorationDO } from "./index";
import type { Card } from "../explorer/types";

/** Return type of ExplorationDO.getExploration(), spelled out for RPC stubs. */
interface ExplorationData {
  date: string;
  seed: { query: string; reason: string } | null;
  cards: Card[];
  status: "generating" | "complete";
}

declare module "cloudflare:test" {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface ProvidedEnv extends Env {}
}

const mockPickSeed = vi.mocked(pickSeed);
const mockExploreStep = vi.mocked(exploreStep);
const mockFollowStep = vi.mocked(followStep);
const mockPickLink = vi.mocked(pickLink);

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

function getStub(): DurableObjectStub<ExplorationDO> {
  const id = env.EXPLORATION_DO.newUniqueId();
  return env.EXPLORATION_DO.get(id);
}

/**
 * Connect a WebSocket to the DO and collect messages into an array.
 * Waits briefly for buffered messages (replay) to arrive.
 */
async function connectWs(stub: DurableObjectStub<ExplorationDO>) {
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

describe("ExplorationDO", () => {
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

  describe("start()", () => {
    it("sets up initial state and schedules alarm", async () => {
      const stub = getStub();
      await stub.start("2026-03-24");

      const ran = await runDurableObjectAlarm(stub);
      expect(ran).toBe(true);
    });

    it("is idempotent — calling start twice does not reset", async () => {
      const stub = getStub();
      await stub.start("2026-03-24");

      // Run first alarm (picks seed, does step 1)
      await runDurableObjectAlarm(stub);

      // Call start again — should be a no-op
      await stub.start("2026-03-24");

      // Run next alarm — should continue at step 2, not restart
      await runDurableObjectAlarm(stub);

      expect(mockPickSeed).toHaveBeenCalledTimes(1);
    });
  });

  describe("getExploration()", () => {
    it("returns null when exploration has not been started", async () => {
      const stub = getStub();
      const data = await stub.getExploration();
      expect(data).toBeNull();
    });

    it("returns exploration data after start", async () => {
      const stub = getStub();
      await stub.start("2026-03-24");
      await runDurableObjectAlarm(stub);

      const data = (await stub.getExploration()) as ExplorationData | null;
      expect(data).not.toBeNull();
      expect(data!.date).toBe("2026-03-24");
      expect(data!.seed).toEqual({ query: "test seed query", reason: "testing" });
      expect(data!.cards).toHaveLength(1);
      expect(data!.status).toBe("generating");
    });

    it("returns complete status after all steps", async () => {
      const stub = getStub();
      await stub.start("2026-03-24");

      for (let i = 0; i < 12; i++) {
        mockExploreStep.mockResolvedValue({
          card: makeCard({ id: i + 1 }),
          nextQuery: `q${i + 2}`,
          nextReason: "continuing",
        });
        await runDurableObjectAlarm(stub);
      }

      const data = (await stub.getExploration()) as ExplorationData | null;
      expect(data!.status).toBe("complete");
      expect(data!.cards).toHaveLength(12);
    });
  });

  describe("WebSocket upgrade", () => {
    it("rejects non-WebSocket requests with 426", async () => {
      const stub = getStub();
      const resp = await stub.fetch("http://fake/ws");
      expect(resp.status).toBe(426);
    });

    it("accepts WebSocket upgrades with 101", async () => {
      const stub = getStub();
      const resp = await stub.fetch("http://fake/ws", {
        headers: { Upgrade: "websocket" },
      });
      expect(resp.status).toBe(101);
      expect(resp.webSocket).toBeTruthy();
    });
  });

  describe("WebSocket replay", () => {
    it("sends history-end to new connections before any exploration", async () => {
      const stub = getStub();
      const { messages } = await connectWs(stub);

      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual({ event: "history-end", data: {} });
    });

    it("replays seed and cards from storage", async () => {
      const stub = getStub();
      await stub.start("2026-03-24");

      // Run a couple of steps
      await runDurableObjectAlarm(stub);
      await runDurableObjectAlarm(stub);

      // New viewer connects and gets replay
      const { messages } = await connectWs(stub);

      const historyEnd = messages.findIndex((m) => m.event === "history-end");
      expect(historyEnd).toBeGreaterThan(0);

      const replay = messages.slice(0, historyEnd);
      expect(replay.some((m) => m.event === "seed")).toBe(true);
      expect(replay.filter((m) => m.event === "card")).toHaveLength(2);
    });

    it("sends done after history-end for completed explorations", async () => {
      const stub = getStub();
      await stub.start("2026-03-24");

      // Complete all 12 steps
      for (let i = 0; i < 12; i++) {
        mockExploreStep.mockResolvedValue({
          card: makeCard({ id: i + 1 }),
          nextQuery: `q${i + 2}`,
          nextReason: "continuing",
        });
        await runDurableObjectAlarm(stub);
      }

      // New viewer connects to a completed exploration
      const { messages } = await connectWs(stub);

      const historyEnd = messages.findIndex((m) => m.event === "history-end");
      const afterHistory = messages.slice(historyEnd + 1);
      expect(afterHistory.some((m) => m.event === "done")).toBe(true);
    });

    it("does not send done after history-end for generating explorations", async () => {
      const stub = getStub();
      await stub.start("2026-03-24");
      await runDurableObjectAlarm(stub); // Step 1

      const { messages } = await connectWs(stub);

      const historyEnd = messages.findIndex((m) => m.event === "history-end");
      const afterHistory = messages.slice(historyEnd + 1);
      expect(afterHistory.some((m) => m.event === "done")).toBe(false);
    });
  });

  describe("alarm loop", () => {
    it("picks seed and broadcasts seed event on first alarm", async () => {
      const stub = getStub();
      await stub.start("2026-03-24");
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
      const stub = getStub();
      await stub.start("2026-03-24");
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
      const stub = getStub();
      await stub.start("2026-03-24");
      const { messages: msgs1 } = await connectWs(stub);
      const { messages: msgs2 } = await connectWs(stub);
      msgs1.length = 0;
      msgs2.length = 0;

      await runDurableObjectAlarm(stub);
      await yieldEvent();

      expect(msgs1.some((m) => m.event === "card")).toBe(true);
      expect(msgs2.some((m) => m.event === "card")).toBe(true);
    });

    it("broadcasts done after completing all 12 steps", async () => {
      const stub = getStub();
      await stub.start("2026-03-24");
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

    it("does not schedule another alarm after completion", async () => {
      const stub = getStub();
      await stub.start("2026-03-24");

      for (let i = 0; i < 12; i++) {
        await runDurableObjectAlarm(stub);
      }

      // No more alarms should be scheduled
      const ran = await runDurableObjectAlarm(stub);
      expect(ran).toBe(false);
    });

    it("runs to completion even without viewers", async () => {
      const stub = getStub();
      await stub.start("2026-03-24");

      // No WebSocket connections, just run all alarms
      for (let i = 0; i < 12; i++) {
        const ran = await runDurableObjectAlarm(stub);
        expect(ran).toBe(true);
      }

      const data = (await stub.getExploration()) as ExplorationData | null;
      expect(data!.status).toBe("complete");
      expect(data!.cards).toHaveLength(12);
    });
  });

  describe("error recovery", () => {
    it("broadcasts error when exploration step fails", async () => {
      const stub = getStub();
      await stub.start("2026-03-24");

      mockExploreStep.mockRejectedValue(new Error("API timeout"));

      const { messages } = await connectWs(stub);
      await runDurableObjectAlarm(stub);
      await waitFor(() => messages.some((m) => m.event === "error"));

      const errorEvent = messages.find((m) => m.event === "error");
      expect(errorEvent).toBeDefined();
      expect(errorEvent!.data).toMatchObject({ message: "API timeout" });
    });

    it("schedules retry alarm after error", async () => {
      const stub = getStub();
      await stub.start("2026-03-24");

      mockExploreStep.mockRejectedValue(new Error("API timeout"));

      await runDurableObjectAlarm(stub); // Fails, schedules retry

      const ran = await runDurableObjectAlarm(stub);
      expect(ran).toBe(true);
    });

    it("resets seed after 3 consecutive errors", async () => {
      const stub = getStub();
      await stub.start("2026-03-24");

      mockExploreStep.mockRejectedValue(new Error("persistent failure"));

      const { messages } = await connectWs(stub);

      for (let i = 0; i < 3; i++) {
        await runDurableObjectAlarm(stub);
        await yieldEvent();
      }

      const resetError = messages.find(
        (m) =>
          m.event === "error" &&
          typeof (m.data as { message: string }).message === "string" &&
          (m.data as { message: string }).message.includes("new seed")
      );
      expect(resetError).toBeDefined();

      // Next alarm should pick a fresh seed
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
      const stub = getStub();
      await stub.start("2026-03-24");

      mockExploreStep.mockRejectedValue(new Error("transient"));

      const { messages } = await connectWs(stub);
      await runDurableObjectAlarm(stub);
      await waitFor(() => messages.some((m) => m.event === "error"));

      mockExploreStep.mockResolvedValue({
        card: makeCard({ title: "Recovery Card" }),
        nextQuery: "recovered",
        nextReason: "back on track",
      });
      await runDurableObjectAlarm(stub);
      await waitFor(() =>
        messages.some(
          (m) => m.event === "card" && (m.data as Card).title === "Recovery Card"
        )
      );

      const cardEvent = messages.find(
        (m) => m.event === "card" && (m.data as Card).title === "Recovery Card"
      );
      expect(cardEvent).toBeDefined();
    });
  });

  describe("WebSocket messages", () => {
    it("responds to ping with pong", async () => {
      const stub = getStub();
      const { ws, messages } = await connectWs(stub);
      messages.length = 0;

      ws.send(JSON.stringify({ type: "ping" }));
      await yieldEvent();

      const pong = messages.find((m) => m.type === "pong");
      expect(pong).toBeDefined();
    });

    it("ignores malformed messages", async () => {
      // Block alarm from producing events
      mockPickSeed.mockReturnValue(new Promise(() => {}));

      const stub = getStub();
      await stub.start("2026-03-24");
      const { ws, messages } = await connectWs(stub);
      messages.length = 0;

      ws.send("not json");
      ws.send(JSON.stringify({ type: "unknown" }));
      await yieldEvent();

      expect(messages).toHaveLength(0);
    });
  });

  describe("follow mode", () => {
    beforeEach(() => {
      mockFollowStep.mockResolvedValue({
        card: makeCard({ title: "Followed Card", url: "https://example.com/linked-page" }),
        follow: {
          type: "url",
          value: "https://example.com/next-link",
          reasoning: "Another tangent",
        },
      });
      mockPickLink.mockResolvedValue({
        type: "url",
        value: "https://example.com/linked-page",
        reasoning: "Found an interesting tangent",
      });
    });

    it("step 1 uses search then picks a link for the follow chain", async () => {
      const stub = getStub();
      await stub.start("2026-03-24", "follow");

      const { messages } = await connectWs(stub);
      messages.length = 0;

      // Step 1: pickSeed + exploreStep + pickLink
      await runDurableObjectAlarm(stub);
      await yieldEvent();

      // Should have called exploreStep for the first card
      expect(mockExploreStep).toHaveBeenCalled();
      // And pickLink to find the first link to follow
      expect(mockPickLink).toHaveBeenCalled();

      const cardEvent = messages.find((m) => m.event === "card");
      expect(cardEvent).toBeDefined();
      expect((cardEvent!.data as Card).title).toBe("Test Card");
    });

    it("step 2+ uses followStep on the URL from pickLink", async () => {
      const stub = getStub();
      await stub.start("2026-03-24", "follow");

      // Step 1: search-based
      await runDurableObjectAlarm(stub);

      // Clear counts so we only see step 2's calls
      mockFollowStep.mockClear();
      mockFollowStep.mockResolvedValue({
        card: makeCard({ title: "Followed Card", url: "https://example.com/linked-page" }),
        follow: {
          type: "url",
          value: "https://example.com/next-link",
          reasoning: "Another tangent",
        },
      });

      // Step 2: should use followStep
      await runDurableObjectAlarm(stub);

      expect(mockFollowStep).toHaveBeenCalledTimes(1);
      expect(mockFollowStep).toHaveBeenCalledWith(
        "https://example.com/linked-page",
        expect.any(Array),
        2,
        expect.any(Object)
      );
    });

    it("chains follow steps using the follow target from each step", async () => {
      const stub = getStub();
      await stub.start("2026-03-24", "follow");

      // Step 1
      await runDurableObjectAlarm(stub);

      // Step 2: follows the URL from pickLink
      mockFollowStep.mockResolvedValue({
        card: makeCard({ id: 2, title: "Page B" }),
        follow: {
          type: "url",
          value: "https://example.com/page-c",
          reasoning: "Wild tangent",
        },
      });
      await runDurableObjectAlarm(stub);

      // Clear to isolate step 3
      mockFollowStep.mockClear();

      // Step 3: should follow the URL from step 2's follow target
      mockFollowStep.mockResolvedValue({
        card: makeCard({ id: 3, title: "Page C" }),
        follow: {
          type: "url",
          value: "https://example.com/page-d",
          reasoning: "Even wilder",
        },
      });
      await runDurableObjectAlarm(stub);

      expect(mockFollowStep).toHaveBeenCalledTimes(1);
      // Step 3 should follow page-c (from step 2's follow)
      expect(mockFollowStep).toHaveBeenCalledWith(
        "https://example.com/page-c",
        expect.any(Array),
        3,
        expect.any(Object)
      );
    });

    it("falls back to search when follow returns a search query", async () => {
      const stub = getStub();
      await stub.start("2026-03-24", "follow");

      // Step 1
      await runDurableObjectAlarm(stub);

      // Step 2: follows URL, returns search fallback
      mockFollowStep.mockResolvedValue({
        card: makeCard({ id: 2 }),
        follow: {
          type: "search",
          value: "Richard Feynman cargo cult science",
          reasoning: "Page mentions Feynman but has no link",
        },
      });
      await runDurableObjectAlarm(stub);

      // Clear to isolate step 3
      mockExploreStep.mockClear();
      mockPickLink.mockClear();

      // Step 3: should fall back to exploreStep with the search query
      mockExploreStep.mockResolvedValue({
        card: makeCard({ id: 3, title: "Feynman Card", url: "https://example.com/feynman" }),
        nextQuery: "next",
        nextReason: "continuing",
      });
      mockPickLink.mockResolvedValue({
        type: "url",
        value: "https://example.com/feynman-link",
        reasoning: "Found a link",
      });
      await runDurableObjectAlarm(stub);

      // Step 3 used exploreStep (search fallback) + pickLink (to resume follow)
      expect(mockExploreStep).toHaveBeenCalledTimes(1);
      expect(mockExploreStep).toHaveBeenCalledWith(
        "Richard Feynman cargo cult science",
        expect.any(Array),
        3,
        expect.any(Object)
      );
      expect(mockPickLink).toHaveBeenCalledTimes(1);
    });

    it("completes after 12 steps in follow mode", async () => {
      const stub = getStub();
      await stub.start("2026-03-24", "follow");

      for (let i = 0; i < 12; i++) {
        mockFollowStep.mockResolvedValue({
          card: makeCard({ id: i + 1, title: `Card ${i + 1}` }),
          follow: {
            type: "url",
            value: `https://example.com/page-${i + 2}`,
            reasoning: "tangent",
          },
        });
        await runDurableObjectAlarm(stub);
      }

      const data = (await stub.getExploration()) as ExplorationData | null;
      expect(data!.status).toBe("complete");
      expect(data!.cards).toHaveLength(12);
    });

    it("broadcasts cards to WebSocket viewers in follow mode", async () => {
      const stub = getStub();
      await stub.start("2026-03-24", "follow");
      const { messages } = await connectWs(stub);
      messages.length = 0;

      // Step 1 (search)
      await runDurableObjectAlarm(stub);
      await yieldEvent();

      // Step 2 (follow)
      await runDurableObjectAlarm(stub);
      await yieldEvent();

      const cards = messages.filter((m) => m.event === "card");
      expect(cards).toHaveLength(2);
      expect((cards[0].data as Card).title).toBe("Test Card"); // From search
      expect((cards[1].data as Card).title).toBe("Followed Card"); // From follow
    });
  });
});
