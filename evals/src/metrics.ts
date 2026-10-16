import { type Decision, TAGS, type Tag } from "./dataset.js";
import type { TrialOutcome } from "./outcome.js";

/**
 * Metryki jednego wariantu promptow. Trzy pytania: czy sad trafia w oczekiwany werdykt
 * (trafnosc), czy przy powtorce mowi to samo (stabilnosc) i ile to kosztuje. Przerwane rozprawy
 * nie licza sie do trafnosci — maja osobny wskaznik, zeby nie udawaly ani trafien, ani pomylek.
 */
export interface VariantSummary {
  readonly variant: string;
  readonly trials: number;
  readonly completed: number;
  readonly aborted: number;
  /** Trafione werdykty / zakonczone rozprawy; null, gdy zadna sie nie zakonczyla. */
  readonly accuracy: number | null;
  /** Trafnosc bez przypadkow granicznych — tam rozsadny rekruter moglby orzec inaczej. */
  readonly clearAccuracy: number | null;
  /** Oczekiwany werdykt -> ogloszony werdykt. */
  readonly confusion: Readonly<Record<Decision, Readonly<Record<Decision, number>>>>;
  readonly byTag: readonly TagAccuracy[];
  /** Przypadki, w ktorych werdykt wiekszosci powtorzen rozni sie od oczekiwanego. */
  readonly missedCases: readonly string[];
  readonly cost: Cost;
  /** Czesc tokenow wejscia odczytana z cache — czy wspolny poczatek promptu naprawde sie oplaca. */
  readonly cacheHitRatio: number | null;
  /** Nieudane proby (zly JSON, zmyslony cytat, przeciazenie) / wszystkie proby. */
  readonly retryRate: number | null;
}

export interface TagAccuracy {
  readonly tag: Tag;
  readonly completed: number;
  readonly correct: number;
}

export interface Cost {
  readonly totalNanoUsd: number;
  readonly meanPerTrialNanoUsd: number | null;
  readonly maxPerTrialNanoUsd: number | null;
}

const mean = (values: readonly number[]) => (values.length === 0 ? null : values.reduce((s, v) => s + v, 0) / values.length);
const ratio = (part: number, whole: number) => (whole === 0 ? null : part / whole);

export function stdDev(values: readonly number[]): number {
  const m = mean(values) ?? 0;
  return Math.sqrt(values.reduce((s, v) => s + (v - m) ** 2, 0) / Math.max(values.length, 1));
}

/** Werdykt wiekszosci; przy remisie "reject" — ostrozniej nie obiecywac zaproszenia. */
export function majority(decisions: readonly Decision[]): Decision {
  const invites = decisions.filter((d) => d === "invite").length;
  return invites > decisions.length - invites ? "invite" : "reject";
}

type Completed = TrialOutcome & { readonly decision: Decision; readonly juryAverage: number };
const isCompleted = (o: TrialOutcome): o is Completed => o.decision !== null && o.juryAverage !== null;

type Runs = [Completed, ...Completed[]];

/** Zakonczone rozprawy pogrupowane po przypadku; kazda grupa ma co najmniej jedna rozprawe. */
function byCase(outcomes: readonly Completed[]): Map<string, Runs> {
  const groups = new Map<string, Runs>();
  for (const o of outcomes) {
    const runs = groups.get(o.caseId);
    if (runs === undefined) groups.set(o.caseId, [o]);
    else runs.push(o);
  }
  return groups;
}

export function summarize(variant: string, all: readonly TrialOutcome[]): VariantSummary {
  const outcomes = all.filter((o) => o.variant === variant);
  const completed = outcomes.filter(isCompleted);
  const correct = completed.filter((o) => o.decision === o.expected);
  const clear = completed.filter((o) => !o.tags.includes("graniczny"));
  const cell = (expected: Decision, actual: Decision) => completed.filter((o) => o.expected === expected && o.decision === actual).length;
  const groups = byCase(completed);
  const costs = outcomes.map((o) => o.costNanoUsd);
  const sum = (pick: (o: TrialOutcome) => number) => outcomes.reduce((s, o) => s + pick(o), 0);
  const allInput = sum((o) => o.inputTokens + o.cacheWriteTokens + o.cacheReadTokens);

  return {
    variant,
    trials: outcomes.length,
    completed: completed.length,
    aborted: outcomes.length - completed.length,
    accuracy: ratio(correct.length, completed.length),
    clearAccuracy: ratio(clear.filter((o) => o.decision === o.expected).length, clear.length),
    confusion: {
      invite: { invite: cell("invite", "invite"), reject: cell("invite", "reject") },
      reject: { invite: cell("reject", "invite"), reject: cell("reject", "reject") },
    },
    byTag: TAGS.flatMap((tag) => {
      const tagged = completed.filter((o) => o.tags.includes(tag));
      return tagged.length === 0 ? [] : [{ tag, completed: tagged.length, correct: tagged.filter((o) => o.decision === o.expected).length }];
    }),
    missedCases: [...groups].filter(([, runs]) => majority(runs.map((r) => r.decision)) !== runs[0].expected).map(([id]) => id),
    cost: {
      totalNanoUsd: sum((o) => o.costNanoUsd),
      meanPerTrialNanoUsd: mean(costs),
      maxPerTrialNanoUsd: costs.length === 0 ? null : Math.max(...costs),
    },
    cacheHitRatio: ratio(sum((o) => o.cacheReadTokens), allInput),
    retryRate: ratio(sum((o) => o.failedAttempts), sum((o) => o.attempts)),
  };
}
