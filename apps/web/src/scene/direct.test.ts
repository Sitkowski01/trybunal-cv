import { CRITIC_IDS } from "@trybunal/domain";
import { describe, expect, it } from "vitest";
import { envelopes, fold, trial } from "../test/trials.js";
import { emptyCourt } from "../trial/court.js";
import { CHARACTER_IDS } from "./characters.js";
import { BUBBLE_LIMIT, clip, direct, scoreTags, sentenceOf, shotOf } from "./direct.js";

// Pelna rozprawa: wniesienie, 5 ocen, mowa, 2 rundy po 5 wypowiedzi (Tech Lead zmienia zdanie w 1.), werdykt.
const events = envelopes(trial([7, 6, 5, 7, 3], [[null, null, 6, null, null], []]));
const after = (n: number) => direct(fold(events.slice(0, n)));
const FILED = 1;
const ASSESSED = FILED + 5;
const PROSECUTED = ASSESSED + 1;
const ROUND1 = PROSECUTED + 5;
const ALL = events.length;

describe("rezyser sceny", () => {
  it("przed wniesieniem i po przerwaniu: wszyscy czekaja, ujecie ogolne", () => {
    const idle = { shot: "wide", bubble: null, verdict: null, scores: [], actions: Object.fromEntries(CHARACTER_IDS.map((id) => [id, "idle"])) };
    expect(direct(emptyCourt)).toEqual(idle);
    expect(direct(fold(envelopes(trial([5, 5, 5, 5, 5], [[]], true))))).toEqual(idle);
  });

  it("oceny: kto nie ocenil, czyta akta; sedzia czeka", () => {
    const start = after(FILED);
    expect(start.shot).toBe("wide");
    expect(CRITIC_IDS.every((id) => start.actions[id] === "reading")).toBe(true);
    expect(start.actions.judge).toBe("idle");
    const two = after(FILED + 2);
    expect(CRITIC_IDS.map((id) => two.actions[id])).toEqual(["assessed", "assessed", "reading", "reading", "reading"]);
  });

  it("oskarzenie: kamera na prokuratorze, ktory zbiera mysli", () => {
    const d = after(ASSESSED);
    expect(d).toMatchObject({ shot: "prosecutor", bubble: null });
    expect(d.actions.prosecutor).toBe("thinking");
    expect(d.actions.ats).toBe("assessed");
  });

  it("poczatek debaty: w dymku mowa oskarzenia, prokurator wskazuje, pierwszy mowca mysli", () => {
    const d = after(PROSECUTED);
    expect(d.shot).toBe("prosecutor");
    expect(d.bubble).toEqual({ who: "prosecutor", text: "Odrzucic", revisedScore: null });
    expect(d.actions).toMatchObject({ prosecutor: "pointing", ats: "thinking", hr: "listening", judge: "listening" });
  });

  it("debata: dymek nad ostatnim mowca, kamera na nim, nastepny mysli", () => {
    const d = after(PROSECUTED + 3); // ATS, HR i Tech Lead juz mowili
    expect(d.bubble).toEqual({ who: "techLead", text: "...", revisedScore: 6 });
    expect(d.shot).toBe("jury");
    expect(d.actions).toMatchObject({ techLead: "speaking", hiringManager: "thinking", ats: "listening", prosecutor: "listening" });
  });

  it("prokurator w debacie mowi jak inni, a koniec rundy nie ma nastepnego myslacego w tej rundzie", () => {
    const d = after(ROUND1);
    expect(d.bubble?.who).toBe("prosecutor");
    expect(d.shot).toBe("prosecutor");
    expect(d.actions.prosecutor).toBe("speaking");
    expect(d.actions.ats).toBe("thinking"); // runda 2 zaczyna sie od ATS
  });

  it("narada: ostatnie slowo debaty zostaje w dymku, a sedzia sie naradza; potem wyrok", () => {
    const deliberation = after(ALL - 1);
    // Ostatni w 2. rundzie mowi prokurator — jego slowo nie moze zniknac w chwili, gdy zaczyna sie narada.
    expect(deliberation).toMatchObject({ shot: "prosecutor", bubble: { who: "prosecutor", text: "...", revisedScore: null }, verdict: null });
    expect(deliberation.actions).toMatchObject({ judge: "deliberating", prosecutor: "speaking", ats: "listening" });
    const closed = after(ALL);
    // Sedzia oglasza sentencje (pierwszy akapit uzasadnienia).
    expect(closed).toMatchObject({ shot: "judge", verdict: "invite", bubble: { who: "judge", text: "Uzasadnienie", revisedScore: null } });
    expect(closed.actions.judge).toBe("gavel");
    expect(closed.actions.hr).toBe("assessed");
  });

  it("ujecie mowcy", () => {
    expect([shotOf("judge"), shotOf("prosecutor"), shotOf("hr")]).toEqual(["judge", "prosecutor", "jury"]);
  });
});

describe("oceny nad glowami", () => {
  it("pojawiaja sie wraz z ocenami, w kolejnosci miejsc; zmiana zdania pamieta ocene poczatkowa", () => {
    expect(after(FILED).scores).toEqual([]);
    expect(after(FILED + 2).scores).toEqual([
      { who: "ats", score: 7, from: null },
      { who: "hr", score: 6, from: null },
    ]);
    expect(after(ROUND1).scores).toEqual([
      { who: "ats", score: 7, from: null },
      { who: "hr", score: 6, from: null },
      { who: "techLead", score: 6, from: 5 },
      { who: "hiringManager", score: 7, from: null },
      { who: "prosecutor", score: 3, from: null },
    ]);
    expect(after(ALL).scores).toEqual(after(ROUND1).scores);
    expect(scoreTags(emptyCourt)).toEqual([]);
  });
});

describe("sentenceOf", () => {
  it("pierwszy akapit uzasadnienia, splaszczony; bez akapitow — calosc", () => {
    expect(sentenceOf("Zaprosic: stos sie zgadza.\n\nCo przewazylo:\n- testy")).toBe("Zaprosic: stos sie zgadza.");
    expect(sentenceOf("  Odrzucic,\nbo brak Javy.  \n \n Reszta")).toBe("Odrzucic, bo brak Javy.");
    expect(sentenceOf("Jedno zdanie.")).toBe("Jedno zdanie.");
  });
});

describe("clip", () => {
  it("splaszcza odstepy i przycina dluga wypowiedz z wielokropkiem", () => {
    expect(clip("  Po namysle\n\npodnosze   ocene. ")).toBe("Po namysle podnosze ocene.");
    // Ciecie tuz za spacja: wielokropek przylega do slowa.
    expect(clip(`${"a".repeat(BUBBLE_LIMIT - 2)} bbbbb`)).toBe(`${"a".repeat(BUBBLE_LIMIT - 2)}…`);
    const long = clip("slowo ".repeat(100));
    expect(long).toHaveLength(BUBBLE_LIMIT);
    expect(long.endsWith("…")).toBe(true);
    expect(long.at(-2)).not.toBe(" ");
    expect(clip("a".repeat(BUBBLE_LIMIT))).toBe("a".repeat(BUBBLE_LIMIT));
  });
});
