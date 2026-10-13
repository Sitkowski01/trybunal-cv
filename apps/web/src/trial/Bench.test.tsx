import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { envelopes, fold, trial } from "../test/trials.js";
import { Bench } from "./Bench.js";
import { type Court, emptyCourt } from "./court.js";
import { seats } from "./seats.js";

const twoRounds = envelopes(trial([7, 6, 5, 7, 3], [[null, null, 6, null, null], [null, null, null, null, 2]]));

describe("Bench", () => {
  const card = (critic: string) => {
    const element = document.querySelector(`[data-critic="${critic}"]`);
    if (!(element instanceof HTMLElement)) throw new Error(`brak karty ${critic}`);
    return within(element);
  };

  it("karta przed ocena: kreska, opis dla czytnika, klasa aktywnosci", () => {
    render(<Bench court={fold(twoRounds.slice(0, 2))} />);
    expect(card("hr").getByText("Brak oceny")).toHaveClass("visually-hidden");
    expect(card("hr").getByText("–")).toHaveAttribute("aria-hidden", "true");
    expect(card("hr").getByText("czyta akta…")).toBeInTheDocument();
    expect(document.querySelector('[data-critic="hr"]')).toHaveClass("critic", "critic--thinking");
    expect(document.querySelector('[data-critic="prosecutor"]')).toHaveClass("critic--prosecutor");
    expect(document.querySelector('[data-critic="ats"]')).not.toHaveClass("critic--prosecutor");
  });

  it("zmiana zdania: poprzednia ocena widoczna, ostatnie slowo z debaty z numerem rundy", () => {
    render(<Bench court={fold(twoRounds)} />);
    expect(card("techLead").getByText("5→")).toHaveAttribute("aria-hidden", "true");
    expect(card("techLead").getByText("6")).toHaveClass("critic__value");
    expect(card("techLead").getByText("Ocena 6 na 10, zmieniona z 5")).toBeInTheDocument();
    expect(card("ats").queryByText(/→/u)).toBeNull();
    expect(card("ats").getByText("Ocena 7 na 10")).toBeInTheDocument();
    expect(card("ats").getByText("/10")).toBeInTheDocument();
    expect(card("ats").getByText("ok")).toHaveClass("critic__summary");
    const statement = card("ats").getByRole("blockquote");
    expect(statement).toHaveTextContent("Runda 2: ...");
  });

  it("ostatnie slowo to wypowiedz z ostatniej rundy", () => {
    const threeRounds = envelopes(trial([7, 7, 7, 7, 7], [[null], [null], [null]]));
    render(<Bench court={fold(threeRounds)} />);
    expect(card("ats").getByRole("blockquote")).toHaveTextContent("Runda 3:");
  });

  it("bez debaty: brak cytatu wypowiedzi", () => {
    render(<Bench court={fold(twoRounds.slice(0, 6))} />);
    expect(screen.queryByRole("blockquote")).toBeNull();
    expect(screen.getAllByText("ocenił")).toHaveLength(5);
  });
});

describe("seats w widoku", () => {
  it("pusta sala: piec kart z kreska", () => {
    const court: Court = emptyCourt;
    render(<Bench court={court} />);
    expect(screen.getAllByText("–")).toHaveLength(seats(court).length);
    expect(screen.getAllByText("czeka")).toHaveLength(5);
  });
});
