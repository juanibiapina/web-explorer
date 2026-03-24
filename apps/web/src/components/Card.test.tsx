import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Card } from "./Card";

describe("Card", () => {
  const baseCard = {
    title: "Mushrooms as Building Material",
    type: "article",
    summary: "Mycelium bricks are stronger than concrete.",
    url: "https://example.com/mushrooms",
    whyInteresting: "Sustainable construction from fungi.",
    details: { author: "Jane Doe", publication: "Nature" },
  };

  it("renders title, summary, and details", () => {
    render(<Card data={baseCard} borderColor="border-l-electric-cyan" />);

    expect(screen.getByText("Mushrooms as Building Material")).toBeInTheDocument();
    expect(screen.getByText("Mycelium bricks are stronger than concrete.")).toBeInTheDocument();
    expect(screen.getByText("Jane Doe")).toBeInTheDocument();
    expect(screen.getByText("Nature")).toBeInTheDocument();
  });

  it("links to the source URL", () => {
    render(<Card data={baseCard} borderColor="border-l-electric-cyan" />);

    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "https://example.com/mushrooms");
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("shows the card type", () => {
    render(<Card data={baseCard} borderColor="border-l-electric-cyan" />);
    expect(screen.getByText("article")).toBeInTheDocument();
  });

  it("renders without details", () => {
    const { details: _, ...cardWithoutDetails } = baseCard;
    render(<Card data={cardWithoutDetails} borderColor="border-l-matrix-green" />);
    expect(screen.getByText("Mushrooms as Building Material")).toBeInTheDocument();
  });

  it("renders share button", () => {
    render(<Card data={baseCard} borderColor="border-l-electric-cyan" />);
    expect(screen.getByRole("button", { name: "Share" })).toBeInTheDocument();
  });

  it("renders image when imageUrl is provided", () => {
    const cardWithImage = {
      ...baseCard,
      imageUrl: "https://example.com/mushroom.jpg",
    };
    render(<Card data={cardWithImage} borderColor="border-l-electric-cyan" />);

    const img = screen.getByRole("img");
    expect(img).toHaveAttribute("src", "https://example.com/mushroom.jpg");
    expect(img).toHaveAttribute("alt", "Mushrooms as Building Material");
  });

  it("does not render image when imageUrl is absent", () => {
    render(<Card data={baseCard} borderColor="border-l-electric-cyan" />);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("hides image on load error", () => {
    const cardWithImage = {
      ...baseCard,
      imageUrl: "https://example.com/broken.jpg",
    };
    const { container } = render(
      <Card data={cardWithImage} borderColor="border-l-electric-cyan" />
    );

    const img = screen.getByRole("img");
    act(() => {
      img.dispatchEvent(new Event("error"));
    });

    expect(container.querySelector("img")).not.toBeInTheDocument();
  });
});

describe("ShareButton", () => {
  const baseCard = {
    title: "Mushrooms as Building Material",
    type: "article",
    summary: "Mycelium bricks are stronger than concrete.",
    url: "https://example.com/mushrooms",
    whyInteresting: "Sustainable construction from fungi.",
  };

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("uses Web Share API when available", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const shareFn = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "share", { value: shareFn, writable: true, configurable: true });

    render(<Card data={baseCard} borderColor="border-l-electric-cyan" />);
    await user.click(screen.getByRole("button", { name: "Share" }));

    expect(shareFn).toHaveBeenCalledWith({
      title: "Mushrooms as Building Material",
      text: "Mycelium bricks are stronger than concrete.",
      url: "https://example.com/mushrooms",
    });

    Object.defineProperty(navigator, "share", { value: undefined, writable: true, configurable: true });
  });

  it("falls back to clipboard when Web Share is unavailable", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    Object.defineProperty(navigator, "share", { value: undefined, writable: true, configurable: true });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      writable: true,
      configurable: true,
    });

    render(<Card data={baseCard} borderColor="border-l-electric-cyan" />);
    await user.click(screen.getByRole("button", { name: "Share" }));

    expect(writeText).toHaveBeenCalledWith(
      "Mushrooms as Building Material\nMycelium bricks are stronger than concrete.\nhttps://example.com/mushrooms"
    );
  });

  it("shows copied state after clipboard write", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    Object.defineProperty(navigator, "share", { value: undefined, writable: true, configurable: true });
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      writable: true,
      configurable: true,
    });

    render(<Card data={baseCard} borderColor="border-l-electric-cyan" />);
    await user.click(screen.getByRole("button", { name: "Share" }));

    expect(screen.getByRole("button", { name: "Copied" })).toBeInTheDocument();

    act(() => { vi.advanceTimersByTime(1500); });
    expect(screen.getByRole("button", { name: "Share" })).toBeInTheDocument();
  });

  it("falls back to clipboard when Web Share is cancelled", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    Object.defineProperty(navigator, "share", {
      value: vi.fn().mockRejectedValue(new DOMException("AbortError")),
      writable: true,
      configurable: true,
    });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      writable: true,
      configurable: true,
    });

    render(<Card data={baseCard} borderColor="border-l-electric-cyan" />);
    await user.click(screen.getByRole("button", { name: "Share" }));

    expect(writeText).toHaveBeenCalled();
  });
});
