import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { followStep, pickLink } from "./follow";

const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function mockExtractResponse(content: string) {
  return {
    ok: true,
    json: async () => ({
      results: [{ url: "https://example.com/page", raw_content: content }],
      failed_results: [],
    }),
  };
}

function mockLlmResponse(response: Record<string, unknown>) {
  return {
    ok: true,
    json: async () => ({
      choices: [
        {
          message: { content: JSON.stringify(response) },
          finish_reason: "stop",
        },
      ],
    }),
  };
}

const validFollowResponse = {
  card: {
    title: "The Secret Life of Airports",
    type: "article",
    summary:
      "Airports are designed with hidden psychological tricks to make you spend money.",
    url: "https://example.com/page",
    whyInteresting: "The carpet patterns are actually wayfinding tools.",
    thread: {
      from: "origin",
      reasoning: "Started exploring urban design and found this gem.",
    },
    details: { author: "Jane Smith", publication: "Wired" },
  },
  follow: {
    type: "url" as const,
    value: "https://en.wikipedia.org/wiki/Mehran_Karimi_Nasseri",
    reasoning:
      "The article mentions a man who lived in an airport for 18 years. That's wild.",
  },
};

const keys = { tavilyKey: "tavily-key", llmKey: "llm-key" };

describe("followStep", () => {
  it("extracts page content and creates card with next follow target", async () => {
    mockFetch
      .mockResolvedValueOnce(
        mockExtractResponse("Airport design involves many hidden tricks...")
      )
      .mockResolvedValueOnce(mockLlmResponse(validFollowResponse));

    const result = await followStep(
      "https://example.com/page",
      [],
      1,
      keys
    );

    expect(result.card.title).toBe("The Secret Life of Airports");
    expect(result.card.type).toBe("article");
    expect(result.card.id).toBe(1);
    expect(result.follow.type).toBe("url");
    expect(result.follow.value).toBe(
      "https://en.wikipedia.org/wiki/Mehran_Karimi_Nasseri"
    );
  });

  it("includes previous cards as context", async () => {
    const previousCards = [
      {
        id: 1,
        title: "Card One",
        type: "article",
        summary: "Summary one",
        url: "https://a.com",
        whyInteresting: "Reason one",
        thread: { from: "origin", reasoning: "First" },
        details: {},
      },
    ];

    mockFetch
      .mockResolvedValueOnce(mockExtractResponse("Some page content"))
      .mockResolvedValueOnce(mockLlmResponse(validFollowResponse));

    await followStep("https://example.com/page", previousCards, 2, keys);

    // Verify the LLM call includes the exploration path
    const llmCall = mockFetch.mock.calls[1];
    const body = JSON.parse(llmCall[1].body);
    const userMessage = body.messages[1].content;
    expect(userMessage).toContain("Card One");
    expect(userMessage).toContain("Exploration path so far");
  });

  it("supports search fallback in follow target", async () => {
    const searchFallback = {
      ...validFollowResponse,
      follow: {
        type: "search",
        value: "Mehran Karimi Nasseri airport terminal life",
        reasoning: "The page mentions him but doesn't link to anything.",
      },
    };

    mockFetch
      .mockResolvedValueOnce(mockExtractResponse("Content mentioning Nasseri"))
      .mockResolvedValueOnce(mockLlmResponse(searchFallback));

    const result = await followStep(
      "https://example.com/page",
      [],
      1,
      keys
    );

    expect(result.follow.type).toBe("search");
    expect(result.follow.value).toContain("Mehran Karimi Nasseri");
  });

  it("throws when extraction fails", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: [],
        failed_results: [
          { url: "https://example.com/page", error: "403 Forbidden" },
        ],
      }),
    });

    await expect(
      followStep("https://example.com/page", [], 1, keys)
    ).rejects.toThrow("Failed to extract content from https://example.com/page: 403 Forbidden");
  });

  it("truncates long page content", async () => {
    const longContent = "x".repeat(10000);

    mockFetch
      .mockResolvedValueOnce(mockExtractResponse(longContent))
      .mockResolvedValueOnce(mockLlmResponse(validFollowResponse));

    await followStep("https://example.com/page", [], 1, keys);

    const llmCall = mockFetch.mock.calls[1];
    const body = JSON.parse(llmCall[1].body);
    const userMessage = body.messages[1].content;
    expect(userMessage).toContain("[content truncated]");
    // Should be truncated to ~8000 chars + metadata, not the full 10000
    expect(userMessage.length).toBeLessThan(9000);
  });

  it("throws on invalid llm response", async () => {
    mockFetch
      .mockResolvedValueOnce(mockExtractResponse("Content"))
      .mockResolvedValueOnce(
        mockLlmResponse({ card: { title: "Missing fields" } })
      );

    await expect(
      followStep("https://example.com/page", [], 1, keys)
    ).rejects.toThrow("LLM returned invalid follow response");
  });
});

describe("pickLink", () => {
  it("extracts page and picks an interesting link", async () => {
    const linkResponse = {
      type: "url",
      value: "https://en.wikipedia.org/wiki/Statelessness",
      reasoning: "The article mentions stateless people in airports.",
    };

    mockFetch
      .mockResolvedValueOnce(
        mockExtractResponse("Page about airports mentioning stateless people...")
      )
      .mockResolvedValueOnce(mockLlmResponse(linkResponse));

    const result = await pickLink("https://example.com/airports", [], keys);

    expect(result.type).toBe("url");
    expect(result.value).toBe(
      "https://en.wikipedia.org/wiki/Statelessness"
    );
    expect(result.reasoning).toContain("stateless");
  });

  it("supports search fallback", async () => {
    const searchResponse = {
      type: "search",
      value: "cargo cult science Feynman",
      reasoning: "The page mentions Feynman's speech but doesn't link to it.",
    };

    mockFetch
      .mockResolvedValueOnce(mockExtractResponse("Content about science"))
      .mockResolvedValueOnce(mockLlmResponse(searchResponse));

    const result = await pickLink("https://example.com/science", [], keys);

    expect(result.type).toBe("search");
    expect(result.value).toContain("Feynman");
  });

  it("throws when extraction fails", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: [],
        failed_results: [
          { url: "https://example.com", error: "Timeout" },
        ],
      }),
    });

    await expect(
      pickLink("https://example.com", [], keys)
    ).rejects.toThrow("Failed to extract content from https://example.com: Timeout");
  });
});
