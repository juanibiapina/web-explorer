interface CardData {
  title: string;
  type: string;
  summary: string;
  url: string;
  whyInteresting: string;
  details?: Record<string, unknown>;
}

interface CardProps {
  data: CardData;
  borderColor: string;
}

const TYPE_ACCENT: Record<string, string> = {
  article: "text-electric-cyan",
  repo: "text-matrix-green",
  person: "text-purple-haze",
  thread: "text-amber",
  paper: "text-paper-blue",
  tool: "text-electric-cyan",
  video: "text-neon-magenta",
  community: "text-hot-pink",
};

export function Card({ data, borderColor }: CardProps) {
  const accent = TYPE_ACCENT[data.type] || "text-electric-cyan";
  const domain = getDomain(data.url);

  return (
    <div
      className={`bg-surface border border-border ${borderColor} border-l-2 p-4 animate-in fade-in slide-in-from-bottom-3`}
    >
      <div className="flex items-center gap-2 mb-1.5 text-[0.7rem] sm:text-[0.65rem]">
        <span className={`${accent} font-bold uppercase tracking-wider`}>
          {data.type}
        </span>
        {domain && (
          <span className="text-text-dim ml-auto truncate max-w-[40%]">{domain}</span>
        )}
      </div>

      <h2 className="text-[0.95rem] sm:text-base font-bold mb-1.5 leading-snug">
        <a
          href={data.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-text-primary active:text-electric-cyan sm:hover:text-electric-cyan transition-colors"
        >
          {data.title}
        </a>
      </h2>

      <p className="text-text-secondary text-sm mb-2 leading-relaxed">
        {data.summary}
      </p>

      <Details type={data.type} details={data.details} />

      <div className="text-xs text-text-dim italic leading-relaxed border-t border-border pt-1.5 mt-0.5">
        {data.whyInteresting}
      </div>
    </div>
  );
}

function Details({
  type,
  details,
}: {
  type: string;
  details?: Record<string, unknown>;
}) {
  if (!details || Object.keys(details).length === 0) return null;

  const items = getDetailItems(type, details);
  if (items.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5 mb-2 items-center">
      {items.map((item, i) => (
        <span
          key={i}
          className={
            item.badge
              ? "bg-surface-hover border border-border px-2 py-0.5 text-[0.7rem] sm:text-[0.65rem] text-text-secondary"
              : item.tag
                ? "bg-surface-hover border border-border px-2 py-0.5 text-[0.7rem] sm:text-[0.65rem] text-text-dim"
                : "text-xs sm:text-[0.7rem] text-text-dim"
          }
        >
          {item.text}
        </span>
      ))}
    </div>
  );
}

interface DetailItem {
  text: string;
  badge?: boolean;
  tag?: boolean;
}

function getDetailItems(
  type: string,
  d: Record<string, unknown>
): DetailItem[] {
  const items: DetailItem[] = [];

  switch (type) {
    case "article":
      if (d.author) items.push({ text: String(d.author) });
      if (d.publication) items.push({ text: String(d.publication), badge: true });
      if (d.date) items.push({ text: String(d.date) });
      if (d.readingMinutes) items.push({ text: `${d.readingMinutes} min` });
      break;
    case "repo":
      if (d.language) items.push({ text: String(d.language), badge: true });
      if (d.stars != null) items.push({ text: `★ ${formatNum(d.stars)}` });
      if (Array.isArray(d.topics))
        d.topics.forEach((t) => items.push({ text: String(t), tag: true }));
      break;
    case "person":
      if (d.role) items.push({ text: String(d.role) });
      if (Array.isArray(d.knownFor))
        d.knownFor.forEach((k) => items.push({ text: String(k), tag: true }));
      break;
    case "thread":
      if (d.platform) items.push({ text: String(d.platform), badge: true });
      if (d.subreddit) items.push({ text: String(d.subreddit) });
      if (d.commentCount)
        items.push({ text: `${formatNum(d.commentCount)} comments` });
      break;
    case "paper":
      if (Array.isArray(d.authors))
        items.push({ text: d.authors.join(", ") });
      if (d.year) items.push({ text: String(d.year) });
      if (d.venue) items.push({ text: String(d.venue), badge: true });
      break;
    case "tool":
      if (d.tagline) items.push({ text: String(d.tagline) });
      if (d.pricing) items.push({ text: String(d.pricing), badge: true });
      if (Array.isArray(d.platform))
        d.platform.forEach((p) => items.push({ text: String(p), tag: true }));
      break;
    case "video":
      if (d.channel) items.push({ text: String(d.channel) });
      if (d.duration) items.push({ text: String(d.duration) });
      if (d.platform) items.push({ text: String(d.platform), badge: true });
      break;
    case "community":
      if (d.name) items.push({ text: String(d.name) });
      if (d.memberCount)
        items.push({ text: `${formatNum(d.memberCount)} members` });
      if (d.focus) items.push({ text: String(d.focus) });
      break;
    default:
      for (const [k, v] of Object.entries(d)) {
        if (v != null)
          items.push({
            text: `${k}: ${Array.isArray(v) ? v.join(", ") : v}`,
          });
      }
  }

  return items;
}

function getDomain(url: string): string {
  try {
    return new URL(url).hostname.replace("www.", "");
  } catch {
    return "";
  }
}

function formatNum(n: unknown): string {
  if (typeof n === "number") return n.toLocaleString();
  return String(n);
}
