import { posix } from "node:path";
import { BudgetExceededError, BudgetedLlmClient, formatUsd, type LlmClient } from "@trybunal/llm";
import { parseRunArgs, UsageError } from "./args.js";
import { heuristicLlm } from "./heuristic.js";
import { datasetHash } from "./dataset.js";
import { type EvalsIo, readDataset, readOptional } from "./io.js";
import { type Meta, MetaSchema, reportMeta } from "./meta.js";
import { latestOutcomes, outcomeKey, parseOutcomes, relabel } from "./outcome.js";
import { renderReport } from "./report.js";
import { jobKey, planJobs, runEvals } from "./run.js";

/**
 * `pnpm evals run`: rozprawy zbioru w wariantach i powtorzeniach, wynik po kazdej rozprawie
 * dopisany do outcomes.jsonl, na koncu raport. Zwraca 0 gotowe, 1 przebieg niepelny.
 */
export async function evaluate(argv: readonly string[], io: EvalsIo): Promise<number> {
  const args = parseRunArgs(argv);
  let cases = await readDataset(io, args.dataset);
  // Odcisk calego zbioru, przed zawezeniem --cases: wznowienie z innym --cases to wciaz ten sam zbior.
  const hash = datasetHash(cases);
  if (args.cases !== null) {
    const wanted = args.cases;
    const unknown = wanted.filter((id) => !cases.some((c) => c.id === id));
    if (unknown.length > 0) throw new UsageError(`Nieznane przypadki: ${unknown.join(", ")}`);
    cases = cases.filter((c) => wanted.includes(c.id));
  }

  // Wznowienie: te same parametry co zapisane, a gotowe rozprawy pomijamy.
  const metaPath = posix.join(args.out, "meta.json");
  const outcomesPath = posix.join(args.out, "outcomes.jsonl");
  const savedMeta = await readOptional(io, metaPath);
  const meta: Meta =
    savedMeta === null
      ? {
          llm: args.llm,
          repeats: args.repeats,
          debateRounds: args.debateRounds,
          startedAt: io.now().toISOString(),
          dataset: args.dataset,
          spentNanoUsd: 0,
          datasetHash: hash,
        }
      : MetaSchema.parse(JSON.parse(savedMeta));
  if (meta.llm !== args.llm || meta.debateRounds !== args.debateRounds) {
    throw new UsageError(`${args.out} zawiera przebieg z innymi parametrami (llm ${meta.llm}, rundy ${String(meta.debateRounds)}) — wybierz inny katalog`);
  }
  if (meta.datasetHash !== undefined && meta.datasetHash !== hash) {
    throw new UsageError(`${args.out} zaczeto na innym zbiorze (zmienily sie CV albo oferty) — wyniki nie bylyby porownywalne, wybierz inny katalog`);
  }
  const previous = latestOutcomes(parseOutcomes((await readOptional(io, outcomesPath)) ?? ""));
  // Limit dotyczy calego katalogu: wznowienie dostaje tylko to, co zostalo.
  const remaining = args.totalLimitNanoUsd - meta.spentNanoUsd;
  if (remaining <= 0) {
    throw new UsageError(`Budzet wyczerpany: w ${args.out} wydano juz ${formatUsd(meta.spentNanoUsd)} z limitu ${formatUsd(args.totalLimitNanoUsd)} — podnies --budget-usd`);
  }

  let source: LlmClient;
  if (args.llm === "heuristic") {
    source = heuristicLlm();
  } else if (io.apiKey !== undefined) {
    source = io.createLlm(io.apiKey);
  } else {
    throw new UsageError("Brak ANTHROPIC_API_KEY (w srodowisku albo w pliku .env). Bez klucza: --llm heuristic albo pnpm evals report.");
  }

  try {
    await io.makeDir(args.out);
  } catch (error) {
    throw new UsageError(`Nie mozna utworzyc katalogu ${args.out}: ${(error as Error).message}`);
  }
  // Budzet calego przebiegu jest wspolny; jego wyczerpanie zatrzymuje ewaluacje, a nie ocenia CV.
  const total = new BudgetedLlmClient(source, remaining);
  // Wiecej powtorzen przy wznowieniu dopisuje kolejne; mniej niczego nie kasuje.
  const currentMeta = (): Meta => ({ ...meta, repeats: Math.max(meta.repeats, args.repeats), spentNanoUsd: meta.spentNanoUsd + total.spentNanoUsd });
  const saveMeta = () => io.writeText(metaPath, `${JSON.stringify(currentMeta(), null, 2)}\n`);
  await saveMeta();
  const budget = { exhausted: false };
  const guarded: LlmClient = {
    generate: async (request, signal) => {
      try {
        return await total.generate(request, signal);
      } catch (error) {
        if (error instanceof BudgetExceededError) budget.exhausted = true;
        throw error;
      }
    },
  };

  const plan = { cases, variants: args.variants, repeats: args.repeats, debateRounds: args.debateRounds };
  // --retry-aborted: przerwane rozprawy (np. limit jednej rozprawy) ida jeszcze raz; nowy wynik zastapi stary.
  const done = new Set(previous.filter((o) => !args.retryAborted || o.decision !== null).map(outcomeKey));
  io.log(`Ewaluacja: ${String(cases.length)} przypadkow x ${String(args.variants.length)} wariantow x ${String(args.repeats)} powtorzen; gotowe wczesniej: ${String(done.size)}`);
  const fresh = await runEvals(plan, {
    llmFor: () => new BudgetedLlmClient(guarded, args.trialLimitNanoUsd),
    concurrency: args.concurrency,
    done,
    halted: () => budget.exhausted,
    ...(io.signal === undefined ? {} : { signal: io.signal }),
    onOutcome: async (o) => {
      await io.appendText(outcomesPath, `${JSON.stringify(o)}\n`);
      await saveMeta();
      io.log(`${o.variant} ${o.caseId} #${String(o.repeat + 1)}: ${o.decision ?? `przerwana (${String(o.abortReason)})`}, oczekiwano ${o.expected}`);
    },
  });

  await saveMeta();
  const outcomes = latestOutcomes([...previous, ...fresh]);
  await io.writeText(posix.join(args.out, "report.md"), renderReport(reportMeta(currentMeta(), args.out), relabel(outcomes, cases)));
  io.log(`Wydano ${formatUsd(total.spentNanoUsd)} (w katalogu lacznie ${formatUsd(currentMeta().spentNanoUsd)}). Raport: ${posix.join(args.out, "report.md")}`);
  const have = new Set(outcomes.map(outcomeKey));
  if (planJobs(plan).some((job) => !have.has(jobKey(job)))) {
    io.log(
      budget.exhausted
        ? "Budzet przebiegu wyczerpany (zapytania rezerwuja najgorszy koszt, wiec stop moze przyjsc przed limitem) — dokoncz tym samym poleceniem z wiekszym --budget-usd; limit liczy sie dla calego katalogu."
        : "Przebieg niepelny — uruchom to samo polecenie, zeby dokonczyc.",
    );
    return 1;
  }
  return 0;
}
