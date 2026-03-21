/**
 * Tavily search API client.
 */

export interface SearchResult {
  title: string;
  url: string;
  content: string;
}

export async function search(
  query: string,
  apiKey: string,
  numResults = 8
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
