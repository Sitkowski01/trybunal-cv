import { formatUsd } from "@trybunal/llm";
import { caseDifferences, type MajorityVerdict, summarize, type VariantSummary, variantsOf } from "./metrics.js";
import type { TrialOutcome } from "./outcome.js";

/** Raport do repozytorium: tabela metryk wariantow, bledy wedlug tagow i roznice miedzy wariantami. */

const pct = (value: number | null) => (value === null ? "—" : `${(value * 100).toFixed(0)}%`);
const num = (value: number | null) => (value === null ? "—" : value.toFixed(2));
const usd = (value: number) => formatUsd(Math.round(value));
const list = (items: readonly string[]) => (items.length === 0 ? "—" : items.join(", "));
const verdictLabel = (verdict: MajorityVerdict) => (verdict === "tie" ? "remis" : verdict);

function row(cells: readonly string[]): string {
  return `| ${cells.join(" | ")} |`;
}

function table(header: readonly string[], rows: readonly (readonly string[])[]): string[] {
  return [row(header), row(header.map(() => "---")), ...rows.map(row)];
}

function metricsTable(summaries: readonly VariantSummary[]): string[] {
  const line = (name: string, pick: (s: VariantSummary) => string) => [name, ...summaries.map(pick)];
  return table(
    ["Metryka", ...summaries.map((s) => s.variant)],
    [
      line("Rozprawy (zakończone / wszystkie)", (s) => `${String(s.completed)} / ${String(s.trials)}`),
      line("Trafność werdyktu", (s) => pct(s.accuracy)),
      line("Trafność bez przypadków granicznych", (s) => pct(s.clearAccuracy)),
      line("Fałszywe zaproszenia (oczekiwano odrzucenia)", (s) => String(s.confusion.reject.invite)),
      line("Fałszywe odrzucenia (oczekiwano zaproszenia)", (s) => String(s.confusion.invite.reject)),
      line("Zgodność powtórzeń", (s) => pct(s.stability.agreement)),
      line("Odchylenie średniej przysięgłych", (s) => num(s.stability.juryAverageStdDev)),
      line("Koszt łącznie", (s) => usd(s.cost.totalNanoUsd)),
      // Wariant trafia do raportu tylko z co najmniej jedna rozprawa, wiec srednia i maksimum istnieja.
      line("Koszt rozprawy (średni / maks.)", (s) => `${usd(s.cost.meanPerTrialNanoUsd ?? 0)} / ${usd(s.cost.maxPerTrialNanoUsd ?? 0)}`),
      line("Wejście z cache", (s) => pct(s.cacheHitRatio)),
      line("Ponowione zapytania", (s) => pct(s.retryRate)),
    ],
  );
}

function tagTable(summaries: readonly VariantSummary[]): string[] {
  const tags = [...new Set(summaries.flatMap((s) => s.byTag.map((t) => t.tag)))];
  return table(
    ["Tag", ...summaries.map((s) => s.variant)],
    tags.map((tag) => [
      tag,
      ...summaries.map((s) => {
        const t = s.byTag.find((b) => b.tag === tag);
        return t === undefined ? "—" : `${String(t.correct)}/${String(t.completed)}`;
      }),
    ]),
  );
}

/** Powod nieudanej proby po ludzku (CallRecord.outcome z orkiestracji). */
const REASONS: Readonly<Record<string, string>> = {
  rejected: "cytat spoza CV",
  invalid: "zły schemat odpowiedzi",
  incomplete: "limit tokenów",
  transport: "błąd API",
};

/** Klucz "krok/powod" (zob. countFailures); powod bez opisu zostaje jak jest. */
const describeFailure = (key: string) => {
  const slash = key.lastIndexOf("/");
  const reason = key.slice(slash + 1);
  return `${key.slice(0, slash)} — ${REASONS[reason] ?? reason}`;
};

/** Skad biora sie ponowienia: krok i powod, liczba nieudanych prob w kazdym wariancie. */
function failureTable(summaries: readonly VariantSummary[]): string[] {
  const keys = [...new Set(summaries.flatMap((s) => s.failures.map((f) => f.key)))];
  return table(
    ["Krok — powód", ...summaries.map((s) => s.variant)],
    keys.map((key) => [describeFailure(key), ...summaries.map((s) => String(s.failures.find((f) => f.key === key)?.count ?? 0))]),
  );
}

export interface ReportMeta {
  readonly title: string;
  readonly date: string;
  readonly repeats: number;
  readonly debateRounds: number;
  readonly llm: string;
  /** Wszystko, co zaplacono, rowniez za rozprawy odrzucone przy przerwaniu — tabela liczy tylko zapisane. */
  readonly spentNanoUsd: number;
}

export function renderReport(meta: ReportMeta, outcomes: readonly TrialOutcome[]): string {
  const variants = variantsOf(outcomes);
  const summaries = variants.map((v) => summarize(v, outcomes));
  const cases = new Set(outcomes.map((o) => o.caseId)).size;
  const header = [
    `# ${meta.title}`,
    "",
    `${meta.date} · ${meta.llm} · przypadki: ${String(cases)} · powtórzenia: ${String(meta.repeats)} · rundy debaty: ${String(meta.debateRounds)}`,
    "",
    `Wydano łącznie: ${usd(meta.spentNanoUsd)} (z rozprawami przerwanymi przez budżet przebiegu albo Ctrl+C, których wyników nie zapisano).`,
    "",
  ];
  if (variants.length === 0) return `${[...header, "Brak wyników — żadna rozprawa nie została zapisana."].join("\n")}\n`;
  const lines = [
    ...header,
    "## Metryki",
    "",
    ...metricsTable(summaries),
    "",
    "## Trafność według tagów (trafione / zakończone)",
    "",
    ...tagTable(summaries),
    "",
    // Tylko gdy cos sie nie udalo — raporty bez ponowien (heurystyka) zostaja bez zmian.
    ...(summaries.some((s) => s.failures.length > 0) ? ["## Nieudane próby według kroku i powodu", "", ...failureTable(summaries), ""] : []),
    "## Przypadki do obejrzenia",
    "",
    ...summaries.flatMap((s) => [
      `- **${s.variant}** — chybione (werdykt większości ≠ oczekiwany): ${list(s.missedCases)}; niestabilne: ${list(s.stability.flippingCases)}` +
        (s.tiedCases.length === 0 ? "" : `; remis (do powtórzenia): ${list(s.tiedCases)}`),
    ]),
  ];
  const [base = "", ...candidates] = variants;
  for (const candidate of candidates) {
    const diffs = caseDifferences(outcomes, base, candidate);
    lines.push(
      "",
      `## ${base} → ${candidate}: przypadki ze zmienionym werdyktem`,
      "",
      ...(diffs.length === 0
        ? ["Brak — oba warianty ogłaszają te same werdykty większości."]
        : table(
            ["Przypadek", "Oczekiwany", base, candidate],
            diffs.map((d) => [d.caseId, d.expected, verdictLabel(d.base), verdictLabel(d.candidate)]),
          )),
    );
  }
  return `${lines.join("\n")}\n`;
}
