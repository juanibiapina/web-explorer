import { useEffect, useState } from "react";
import useWebSocket, { ReadyState } from "react-use-websocket";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface StreamEvent {
  event: string;
  data: any;
}

/**
 * Connects to the shared exploration WebSocket stream.
 * Receives history replay on connect, then live events.
 */
export function useExplorerStream() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = `${protocol}//${window.location.host}/api/stream`;

  const [events, setEvents] = useState<StreamEvent[]>([]);
  const { lastJsonMessage, readyState } = useWebSocket<StreamEvent>(wsUrl, {
    shouldReconnect: () => true,
    reconnectAttempts: Infinity,
    reconnectInterval: 3000,
  });

  useEffect(() => {
    if (!lastJsonMessage) return;
    if (lastJsonMessage.event === "history-end") return;
    setEvents((prev) => [...prev, lastJsonMessage]);
  }, [lastJsonMessage]);

  return { events, connected: readyState === ReadyState.OPEN };
}
