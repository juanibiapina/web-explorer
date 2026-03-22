import { render, screen } from "@testing-library/react";
import { describe, it, expect, beforeAll } from "vitest";
import { Feed } from "./Feed";
import type { StreamEvent } from "../hooks/useExplorerStream";

beforeAll(() => {
  Element.prototype.scrollIntoView = () => {};
});

describe("Feed", () => {
  it("shows loading skeleton when not connected and no events", () => {
    render(<Feed events={[]} connected={false} />);
    expect(screen.getByText("connecting to stream")).toBeInTheDocument();
  });

  it("shows exploring message when connected and no events", () => {
    render(<Feed events={[]} connected={true} />);
    expect(screen.getByText(/exploring/)).toBeInTheDocument();
  });

  it("hides loading skeleton when events arrive", () => {
    const events: StreamEvent[] = [
      {
        event: "seed",
        data: { query: "mushroom architecture", reason: "testing" },
      },
    ];
    render(<Feed events={events} connected={true} />);
    expect(screen.queryByText(/exploring/)).not.toBeInTheDocument();
    expect(screen.getByText(/mushroom architecture/)).toBeInTheDocument();
  });

  it("renders card events", () => {
    const events: StreamEvent[] = [
      {
        event: "card",
        data: {
          id: 1,
          title: "Mycelium Bricks",
          type: "article",
          summary: "Fungi as building material.",
          url: "https://example.com",
          whyInteresting: "Sustainable.",
        },
      },
    ];
    render(<Feed events={events} connected={true} />);
    expect(screen.getByText("Mycelium Bricks")).toBeInTheDocument();
  });
});
