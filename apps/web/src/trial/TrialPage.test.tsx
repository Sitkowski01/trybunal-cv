import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { envelopes, trial } from "../test/trials.js";
import { full, setupPage as setup, status } from "../test/page.js";

describe("TrialPage na zywo", () => {
  it("laczy sie ze strumieniem rozprawy i pokazuje kolejne fazy", () => {
    const { last, send } = setup();
    expect(last().url).toBe("/api/trials/t-1/events");
    expect(status()).toHaveTextContent("Łączenie z salą rozpraw…");

    send(...full.slice(0, 3));
    expect(status()).toHaveTextContent("Krytycy czytają akta: 2 z 5 ocen.");
    const bench = screen.getByRole("list", { name: "Skład trybunału" });
    expect(within(bench).getAllByText("czyta akta…")).toHaveLength(3);
    expect(within(bench).getByText("Ocena 7 na 10")).toBeInTheDocument();
    expect(screen.getByText("Oceny")).toHaveAttribute("aria-current", "step");

    send(...full.slice(3, 7));
    expect(status()).toHaveTextContent("Debata, runda 1 z 1 — mówi Bot ATS.");
    expect(screen.getByText("Debata 1/1")).toHaveAttribute("aria-current", "step");
    expect(screen.getByText("Oceny")).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("heading", { name: "Protokół" })).toBeInTheDocument();
    expect(within(bench).getByText("przemawia")).toBeInTheDocument();
    expect(within(bench).getAllByText("słucha")).toHaveLength(4);
  });

  it("pelna rozprawa: zmiana zdania, werdykt, raport z diffem, koszt", () => {
    const { send } = setup();
    send(...full);
    expect(status()).toHaveTextContent("Werdykt ogłoszony.");
    expect(screen.getByText("Ocena 6 na 10, zmieniona z 5")).toBeInTheDocument();
    expect(screen.getByText("(nowa ocena: 6)")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Zaprosić" })).toBeInTheDocument();
    expect(screen.getByText(/Tech Lead 5→6/u)).toBeInTheDocument();
    const report = screen.getByRole("region", { name: "Uzasadnienie na piśmie" });
    const rewrite = report.querySelector(".diff");
    expect([...(rewrite?.querySelectorAll("del, ins") ?? [])].map((e) => [e.tagName, e.textContent])).toEqual([
      ["DEL", "testy."],
      ["INS", "testy, pokrycie 90%."],
    ]);
    expect(rewrite).toHaveTextContent("Pisalem testy.testy, pokrycie 90%.");
    // Zastrzezenia od najpowazniejszych.
    expect(within(report).getAllByText(/^(Bez projektu|Jakie testy\?)$/u).map((e) => e.textContent)).toEqual(["Bez projektu", "Jakie testy?"]);
    expect(within(report).getByText("Java")).toBeInTheDocument();
    // 13 zdarzen po 2,5 mln nano-USD.
    expect(screen.getByText("Koszt: $0.0325")).toBeInTheDocument();
  });

  it("przerwanie rozprawy z powodem; brak raportu i werdyktu", () => {
    const { send } = setup();
    send(...envelopes(trial([7, 7, 7, 7, 7], [], true)));
    expect(status()).toHaveTextContent("Rozprawa przerwana: budzet");
    expect(screen.queryByRole("region", { name: "Uzasadnienie na piśmie" })).toBeNull();
    expect(screen.queryByRole("heading", { name: /Zaprosić|Odrzucić/u })).toBeNull();
  });

  it("bez debaty os faz pomija debate; odrzucenie z filtrem ATS i sporem", () => {
    const { send } = setup();
    send(...envelopes(trial([2, 9, 9, 9, 1], [])));
    expect(screen.queryByText(/^Debata/u)).toBeNull();
    expect(screen.getByRole("heading", { name: "Odrzucić" })).toBeInTheDocument();
    expect(screen.getByText("odrzucone (ocena poniżej 4)")).toBeInTheDocument();
    expect(screen.getByText("— CV niejednoznaczne")).toBeInTheDocument();
    expect(screen.queryByText(/Zmiana zdania/u)).toBeNull();
    expect(screen.getByText("Krytycy nie zaproponowali poprawek.")).toBeInTheDocument();
    expect(screen.getByText("Brak zastrzeżeń.")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Mocne strony" })).toBeNull();
  });
});
