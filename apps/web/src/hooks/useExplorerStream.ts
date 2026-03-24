import { useCallback, useRef, useState } from "react";
import useWebSocket, { ReadyState } from "react-use-websocket";

export interface StreamEvent {
  event: string;
  data: unknown;
}

export interface ExplorerStats {
  totalCards: number;
  roundsCompleted: number;
  startedAt: string | null;
}

/**
 * Connects to the shared exploration WebSocket stream.
 * Receives history replay on connect, then live events.
 *
 * On reconnect, the server replays the last N events as history.
 * We collect those into a buffer and replace the entire event list
 * on "history-end" to avoid duplicates from previous connections.
 */
export function useExplorerStream() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = `${protocol}//${window.location.host}/api/stream`;

  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [viewerCount, setViewerCount] = useState(0);
  const [stats, setStats] = useState<ExplorerStats | null>(null);
  const replayBuffer = useRef<StreamEvent[]>([]);
  const replaying = useRef(true);

  const onOpen = useCallback(() => {
    replayBuffer.current = [];
    replaying.current = true;
  }, []);

  const onMessage = useCallback((message: MessageEvent) => {
    const parsed: StreamEvent = JSON.parse(message.data);

    if (parsed.event === "history-end") {
      // Replace events with the replayed history, discarding stale state
      setEvents([...replayBuffer.current]);
      replayBuffer.current = [];
      replaying.current = false;
      return;
    }

    // Viewer count is live-only, not part of the event feed
    if (parsed.event === "viewers") {
      setViewerCount((parsed.data as { count: number }).count);
      return;
    }

    // Stats are live-only, not part of the event feed
    if (parsed.event === "stats") {
      setStats(parsed.data as ExplorerStats);
      return;
    }

    if (replaying.current) {
      replayBuffer.current.push(parsed);
    } else {
      setEvents((prev) => [...prev, parsed]);
    }
  }, []);

  const { readyState } = useWebSocket(wsUrl, {
    shouldReconnect: () => true,
    reconnectAttempts: Infinity,
    reconnectInterval: 3000,
    onOpen,
    onMessage,
  });

  return {
    events,
    viewerCount,
    stats,
    connected: readyState === ReadyState.OPEN,
  };
}
