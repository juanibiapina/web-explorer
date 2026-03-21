import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
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
});
