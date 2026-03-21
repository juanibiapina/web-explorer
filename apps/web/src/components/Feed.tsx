import { useEffect, useRef } from "react";
import type { StreamEvent } from "../hooks/useExplorerStream";
import { Card } from "./Card";

const TYPE_COLORS: Record<string, string> = {
  article: "border-l-electric-cyan",
  repo: "border-l-matrix-green",
  person: "border-l-purple-haze",
  thread: "border-l-amber",
  paper: "border-l-paper-blue",
  tool: "border-l-electric-cyan",
  video: "border-l-neon-magenta",
  community: "border-l-hot-pink",
};

interface FeedProps {
  events: StreamEvent[];
}

export function Feed({ events }: FeedProps) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [events.length]);

  return (
    <main className="max-w-[640px] mx-auto px-6 pb-24">
      {events.map((e, i) => {
        switch (e.event) {
          case "seed":
            return <SeedBanner key={i} data={e.data as SeedData} />;
          case "status":
            return <Status key={`status-${i}`} data={e.data as StatusData} />;
          case "card":
            return (
              <CardEntry
                key={i}
                data={e.data as CardData}
                showThread={i > 0}
              />
            );
          case "error":
            return (
              <div key={i} className="text-center py-4 text-red-400 text-sm animate-in fade-in">
                ! {(e.data as { message: string }).message}
              </div>
            );
          default:
            return null;
        }
      })}
      <div ref={endRef} />
    </main>
  );
}

interface SeedData {
  query: string;
  reason?: string;
}

function SeedBanner({ data }: { data: SeedData }) {
  return (
    <div className="text-center py-6 mt-2 relative animate-in fade-in">
      <div className="text-[0.95rem] font-bold text-matrix-green drop-shadow-[0_0_8px_rgba(57,255,20,0.3)]">
        &gt; {data.query}
      </div>
      {data.reason && (
        <div className="text-xs text-text-dim mt-1">{data.reason}</div>
      )}
    </div>
  );
}

interface StatusData {
  step: number;
  total: number;
  query: string;
}

function Status({ data }: { data: StatusData }) {
  return (
    <div className="text-center py-4 text-text-dim text-sm animate-in fade-in">
      [{data.step}/{data.total}] searching{" "}
      <span className="text-electric-cyan font-semibold">{data.query}</span>
      <span className="inline-flex">
        <span className="animate-pulse">.</span>
        <span className="animate-pulse [animation-delay:200ms]">.</span>
        <span className="animate-pulse [animation-delay:400ms]">.</span>
      </span>
    </div>
  );
}

interface CardData {
  id: number;
  title: string;
  type: string;
  summary: string;
  url: string;
  whyInteresting: string;
  thread?: { from: string; reasoning: string };
  details?: Record<string, unknown>;
}

function CardEntry({
  data,
  showThread,
}: {
  data: CardData;
  showThread: boolean;
}) {
  const borderColor = TYPE_COLORS[data.type] || "border-l-electric-cyan";

  return (
    <>
      {showThread && data.thread?.reasoning && (
        <div className="pl-4 relative py-1 animate-in fade-in">
          <div className="absolute left-2 top-0 bottom-0 w-px bg-border" />
          <p className="text-[0.7rem] text-text-dim pl-2.5 leading-relaxed">
            <span className="text-purple-haze">&gt; </span>
            {data.thread.reasoning}
          </p>
        </div>
      )}
      <Card data={data} borderColor={borderColor} />
    </>
  );
}
