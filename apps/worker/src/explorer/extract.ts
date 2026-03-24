/**
 * Tavily extract API client.
 *
 * Fetches clean text content from URLs. Used by the link-following
 * exploration mode to read pages without a search query.
 */

export interface ExtractResult {
  url: string;
  rawContent: string;
}

export interface ExtractFailure {
  url: string;
  error: string;
}

export async function extract(
  urls: string[],
  apiKey: string
): Promise<{ results: ExtractResult[]; failures: ExtractFailure[] }> {
  const res = await fetch("https://api.tavily.com/extract", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: apiKey,
      urls,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Tavily extract API error ${res.status}: ${text}`);
  }

  const data = (await res.json()) as {
    results: Array<{ url: string; raw_content: string }>;
    failed_results: Array<{ url: string; error: string }>;
  };

  return {
    results: data.results.map((r) => ({
      url: r.url,
      rawContent: r.raw_content,
    })),
    failures: (data.failed_results ?? []).map((f) => ({
      url: f.url,
      error: f.error,
    })),
  };
}
