/**
 * Web search with provider fallback.
 *
 * Tries providers in order (Tavily, then Brave). Falls back to
 * the next provider on quota/rate-limit errors.
 */

export interface SearchResult {
  title: string;
  url: string;
  content: string;
}

export interface SearchKeys {
  tavilyKey?: string;
  braveKey?: string;
}

export async function search(
  query: string,
  keys: SearchKeys,
  numResults = 8
): Promise<SearchResult[]> {
  const providers: Array<() => Promise<SearchResult[]>> = [];

  if (keys.tavilyKey) {
    providers.push(() => searchTavily(query, keys.tavilyKey!, numResults));
  }
  if (keys.braveKey) {
    providers.push(() => searchBrave(query, keys.braveKey!, numResults));
  }

  if (providers.length === 0) {
    throw new Error("No search API keys configured (need TAVILY_API_KEY or BRAVE_API_KEY)");
  }

  for (let i = 0; i < providers.length; i++) {
    try {
      return await providers[i]();
    } catch (err) {
      const isLast = i === providers.length - 1;
      if (!isLast && isQuotaError(err)) {
        continue;
      }
      throw err;
    }
  }

  // Unreachable, but TypeScript needs it
  throw new Error("All search providers failed");
}

/**
 * Detect quota/rate-limit errors that should trigger fallback.
 */
function isQuotaError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message;
  return (
    msg.includes("429") ||
    msg.includes("432") ||
    msg.includes("usage limit") ||
    msg.includes("rate limit") ||
    msg.includes("quota")
  );
}

async function searchTavily(
  query: string,
  apiKey: string,
  numResults: number
): Promise<SearchResult[]> {
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      max_results: numResults,
      include_raw_content: false,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Tavily API error ${res.status}: ${text}`);
  }

  const data = (await res.json()) as {
    results: Array<{ title: string; url: string; content: string }>;
  };
  return data.results.map((r) => ({
    title: r.title,
    url: r.url,
    content: r.content,
  }));
}

async function searchBrave(
  query: string,
  apiKey: string,
  numResults: number
): Promise<SearchResult[]> {
  const params = new URLSearchParams({
    q: query,
    count: String(numResults),
  });

  const res = await fetch(
    `https://api.search.brave.com/res/v1/web/search?${params}`,
    {
      headers: {
        Accept: "application/json",
        "X-Subscription-Token": apiKey,
      },
    }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Brave Search API error ${res.status}: ${text}`);
  }

  const data = (await res.json()) as {
    web?: {
      results: Array<{
        title: string;
        url: string;
        description: string;
        extra_snippets?: string[];
      }>;
    };
  };

  const results = data.web?.results ?? [];
  return results.map((r) => ({
    title: r.title,
    url: r.url,
    content: r.description + (r.extra_snippets?.length ? "\n" + r.extra_snippets.join("\n") : ""),
  }));
}
