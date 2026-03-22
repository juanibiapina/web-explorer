import { useEffect, useRef } from "react";
import type { StreamEvent } from "./useExplorerStream";

const BASE_TITLE = "Agent Web Explorer";

/**
 * Updates the document title with a count of new cards found
 * while the tab is in the background. Resets when the tab
 * becomes visible again.
 */
export function useBackgroundNotification(events: StreamEvent[]) {
  const prevLength = useRef(events.length);
  const unseenCards = useRef(0);

  useEffect(() => {
    if (!document.hidden) {
      prevLength.current = events.length;
      return;
    }

    // Events might shrink on reconnect (history replay replaces the array).
    // Reset baseline without counting those as new.
    if (events.length < prevLength.current) {
      prevLength.current = events.length;
      return;
    }

    const newCards = events
      .slice(prevLength.current)
      .filter((e) => e.event === "card").length;
    unseenCards.current += newCards;
    prevLength.current = events.length;

    if (unseenCards.current > 0) {
      document.title = `(${unseenCards.current}) ${BASE_TITLE}`;
    }
  }, [events]);

  useEffect(() => {
    function onVisibilityChange() {
      if (!document.hidden) {
        unseenCards.current = 0;
        document.title = BASE_TITLE;
      }
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () =>
      document.removeEventListener("visibilitychange", onVisibilityChange);
  }, []);
}
