import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { envelopes, fold, trial } from "../test/trials.js";
import { Proceedings } from "./Proceedings.js";

const twoRounds = envelopes(trial([7, 6, 5, 7, 3], [[null, null, 6, null, null], [null, null, null, null, 2]]));

describe("Proceedings", () => {
  it("bez mowy oskarzenia nic nie pokazuje", () => {
    const { container } = render(<Proceedings court={fold(twoRounds.slice(0, 6))} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("mowa i rundy w kolejnosci, nowe oceny zaznaczone", () => {
    render(<Proceedings court={fold(twoRounds)} />);
    expect(screen.getByRole("heading", { name: "Protokół" })).toBeInTheDocument();
    expect(screen.getByText("Odrzucic")).toBeInTheDocument();
    expect(screen.getByText("Prokurator — mowa oskarżenia")).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual(["Debata — runda 1", "Debata — runda 2"]);
    const [round1, round2] = screen.getAllByRole("list").map((l) => within(l).getAllByRole("listitem").map((li) => li.textContent));
    expect(round1).toEqual(["Bot ATS: ...", "HR screener: ...", "Tech Lead: ... (nowa ocena: 6)", "Hiring Manager: ...", "Prokurator: ..."]);
    expect(round2?.at(-1)).toBe("Prokurator: ... (nowa ocena: 2)");
  });
});
