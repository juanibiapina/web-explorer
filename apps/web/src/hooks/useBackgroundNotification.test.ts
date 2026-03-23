import { renderHook } from "@testing-library/react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { useBackgroundNotification } from "./useBackgroundNotification";
import type { StreamEvent } from "./useExplorerStream";

function card(id: number): StreamEvent {
  return {
    event: "card",
    data: {
      id,
      title: `Card ${id}`,
      type: "article",
      summary: "test",
      url: "https://example.com",
      whyInteresting: "test",
    },
  };
}

function seed(query: string): StreamEvent {
  return { event: "seed", data: { query } };
}

function setHidden(hidden: boolean) {
  Object.defineProperty(document, "hidden", {
    value: hidden,
    writable: true,
    configurable: true,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("useBackgroundNotification", () => {
  beforeEach(() => {
    document.title = "Agent Web Explorer";
    setHidden(false);
  });

  afterEach(() => {
    setHidden(false);
    vi.restoreAllMocks();
  });

  it("does not change title when tab is visible", () => {
    const events: StreamEvent[] = [card(1)];
    const { rerender } = renderHook(
      ({ e }) => useBackgroundNotification(e),
      { initialProps: { e: [] as StreamEvent[] } },
    );

    rerender({ e: events });
    expect(document.title).toBe("Agent Web Explorer");
  });

  it("updates title with card count when tab is hidden", () => {
    const { rerender } = renderHook(
      ({ e }) => useBackgroundNotification(e),
      { initialProps: { e: [] as StreamEvent[] } },
    );

    setHidden(true);
    rerender({ e: [card(1)] });
    expect(document.title).toBe("(1) Agent Web Explorer");

    rerender({ e: [card(1), card(2)] });
    expect(document.title).toBe("(2) Agent Web Explorer");
  });

  it("only counts card events, not seed or status", () => {
    const { rerender } = renderHook(
      ({ e }) => useBackgroundNotification(e),
      { initialProps: { e: [] as StreamEvent[] } },
    );

    setHidden(true);
    rerender({ e: [seed("test"), card(1)] });
    expect(document.title).toBe("(1) Agent Web Explorer");
  });

  it("resets title when tab becomes visible", () => {
    const { rerender } = renderHook(
      ({ e }) => useBackgroundNotification(e),
      { initialProps: { e: [] as StreamEvent[] } },
    );

    setHidden(true);
    rerender({ e: [card(1), card(2)] });
    expect(document.title).toBe("(2) Agent Web Explorer");

    setHidden(false);
    expect(document.title).toBe("Agent Web Explorer");
  });

  it("does not count events from before the tab was hidden", () => {
    const initial = [card(1), card(2)];
    const { rerender } = renderHook(
      ({ e }) => useBackgroundNotification(e),
      { initialProps: { e: initial } },
    );

    setHidden(true);
    rerender({ e: [...initial, card(3)] });
    expect(document.title).toBe("(1) Agent Web Explorer");
  });

  it("handles reconnect (events array shrinks) without false counts", () => {
    const initial = [card(1), card(2), card(3)];
    const { rerender } = renderHook(
      ({ e }) => useBackgroundNotification(e),
      { initialProps: { e: initial } },
    );

    setHidden(true);

    // Reconnect replays fewer events
    rerender({ e: [card(1), card(2)] });
    expect(document.title).toBe("Agent Web Explorer");

    // New card after reconnect
    rerender({ e: [card(1), card(2), card(4)] });
    expect(document.title).toBe("(1) Agent Web Explorer");
  });
});
