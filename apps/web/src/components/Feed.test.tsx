import { render, screen } from "@testing-library/react";
import { describe, it, expect, beforeAll, vi } from "vitest";
import { Feed } from "./Feed";
import type { StreamEvent } from "../hooks/useExplorerStream";

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

describe("Feed", () => {
  it("shows skeleton card when generating with no events", () => {
    const { container } = render(<Feed events={[]} generating={true} />);
    expect(container.querySelector(".animate-pulse")).toBeInTheDocument();
  });

  it("does not show skeleton when not generating", () => {
    const { container } = render(<Feed events={[]} generating={false} />);
    expect(container.querySelector(".animate-pulse")).not.toBeInTheDocument();
  });

  it("shows skeleton card during generation after events", () => {
    const events: StreamEvent[] = [
      {
        event: "seed",
        data: { query: "mushroom architecture", reason: "testing" },
      },
    ];
    const { container } = render(<Feed events={events} generating={true} />);
    expect(screen.getByText(/mushroom architecture/)).toBeInTheDocument();
    expect(container.querySelector(".animate-pulse")).toBeInTheDocument();
  });

  it("hides skeleton when generation is complete", () => {
    const events: StreamEvent[] = [
      {
        event: "seed",
        data: { query: "mushroom architecture", reason: "testing" },
      },
    ];
    const { container } = render(<Feed events={events} generating={false} />);
    expect(screen.getByText(/mushroom architecture/)).toBeInTheDocument();
    expect(container.querySelector(".animate-pulse")).not.toBeInTheDocument();
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
    render(<Feed events={events} generating={true} />);
    expect(screen.getByText("Mycelium Bricks")).toBeInTheDocument();
  });

  it("does not auto-scroll on initial event load", () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;

    const events: StreamEvent[] = [
      {
        event: "seed",
        data: { query: "test topic", reason: "testing" },
      },
      {
        event: "card",
        data: {
          id: 1,
          title: "Test Card",
          type: "article",
          summary: "A test.",
          url: "https://example.com",
          whyInteresting: "Testing.",
        },
      },
    ];

    // Initial render with events (simulates history replay arriving)
    scrollIntoView.mockClear();
    render(<Feed events={events} generating={false} />);

    // isNearBottom starts false, so scrollIntoView should not be called
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});
