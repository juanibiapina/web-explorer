export type HeaderStatus = "connecting" | "generating" | "complete" | "loading" | "error";

interface HeaderProps {
  date: string;
  today: string;
  status: HeaderStatus;
  onPrev: () => void;
  onNext: (() => void) | null;
}

function formatDate(date: string): string {
  const d = new Date(date + "T00:00:00Z");
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

const STATUS_CONFIG: Record<HeaderStatus, { label: string; className: string; pulse: boolean }> = {
  connecting: {
    label: "connecting",
    className: "text-text-dim",
    pulse: false,
  },
  generating: {
    label: "generating",
    className: "text-neon-magenta drop-shadow-[0_0_8px_rgba(255,45,123,0.3)]",
    pulse: true,
  },
  complete: {
    label: "complete",
    className: "text-matrix-green drop-shadow-[0_0_8px_rgba(57,255,20,0.3)]",
    pulse: false,
  },
  loading: {
    label: "loading",
    className: "text-text-dim",
    pulse: true,
  },
  error: {
    label: "error",
    className: "text-red-400",
    pulse: false,
  },
};

export function Header({ date, today, status, onPrev, onNext }: HeaderProps) {
  const isToday = date === today;
  const { label, className, pulse } = STATUS_CONFIG[status];

  return (
    <header className="max-w-[640px] mx-auto pt-8 pb-4 px-4 sm:pt-12 sm:pb-6 sm:px-6 text-center">
      <h1 className="text-2xl font-bold tracking-wide mb-1">
        <span className="text-neon-magenta drop-shadow-[0_0_12px_rgba(255,45,123,0.4)]">
          AGENT
        </span>{" "}
        WEB EXPLORER
      </h1>
      <p className="text-text-dim text-xs tracking-wide mb-4">
        a live stream of curiosity
      </p>

      {/* Date navigation */}
      <div className="inline-flex items-center gap-4 mb-3">
        <button
          onClick={onPrev}
          className="text-text-dim hover:text-electric-cyan active:text-electric-cyan transition-colors text-sm px-1"
          aria-label="Previous day"
        >
          &larr;
        </button>
        <span className="text-sm text-text-primary font-bold tracking-wide">
          {isToday ? "Today" : formatDate(date)}
        </span>
        {onNext ? (
          <button
            onClick={onNext}
            className="text-text-dim hover:text-electric-cyan active:text-electric-cyan transition-colors text-sm px-1"
            aria-label="Next day"
          >
            &rarr;
          </button>
        ) : (
          <span className="text-sm px-1 invisible">&rarr;</span>
        )}
      </div>

      {/* Status */}
      <div className="flex justify-center">
        <div className={`inline-flex items-center gap-1.5 text-[0.7rem] font-bold uppercase tracking-widest ${className}`}>
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              status === "generating"
                ? "bg-neon-magenta shadow-[0_0_8px_rgba(255,45,123,0.5)] animate-pulse"
                : status === "complete"
                  ? "bg-matrix-green shadow-[0_0_8px_rgba(57,255,20,0.5)]"
                  : status === "error"
                    ? "bg-red-400"
                    : "bg-text-dim"
            } ${pulse ? "animate-pulse" : ""}`}
          />
          {label}
        </div>
      </div>
    </header>
  );
}
