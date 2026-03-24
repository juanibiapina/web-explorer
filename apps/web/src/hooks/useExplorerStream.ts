import { useCallback, useRef, useState } from "react";
import useWebSocket, { ReadyState } from "react-use-websocket";

export interface StreamEvent {
  event: string;
  data: unknown;
}

/**
 * Connects to an exploration's WebSocket stream.
 * Receives history replay on connect, then live events.
 *
 * On reconnect, the server replays stored events as history.
 * We collect those into a buffer and replace the entire event list
 * on "history-end" to avoid duplicates from previous connections.
 *
 * When the exploration is complete, the server sends a "done" event
 * and no more events will arrive.
 */
export function useExplorerStream(date?: string) {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const dateParam = date ? `?date=${date}` : "";
  const wsUrl = `${protocol}//${window.location.host}/api/stream${dateParam}`;

  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [done, setDone] = useState(false);
  const replayBuffer = useRef<StreamEvent[]>([]);
  const replaying = useRef(true);

  const onOpen = useCallback(() => {
    replayBuffer.current = [];
    replaying.current = true;
    setDone(false);
  }, []);

  const onMessage = useCallback((message: MessageEvent) => {
    const parsed: StreamEvent = JSON.parse(message.data);

    if (parsed.event === "history-end") {
      setEvents([...replayBuffer.current]);
      replayBuffer.current = [];
      replaying.current = false;
      return;
    }

    if (parsed.event === "done") {
      setDone(true);
      // Don't add to events - the Feed uses the `done` flag
      return;
    }

    if (replaying.current) {
      replayBuffer.current.push(parsed);
    } else {
      setEvents((prev) => [...prev, parsed]);
    }
  }, []);

  const { readyState } = useWebSocket(wsUrl, {
    shouldReconnect: () => !done,
    reconnectAttempts: Infinity,
    reconnectInterval: 3000,
    onOpen,
    onMessage,
  });

  return { events, connected: readyState === ReadyState.OPEN, done };
}
