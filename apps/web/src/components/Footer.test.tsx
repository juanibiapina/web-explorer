import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { Footer } from "./Footer";

describe("Footer", () => {
  it("renders nothing when stats are null", () => {
    const { container } = render(<Footer stats={null} />);
    expect(container.querySelector("footer")).toBeNull();
  });

  it("renders nothing when totalCards is 0", () => {
    const { container } = render(
      <Footer stats={{ totalCards: 0, roundsCompleted: 0, startedAt: null }} />
    );
    expect(container.querySelector("footer")).toBeNull();
  });

  it("shows card count", () => {
    render(
      <Footer stats={{ totalCards: 42, roundsCompleted: 0, startedAt: null }} />
    );
    expect(screen.getByText(/42 cards/)).toBeInTheDocument();
  });

  it("uses singular for 1 card", () => {
    render(
      <Footer stats={{ totalCards: 1, roundsCompleted: 0, startedAt: null }} />
    );
    expect(screen.getByText(/1 card/)).toBeInTheDocument();
    expect(screen.queryByText(/1 cards/)).not.toBeInTheDocument();
  });

  it("shows rounds when completed", () => {
    render(
      <Footer stats={{ totalCards: 24, roundsCompleted: 3, startedAt: null }} />
    );
    expect(screen.getByText(/3 rounds/)).toBeInTheDocument();
  });

  it("uses singular for 1 round", () => {
    render(
      <Footer stats={{ totalCards: 12, roundsCompleted: 1, startedAt: null }} />
    );
    expect(screen.getByText(/1 round/)).toBeInTheDocument();
    expect(screen.queryByText(/1 rounds/)).not.toBeInTheDocument();
  });

  it("hides rounds when 0", () => {
    render(
      <Footer stats={{ totalCards: 5, roundsCompleted: 0, startedAt: null }} />
    );
    expect(screen.queryByText(/round/)).not.toBeInTheDocument();
  });

  it("shows formatted start date", () => {
    render(
      <Footer
        stats={{
          totalCards: 10,
          roundsCompleted: 1,
          startedAt: "2026-03-21T14:30:00Z",
        }}
      />
    );
    expect(screen.getByText(/since Mar 21/)).toBeInTheDocument();
  });

  it("shows all parts joined by dots", () => {
    render(
      <Footer
        stats={{
          totalCards: 42,
          roundsCompleted: 3,
          startedAt: "2026-03-21T14:30:00Z",
        }}
      />
    );
    expect(screen.getByText(/42 cards · 3 rounds · since Mar 21/)).toBeInTheDocument();
  });
});
