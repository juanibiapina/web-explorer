import { useCallback, useState } from "react";
import useWebSocket, { ReadyState } from "react-use-websocket";

export interface StreamEvent {
  event: string;
  data: unknown;
}

/**
 * Connects to the shared exploration WebSocket stream.
 * Receives history replay on connect, then live events.
 */
export function useExplorerStream() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = `${protocol}//${window.location.host}/api/stream`;

  const [events, setEvents] = useState<StreamEvent[]>([]);

  const onMessage = useCallback((message: MessageEvent) => {
    const parsed: StreamEvent = JSON.parse(message.data);
    if (parsed.event === "history-end") return;
    setEvents((prev) => [...prev, parsed]);
  }, []);

  const { readyState } = useWebSocket(wsUrl, {
    shouldReconnect: () => true,
    reconnectAttempts: Infinity,
    reconnectInterval: 3000,
    onMessage,
  });

  return { events, connected: readyState === ReadyState.OPEN };
}
