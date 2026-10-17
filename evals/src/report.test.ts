import { describe, expect, it } from "vitest";
import { renderReport } from "./report.js";
import { aborted, outcome } from "./test/fixtures.js";

const meta = { title: "Ewaluacja testowa", date: "2026-10-16", repeats: 2, debateRounds: 1, llm: "atrapa", spentNanoUsd: 250_000_000 };

describe("renderReport", () => {
  it("tabela metryk, tagi, przypadki do obejrzenia i roznice miedzy wariantami", () => {
    const rows = [
      outcome({ caseId: "a", repeat: 0, decision: "invite", juryAverage: 7, costNanoUsd: 40_000_000, cacheReadTokens: 100 }),
      outcome({ caseId: "a", repeat: 1, decision: "reject", juryAverage: 5, costNanoUsd: 60_000_000 }),
      outcome({ caseId: "b", repeat: 0, expected: "reject", tags: ["zawyzone"], decision: "invite", failedAttempts: 3 }),
      aborted({ caseId: "b", repeat: 1, expected: "reject", tags: ["zawyzone"] }),
      outcome({ variant: "v2", caseId: "a", decision: "invite" }),
      outcome({ variant: "v2", caseId: "b", expected: "reject", tags: ["zawyzone"], decision: "reject" }),
    ];
    expect(renderReport(meta, rows)).toMatchSnapshot();
  });

  it("trafnosc bez przypadkow granicznych liczona osobno", () => {
    const text = renderReport(meta, [outcome(), outcome({ caseId: "g", tags: ["graniczny"], decision: "reject" })]);
    expect(text).toContain("| Trafność werdyktu | 50% |");
    expect(text).toContain("| Trafność bez przypadków granicznych | 100% |");
  });

  it("nieudane proby: krok i powod po ludzku, liczby w kazdym wariancie; bez nieudanych prob sekcji nie ma", () => {
    const text = renderReport(meta, [
      outcome({ failures: { "assessment:ats/rejected": 2, "statement:hr/incomplete": 1, "prosecution/invalid": 1, "justification/transport": 1, "x/inne": 1 } }),
      outcome({ variant: "v2" }),
    ]);
    expect(text).toContain("## Nieudane próby według kroku i powodu\n\n| Krok — powód | v1 | v2 |\n| --- | --- | --- |\n| assessment:ats — cytat spoza CV | 2 | 0 |\n");
    expect(text).toContain("| statement:hr — limit tokenów | 1 | 0 |");
    expect(text).toContain("| prosecution — zły schemat odpowiedzi | 1 | 0 |");
    expect(text).toContain("| justification — błąd API | 1 | 0 |");
    // Pusta linia przed nastepna sekcja, jak w calym raporcie.
    expect(text).toContain("| x — inne | 1 | 0 |\n\n## Przypadki do obejrzenia");
    expect(renderReport(meta, [outcome()])).not.toContain("Nieudane próby");
  });

  it("remis w tabeli roznic opisany slowem, nie jako zaproszenie albo odrzucenie", () => {
    const text = renderReport(meta, [
      outcome({ caseId: "a", expected: "reject", decision: "invite" }),
      outcome({ caseId: "a", expected: "reject", decision: "reject", repeat: 1 }),
      outcome({ variant: "v2", caseId: "a", expected: "reject", decision: "reject" }),
    ]);
    expect(text).toContain("| a | reject | remis | reject |");
    expect(text).toContain("remis (do powtórzenia): a");
  });

  it("jeden wariant: bez sekcji roznic; brak danych jako kreska", () => {
    const text = renderReport(meta, [aborted({ costNanoUsd: 0, attempts: 0, inputTokens: 0 })]);
    expect(text).not.toContain("→");
    expect(text).toContain("| Trafność werdyktu | — |");
    expect(text).toContain("chybione (werdykt większości ≠ oczekiwany): —; niestabilne: —");
    expect(text.endsWith("\n")).toBe(true);
  });

  it("tag bez rozpraw w jednym z wariantow: kreska w jego kolumnie", () => {
    const text = renderReport(meta, [outcome({ tags: ["luka"] }), outcome({ variant: "v2", tags: ["mocne"] })]);
    expect(text).toContain("| luka | 1/1 | — |");
    expect(text).toContain("| mocne | — | 1/1 |");
  });

  it("bez zadnych wynikow: sam naglowek i informacja", () => {
    const text = renderReport(meta, []);
    expect(text.endsWith("Brak wyników — żadna rozprawa nie została zapisana.\n")).toBe(true);
    expect(text).not.toContain("## Metryki");
  });

  it("warianty bez roznic werdyktow — mowi to wprost", () => {
    const text = renderReport(meta, [outcome(), outcome({ variant: "v2" })]);
    expect(text).toContain("## v1 → v2: przypadki ze zmienionym werdyktem\n\nBrak — oba warianty ogłaszają te same werdykty większości.");
  });
});
