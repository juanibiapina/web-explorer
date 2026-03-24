import { useEffect, useState } from "react";
import type { StreamEvent } from "./useExplorerStream";

interface ExplorationResponse {
  date: string;
  seed: { query: string; reason: string } | null;
  cards: Array<{
    id: number;
    title: string;
    type: string;
    summary: string;
    url: string;
    whyInteresting: string;
    thread: { from: string; reasoning: string };
    details: Record<string, unknown>;
  }>;
  status: "generating" | "complete";
}

type ExplorationState =
  | { status: "loading"; events: StreamEvent[] }
  | { status: "error"; events: StreamEvent[]; error: string }
  | { status: "done"; events: StreamEvent[] };

/**
 * Fetches a completed exploration by date via REST.
 * Used for archive dates (not today). Converts the response
 * into the same StreamEvent[] format that the WebSocket hook produces,
 * so the Feed component doesn't need to know the difference.
 */
export function useExploration(date: string) {
  const [state, setState] = useState<ExplorationState>({
    status: "loading",
    events: [],
  });

  useEffect(() => {
    let cancelled = false;

    fetch(`/api/exploration/${date}`)
      .then((res) => {
        if (!res.ok) {
          if (res.status === 404) throw new Error("not-found");
          throw new Error(`HTTP ${res.status}`);
        }
        return res.json() as Promise<ExplorationResponse>;
      })
      .then((data) => {
        if (cancelled) return;

        const events: StreamEvent[] = [];

        if (data.seed) {
          events.push({ event: "seed", data: data.seed });
        }

        for (const card of data.cards) {
          events.push({ event: "card", data: card });
        }

        setState({ status: "done", events });
      })
      .catch((err) => {
        if (cancelled) return;
        setState({ status: "error", events: [], error: err.message });
      });

    return () => {
      cancelled = true;
      setState({ status: "loading", events: [] });
    };
  }, [date]);

  return {
    events: state.events,
    loading: state.status === "loading",
    error: state.status === "error" ? state.error : null,
  };
}
