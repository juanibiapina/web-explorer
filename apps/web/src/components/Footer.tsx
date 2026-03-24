import type { ExplorerStats } from "../hooks/useExplorerStream";

interface FooterProps {
  stats: ExplorerStats | null;
}

export function Footer({ stats }: FooterProps) {
  if (!stats || stats.totalCards === 0) return null;

  const parts: string[] = [];
  parts.push(`${stats.totalCards} ${stats.totalCards === 1 ? "card" : "cards"}`);
  if (stats.roundsCompleted > 0) {
    parts.push(
      `${stats.roundsCompleted} ${stats.roundsCompleted === 1 ? "round" : "rounds"}`
    );
  }
  if (stats.startedAt) {
    parts.push(`since ${formatDate(stats.startedAt)}`);
  }

  return (
    <footer className="fixed bottom-0 inset-x-0 text-center py-2 text-[0.65rem] text-text-dim tracking-wide">
      {parts.join(" · ")}
    </footer>
  );
}

function formatDate(iso: string): string {
  try {
    const date = new Date(iso);
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch {
    return "";
  }
}
