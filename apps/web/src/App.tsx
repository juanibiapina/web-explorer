import { useCallback } from "react";
import { Feed } from "./components/Feed";
import { Header } from "./components/Header";
import { useBackgroundNotification } from "./hooks/useBackgroundNotification";
import { useExplorerStream } from "./hooks/useExplorerStream";
import { useExploration } from "./hooks/useExploration";

function todayUTC(): string {
  return new Date().toISOString().split("T")[0];
}

function getDateParam(): string | null {
  const params = new URLSearchParams(window.location.search);
  return params.get("date");
}

function navigateToDate(date: string | null) {
  const url = date ? `?date=${date}` : "/";
  window.history.pushState({}, "", url);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

/**
 * Shift a YYYY-MM-DD date string by `days` days.
 */
function shiftDate(date: string, days: number): string {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split("T")[0];
}

export function App() {
  const today = todayUTC();
  const date = getDateParam() ?? today;
  const isToday = date === today;

  const onNavigate = useCallback((date: string) => {
    navigateToDate(date === today ? null : date);
  }, [today]);

  return isToday ? (
    <TodayView date={date} today={today} onNavigate={onNavigate} />
  ) : (
    <ArchiveView date={date} today={today} onNavigate={onNavigate} />
  );
}

function TodayView({ date, today, onNavigate }: { date: string; today: string; onNavigate: (d: string) => void }) {
  const { events, connected, done } = useExplorerStream();
  useBackgroundNotification(events);

  const generating = connected && !done;

  return (
    <div className="min-h-screen">
      <Header
        date={date}
        today={today}
        status={!connected ? "connecting" : generating ? "generating" : "complete"}
        onPrev={() => onNavigate(shiftDate(date, -1))}
        onNext={null}
      />
      <Feed events={events} generating={generating} />
    </div>
  );
}

function ArchiveView({ date, today, onNavigate }: { date: string; today: string; onNavigate: (d: string) => void }) {
  const { events, loading, error } = useExploration(date);

  const nextDate = shiftDate(date, 1);
  const canGoNext = nextDate <= today;

  return (
    <div className="min-h-screen">
      <Header
        date={date}
        today={today}
        status={loading ? "loading" : error ? "error" : "complete"}
        onPrev={() => onNavigate(shiftDate(date, -1))}
        onNext={canGoNext ? () => onNavigate(nextDate) : null}
      />
      {error === "not-found" ? (
        <EmptyState message="No exploration for this date" />
      ) : error ? (
        <EmptyState message={`Failed to load: ${error}`} />
      ) : (
        <Feed events={events} generating={false} />
      )}
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="max-w-[640px] mx-auto px-4 sm:px-6 text-center py-24">
      <p className="text-text-dim text-sm">{message}</p>
    </div>
  );
}
