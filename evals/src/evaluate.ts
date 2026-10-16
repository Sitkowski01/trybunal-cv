import { posix } from "node:path";
import { BudgetedLlmClient, formatUsd, type LlmClient } from "@trybunal/llm";
import { parseRunArgs, UsageError } from "./args.js";
import { heuristicLlm } from "./heuristic.js";
import { type EvalsIo, readDataset } from "./io.js";
import { type Meta, reportMeta } from "./meta.js";
import { outcomeKey, relabel } from "./outcome.js";
import { renderReport } from "./report.js";
import { jobKey, planJobs, runEvals } from "./run.js";

/**
 * `pnpm evals run`: rozprawy zbioru w wariantach i powtorzeniach, wynik po kazdej rozprawie
 * dopisany do outcomes.jsonl, na koncu raport. Zwraca 0 gotowe, 1 przebieg niepelny.
 */
export async function evaluate(argv: readonly string[], io: EvalsIo): Promise<number> {
  const args = parseRunArgs(argv);
  let cases = await readDataset(io, args.dataset);
  if (args.cases !== null) {
    const wanted = args.cases;
    const unknown = wanted.filter((id) => !cases.some((c) => c.id === id));
    if (unknown.length > 0) throw new UsageError(`Nieznane przypadki: ${unknown.join(", ")}`);
    cases = cases.filter((c) => wanted.includes(c.id));
  }

  const metaPath = posix.join(args.out, "meta.json");
  const outcomesPath = posix.join(args.out, "outcomes.jsonl");
  const meta: Meta = { llm: args.llm, repeats: args.repeats, debateRounds: args.debateRounds, startedAt: io.now().toISOString(), dataset: args.dataset, spentNanoUsd: 0 };

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
  // Budzet calego przebiegu jest wspolny dla wszystkich rozpraw.
  const total = new BudgetedLlmClient(source, args.totalLimitNanoUsd);
  const currentMeta = (): Meta => ({ ...meta, spentNanoUsd: total.spentNanoUsd });
  const saveMeta = () => io.writeText(metaPath, `${JSON.stringify(currentMeta(), null, 2)}\n`);
  await saveMeta();

  const plan = { cases, variants: args.variants, repeats: args.repeats, debateRounds: args.debateRounds };
  io.log(`Ewaluacja: ${String(cases.length)} przypadkow x ${String(args.variants.length)} wariantow x ${String(args.repeats)} powtorzen`);
  const fresh = await runEvals(plan, {
    llmFor: () => new BudgetedLlmClient(total, args.trialLimitNanoUsd),
    concurrency: args.concurrency,
    ...(io.signal === undefined ? {} : { signal: io.signal }),
    onOutcome: async (o) => {
      await io.appendText(outcomesPath, `${JSON.stringify(o)}\n`);
      await saveMeta();
      io.log(`${o.variant} ${o.caseId} #${String(o.repeat + 1)}: ${o.decision ?? `przerwana (${String(o.abortReason)})`}, oczekiwano ${o.expected}`);
    },
  });

  await saveMeta();
  const outcomes = fresh;
  await io.writeText(posix.join(args.out, "report.md"), renderReport(reportMeta(currentMeta(), args.out), relabel(outcomes, cases)));
  io.log(`Wydano ${formatUsd(total.spentNanoUsd)}. Raport: ${posix.join(args.out, "report.md")}`);
  const have = new Set(outcomes.map(outcomeKey));
  if (planJobs(plan).some((job) => !have.has(jobKey(job)))) {
    io.log("Przebieg niepelny.");
    return 1;
  }
  return 0;
}
