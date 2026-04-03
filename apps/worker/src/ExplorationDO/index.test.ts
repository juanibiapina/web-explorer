/**
 * Integration tests for ExplorationDO.
 *
 * Uses @cloudflare/vitest-pool-workers to run inside workerd.
 * The agent module is mocked so no API keys are needed.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  env,
  runDurableObjectAlarm,
} from "cloudflare:test";

vi.mock("../explorer/agent", () => ({
  runAgentStep: vi.fn(),
}));

import { runAgentStep } from "../explorer/agent";
import type { ExplorationDO } from "./index";
import type { Card } from "../explorer/types";

/** Return type of ExplorationDO.getExploration(). */
interface ExplorationData {
  date: string;
  seed: { query: string; reason: string } | null;
  cards: Card[];
  status: "generating" | "complete" | "failed";
  error: string | null;
}

declare module "cloudflare:test" {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface ProvidedEnv extends Env {}
}

const mockRunAgentStep = vi.mocked(runAgentStep);

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
    mockRunAgentStep.mockImplementation(async (_messages, _cards, stepNum) => ({
      card: makeCard({ id: stepNum, title: `Card ${stepNum}` }),
      messages: [],
    }));
  });

  describe("start()", () => {
    it("sets up initial state and schedules alarm", async () => {
      const stub = getStub();
      await stub.start("2026-03-24");

      const ran = await runDurableObjectAlarm(stub);
      expect(ran).toBe(true);
    });

    it("restarts from scratch when called again", async () => {
      const stub = getStub();
      await stub.start("2026-03-24");

      // Run a few steps
      await runDurableObjectAlarm(stub);
      await runDurableObjectAlarm(stub);

      const before = (await stub.getExploration()) as ExplorationData | null;
      expect(before!.cards).toHaveLength(2);

      // Call start again — should reset
      await stub.start("2026-03-24");

      const after = (await stub.getExploration()) as ExplorationData | null;
      expect(after!.status).toBe("generating");
      expect(after!.cards).toHaveLength(0);
      expect(after!.seed).toBeNull();
      expect(after!.date).toBe("2026-03-24");

      // Alarm should be re-armed
      mockRunAgentStep.mockClear();
      const ran = await runDurableObjectAlarm(stub);
      expect(ran).toBe(true);
      expect(mockRunAgentStep).toHaveBeenCalledTimes(1);
    });

    it("restarts a completed exploration", async () => {
      const stub = getStub();
      await stub.start("2026-03-24");

      for (let i = 0; i < 12; i++) {
        await runDurableObjectAlarm(stub);
      }
      expect(((await stub.getExploration()) as ExplorationData | null)!.status).toBe("complete");

      await stub.start("2026-03-24");

      const data = (await stub.getExploration()) as ExplorationData | null;
      expect(data!.status).toBe("generating");
      expect(data!.cards).toHaveLength(0);

      // Alarm should fire and produce new cards
      await runDurableObjectAlarm(stub);
      expect(((await stub.getExploration()) as ExplorationData | null)!.cards).toHaveLength(1);
    });
  });

  describe("getExploration()", () => {
    it("returns null when exploration has not been started", async () => {
      const stub = getStub();
      const data = await stub.getExploration();
      expect(data).toBeNull();
    });

    it("returns exploration data after first step", async () => {
      const stub = getStub();
      await stub.start("2026-03-24");
      await runDurableObjectAlarm(stub);

      const data = (await stub.getExploration()) as ExplorationData | null;
      expect(data).not.toBeNull();
      expect(data!.date).toBe("2026-03-24");
      expect(data!.seed).not.toBeNull();
      expect(data!.cards).toHaveLength(1);
      expect(data!.status).toBe("generating");
      expect(data!.error).toBeNull();
    });

    it("returns complete status after all steps", async () => {
      const stub = getStub();
      await stub.start("2026-03-24");

      for (let i = 0; i < 12; i++) {
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

      for (let i = 0; i < 12; i++) {
        await runDurableObjectAlarm(stub);
      }

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
    it("derives seed from first card and broadcasts seed event", async () => {
      const stub = getStub();
      await stub.start("2026-03-24");
      const { messages } = await connectWs(stub);
      messages.length = 0;

      await runDurableObjectAlarm(stub);
      await yieldEvent();

      const seedEvent = messages.find((m) => m.event === "seed");
      expect(seedEvent).toBeDefined();
    });

    it("broadcasts status and card events during steps", async () => {
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
      });

      const cardEvent = messages.find((m) => m.event === "card");
      expect(cardEvent).toBeDefined();
      expect((cardEvent!.data as Card).title).toBe("Card 1");
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

      const ran = await runDurableObjectAlarm(stub);
      expect(ran).toBe(false);
    });

    it("runs to completion even without viewers", async () => {
      const stub = getStub();
      await stub.start("2026-03-24");

      for (let i = 0; i < 12; i++) {
        const ran = await runDurableObjectAlarm(stub);
        expect(ran).toBe(true);
      }

      const data = (await stub.getExploration()) as ExplorationData | null;
      expect(data!.status).toBe("complete");
      expect(data!.cards).toHaveLength(12);
    });

    it("passes conversation messages between steps", async () => {
      const fakeMessages = [{ role: "user" as const, content: "test" }];
      mockRunAgentStep.mockImplementation(async (_messages, _cards, stepNum) => ({
        card: makeCard({ id: stepNum }),
        messages: fakeMessages,
      }));

      const stub = getStub();
      await stub.start("2026-03-24");

      // Step 1
      await runDurableObjectAlarm(stub);

      // Step 2 should receive the messages from step 1
      mockRunAgentStep.mockClear();
      mockRunAgentStep.mockImplementation(async (_messages, _cards, stepNum) => ({
        card: makeCard({ id: stepNum }),
        messages: fakeMessages,
      }));
      await runDurableObjectAlarm(stub);

      const [passedMessages] = mockRunAgentStep.mock.calls[0];
      expect(passedMessages).toEqual(fakeMessages);
    });

    it("passes previous cards to agent for context", async () => {
      const stub = getStub();
      await stub.start("2026-03-24");

      // Step 1
      await runDurableObjectAlarm(stub);

      // Step 2 should receive the card from step 1
      mockRunAgentStep.mockClear();
      mockRunAgentStep.mockImplementation(async (_messages, _cards, stepNum) => ({
        card: makeCard({ id: stepNum }),
        messages: [],
      }));
      await runDurableObjectAlarm(stub);

      const [, passedCards] = mockRunAgentStep.mock.calls[0];
      expect(passedCards).toHaveLength(1);
      expect(passedCards[0].id).toBe(1);
    });
  });

  describe("error recovery", () => {
    it("broadcasts error when agent step fails", async () => {
      const stub = getStub();
      await stub.start("2026-03-24");

      mockRunAgentStep.mockRejectedValue(new Error("API timeout"));

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

      mockRunAgentStep.mockRejectedValue(new Error("API timeout"));

      await runDurableObjectAlarm(stub); // Fails, schedules retry

      const ran = await runDurableObjectAlarm(stub);
      expect(ran).toBe(true);
    });

    it("marks exploration as failed after 3 consecutive errors", async () => {
      const stub = getStub();
      await stub.start("2026-03-24");

      mockRunAgentStep.mockRejectedValue(new Error("persistent failure"));

      const { messages } = await connectWs(stub);

      for (let i = 0; i < 3; i++) {
        await runDurableObjectAlarm(stub);
        await yieldEvent();
      }

      const failError = messages.find(
        (m) =>
          m.event === "error" &&
          typeof (m.data as { message: string }).message === "string" &&
          (m.data as { message: string }).message.includes("failed after 3 attempts")
      );
      expect(failError).toBeDefined();

      const data = (await stub.getExploration()) as ExplorationData | null;
      expect(data!.status).toBe("failed");
      expect(data!.error).toBe("persistent failure");

      const ran = await runDurableObjectAlarm(stub);
      expect(ran).toBe(false);
    });

    it("clears error on restart", async () => {
      const stub = getStub();
      await stub.start("2026-03-24");

      mockRunAgentStep.mockRejectedValue(new Error("persistent failure"));

      for (let i = 0; i < 3; i++) {
        await runDurableObjectAlarm(stub);
      }
      expect(((await stub.getExploration()) as ExplorationData | null)!.error).toBe("persistent failure");

      mockRunAgentStep.mockImplementation(async (_messages, _cards, stepNum) => ({
        card: makeCard({ id: stepNum }),
        messages: [],
      }));
      await stub.start("2026-03-24");

      const data = (await stub.getExploration()) as ExplorationData | null;
      expect(data!.status).toBe("generating");
      expect(data!.error).toBeNull();
    });

    it("recovers after a transient error", async () => {
      const stub = getStub();
      await stub.start("2026-03-24");

      mockRunAgentStep.mockRejectedValue(new Error("transient"));

      const { messages } = await connectWs(stub);
      await runDurableObjectAlarm(stub);
      await waitFor(() => messages.some((m) => m.event === "error"));

      mockRunAgentStep.mockImplementation(async (_messages, _cards, stepNum) => ({
        card: makeCard({ id: stepNum, title: "Recovery Card" }),
        messages: [],
      }));
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
      const stub = getStub();
      const { ws, messages } = await connectWs(stub);
      messages.length = 0;

      ws.send("not json");
      ws.send(JSON.stringify({ type: "unknown" }));
      await yieldEvent();

      expect(messages).toHaveLength(0);
    });
  });
});
