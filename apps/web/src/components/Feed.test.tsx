import { render, screen } from "@testing-library/react";
import { describe, it, expect, beforeAll } from "vitest";
import { Feed } from "./Feed";
import type { StreamEvent } from "../hooks/useExplorerStream";

beforeAll(() => {
  Element.prototype.scrollIntoView = () => {};
});

describe("Feed", () => {
  it("shows connecting message when not connected", () => {
    render(<Feed events={[]} connected={false} />);
    expect(screen.getByText("connecting to stream")).toBeInTheDocument();
  });

  it("shows skeleton card when connected with no events", () => {
    const { container } = render(<Feed events={[]} connected={true} />);
    expect(container.querySelector(".animate-pulse")).toBeInTheDocument();
    expect(screen.queryByText("connecting to stream")).not.toBeInTheDocument();
  });

  it("shows skeleton card after events (persistent)", () => {
    const events: StreamEvent[] = [
      {
        event: "seed",
        data: { query: "mushroom architecture", reason: "testing" },
      },
    ];
    const { container } = render(<Feed events={events} connected={true} />);
    expect(screen.getByText(/mushroom architecture/)).toBeInTheDocument();
    expect(container.querySelector(".animate-pulse")).toBeInTheDocument();
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
