import { CRITIC_IDS } from "@trybunal/domain";
import { describe, expect, it } from "vitest";
import { envelopes, fold, trial } from "../test/trials.js";
import { type Court, emptyCourt } from "./court.js";
import { narrate } from "./narrate.js";

const list = envelopes(trial([7, 7, 7, 7, 7], [[null, null, null, null, null]]));

describe("narrate", () => {
  it.each<[string, Court, string]>([
    ["przed wniesieniem", emptyCourt, "Łączenie z salą rozpraw…"],
    ["oceny", fold(list.slice(0, 3)), "Krytycy czytają akta: 2 z 5 ocen."],
    ["oskarzenie", fold(list.slice(0, 6)), "Prokurator przygotowuje mowę oskarżenia."],
    ["mowa oskarzenia przed debata", fold(list.slice(0, 7)), "Prokurator wygłasza mowę oskarżenia."],
    ["debata: mowi autor ostatniej wypowiedzi", fold(list.slice(0, 8)), "Debata, runda 1 z 1 — mówi Bot ATS."],
    ["czwarta wypowiedz", fold(list.slice(0, 11)), "Debata, runda 1 z 1 — mówi Hiring Manager."],
    ["narada: ostatnie slowo jeszcze widac", fold(list.slice(0, 12)), "Ostatnie słowo: Prokurator. Sędzia się naradza."],
    ["narada bez debaty", fold(envelopes(trial([7, 7, 7, 7, 7], [])).slice(0, 7)), "Sędzia się naradza."],
    ["werdykt", fold(list), "Werdykt ogłoszony."],
    ["przerwanie", fold(envelopes(trial([7, 7, 7, 7, 7], [], true))), "Rozprawa przerwana: budzet"],
    ["utrata polaczenia", { ...fold(list.slice(0, 3)), status: "lost" }, "Utracono połączenie z rozprawą."],
    ["urwany strumien", { ...fold(list.slice(0, 3)), status: "interrupted" }, "Rozprawa urwała się bez werdyktu (np. restart serwera)."],
  ])("%s", (_, court, text) => {
    expect(narrate(court)).toBe(text);
  });

  it("runda z wypowiedzi, nie z licznika rundy: ostatni mowca rundy 1, gdy domena jest juz w rundzie 2", () => {
    const two = envelopes(trial([7, 7, 7, 7, 7], [[null, null, null, null, null], [null, null, null, null, null]]));
    expect(narrate(fold(two.slice(0, 12)))).toBe("Debata, runda 1 z 2 — mówi Prokurator.");
    expect(narrate(fold(two.slice(0, 13)))).toBe("Debata, runda 2 z 2 — mówi Bot ATS.");
  });

  it("stany spoza regul domeny: debata, w ktorej wszyscy juz mowili; przerwanie bez powodu", () => {
    const debate = fold(list.slice(0, 7));
    const base = debate.trial as NonNullable<Court["trial"]>;
    const allSpoke = CRITIC_IDS.map((criticId) => ({ round: 1, criticId, statement: "x", revisedScore: null }));
    expect(narrate({ ...debate, trial: { ...base, statements: allSpoke } })).toBe("Debata, runda 1 z 1 — mówi Prokurator.");
    expect(narrate({ ...debate, trial: { ...base, phase: "aborted", abortReason: null } })).toBe("Rozprawa przerwana: ");
  });
});
