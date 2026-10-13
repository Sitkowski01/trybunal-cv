import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { envelopes, fold, trial } from "../test/trials.js";
import { emptyCourt } from "./court.js";
import { PhaseTimeline } from "./PhaseTimeline.js";

const twoRounds = envelopes(trial([7, 6, 5, 7, 3], [[null, null, 6, null, null], [null, null, null, null, 2]]));
const steps = () => screen.getAllByRole("listitem").map((li) => [li.textContent, li.className.replace("timeline__step timeline__step--", ""), li.getAttribute("aria-current")]);

describe("PhaseTimeline", () => {
  it("przed wniesieniem: wszystko przed nami, bez debaty (nie wiadomo, ile rund)", () => {
    render(<PhaseTimeline court={emptyCourt} />);
    expect(steps()).toEqual([
      ["Oceny", "todo", null],
      ["Oskarżenie", "todo", null],
      ["Narada", "todo", null],
      ["Werdykt", "todo", null],
    ]);
  });

  it("debata: runda biezaca, etapy wczesniejsze zrobione", () => {
    render(<PhaseTimeline court={fold(twoRounds.slice(0, 12))} />);
    expect(steps()).toEqual([
      ["Oceny", "done", null],
      ["Oskarżenie", "done", null],
      ["Debata 2/2", "now", "step"],
      ["Narada", "todo", null],
      ["Werdykt", "todo", null],
    ]);
  });

  it("przerwanie w debacie: etap, na ktorym stanela rozprawa, oznaczony dla oka i czytnika", () => {
    const abort = envelopes(trial([7, 7, 7, 7, 7], [], true)).at(-1);
    if (abort === undefined) throw new Error("brak przerwania");
    render(<PhaseTimeline court={fold([...twoRounds.slice(0, 8), { ...abort, seq: 9 }])} />);
    expect(steps()).toEqual([
      ["Oceny", "done", null],
      ["Oskarżenie", "done", null],
      ["Debata 1/2 (tu przerwano)", "stopped", null],
      ["Narada", "todo", null],
      ["Werdykt", "todo", null],
    ]);
  });

  it("po werdykcie wszystko zrobione, werdykt biezacy; debata juz bez numeru rundy", () => {
    render(<PhaseTimeline court={fold(twoRounds)} />);
    expect(steps().map(([, state]) => state)).toEqual(["done", "done", "done", "done", "now"]);
    expect(screen.getByText("Debata")).toBeInTheDocument();
  });
});
