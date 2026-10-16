import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { HEURISTIC_VARIANT } from "./args.js";
import { main } from "./cli.js";
import { loadDataset } from "./dataset.js";
import { heuristicLlm } from "./heuristic.js";
import { parseOutcomes } from "./outcome.js";
import { runEvals } from "./run.js";

/**
 * Wyniki heurystyki zapisane w repozytorium musza zgadzac sie z biezacym kodem i zbiorem.
 * Zmiana CV, etykiety albo metryk bez odswiezenia raportu wywali ten test, zamiast zostawic
 * w README nieaktualne liczby. Odswiezenie: pnpm evals run --llm heuristic --repeats 1 --out evals/results/heurystyka
 */
// Sciezki w meta.json sa liczone od korzenia repo; czytamy wzgledem pakietu, bo Stryker kopiuje tylko pakiet.
const pkg = fileURLToPath(new URL("../", import.meta.url));
const read = (path: string) => readFile(`${pkg}${path.replace(/^evals\//, "")}`, "utf8");
const DIR = "evals/results/heurystyka";

describe("wyniki heurystyki w repozytorium", () => {
  it("rozprawy na biezacym zbiorze daja te same wyniki co zapisane", async () => {
    const cases = await loadDataset("evals/dataset", read);
    const fresh = await runEvals({ cases, variants: [HEURISTIC_VARIANT], repeats: 1, debateRounds: 1 }, { llmFor: heuristicLlm, concurrency: 4, onOutcome: () => undefined });
    const saved = parseOutcomes(await read(`${DIR}/outcomes.jsonl`));
    const byKey = (o: { caseId: string }) => o.caseId;
    expect([...fresh].sort((a, b) => byKey(a).localeCompare(byKey(b)))).toEqual([...saved].sort((a, b) => byKey(a).localeCompare(byKey(b))));
  });

  it("raport odtworzony z zapisanych wynikow jest identyczny z zapisanym", async () => {
    const written = new Map<string, string>();
    const code = await main(["report", DIR], {
      readText: read,
      writeText: (path, text) => {
        written.set(path, text);
        return Promise.resolve();
      },
      appendText: () => Promise.reject(new Error("raport nie dopisuje")),
      makeDir: () => Promise.resolve(),
      log: () => undefined,
      apiKey: undefined,
      createLlm: heuristicLlm,
      now: () => new Date(0),
    });
    expect(code).toBe(0);
    expect(written.get(`${DIR}/report.md`)).toBe(await read(`${DIR}/report.md`));
  });
});
