import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { Feed } from "./Feed";
import type { StreamEvent } from "../hooks/useExplorerStream";

describe("Feed", () => {
  it("renders a round divider for done events", () => {
    const events: StreamEvent[] = [
      {
        event: "card",
        data: {
          id: 1,
          title: "First Card",
          type: "article",
          summary: "Summary",
          url: "https://example.com",
          whyInteresting: "Interesting",
          thread: { from: "origin", reasoning: "starting point" },
        },
      },
      { event: "done", data: { totalCards: 1 } },
      {
        event: "seed",
        data: { query: "next topic", reason: "curiosity" },
      },
    ];

    render(<Feed events={events} />);

    expect(screen.getByRole("separator")).toBeInTheDocument();
    expect(screen.getByText("new thread")).toBeInTheDocument();
  });

  it("renders seed banners", () => {
    const events: StreamEvent[] = [
      { event: "seed", data: { query: "quantum biology", reason: "fascinating" } },
    ];

    render(<Feed events={events} />);

    expect(screen.getByText(/quantum biology/)).toBeInTheDocument();
  });

  it("renders status indicators", () => {
    const events: StreamEvent[] = [
      { event: "status", data: { step: 3, total: 12, query: "deep sea vents" } },
    ];

    render(<Feed events={events} />);

    expect(screen.getByText("[3/12]", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("deep sea vents")).toBeInTheDocument();
  });

  it("renders error messages", () => {
    const events: StreamEvent[] = [
      { event: "error", data: { message: "Search API down" } },
    ];

    render(<Feed events={events} />);

    expect(screen.getByText(/Search API down/)).toBeInTheDocument();
  });
});
