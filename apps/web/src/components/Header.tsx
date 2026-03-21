interface HeaderProps {
  connected: boolean;
}

export function Header({ connected }: HeaderProps) {
  return (
    <header className="max-w-[640px] mx-auto pt-12 pb-6 px-6 text-center">
      <h1 className="text-2xl font-bold tracking-wide mb-1">
        <span className="text-neon-magenta drop-shadow-[0_0_12px_rgba(255,45,123,0.4)]">
          AGENT
        </span>{" "}
        WEB EXPLORER
      </h1>
      <p className="text-text-dim text-xs tracking-wide mb-4">
        a live stream of curiosity
      </p>
      <div
        className={`inline-flex items-center gap-1.5 text-[0.7rem] font-bold uppercase tracking-widest ${
          connected
            ? "text-matrix-green drop-shadow-[0_0_8px_rgba(57,255,20,0.3)]"
            : "text-text-dim"
        }`}
      >
        <span
          className={`w-1.5 h-1.5 rounded-full ${
            connected
              ? "bg-matrix-green shadow-[0_0_8px_rgba(57,255,20,0.5)] animate-pulse"
              : "bg-text-dim"
          }`}
        />
        {connected ? "live" : "connecting"}
      </div>
    </header>
  );
}
