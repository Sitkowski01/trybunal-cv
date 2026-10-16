import { posix } from "node:path";
import { USAGE, UsageError } from "./args.js";
import { evaluate } from "./evaluate.js";
import { type EvalsIo, readDataset, readOptional } from "./io.js";
import { MetaSchema, reportMeta } from "./meta.js";
import { latestOutcomes, parseOutcomes, relabel } from "./outcome.js";
import { renderReport } from "./report.js";

/** Zwraca kod wyjscia: 0 gotowe, 1 przebieg niepelny (budzet, Ctrl+C), 2 bledne wywolanie. */
export async function main(argv: readonly string[], io: EvalsIo): Promise<number> {
  try {
    const [command, ...rest] = argv;
    if (command === "run") return await evaluate(rest, io);
    if (command === "report" && rest.length === 1 && rest[0] !== undefined) return await report(rest[0], io);
    throw new UsageError(USAGE);
  } catch (error) {
    if (error instanceof UsageError) {
      io.log(error.message);
      return 2;
    }
    throw error;
  }
}

/** `pnpm evals report`: raport od nowa z zapisanych wynikow i biezacych etykiet zbioru, bez modelu. */
async function report(dir: string, io: EvalsIo): Promise<number> {
  const metaText = await readOptional(io, posix.join(dir, "meta.json"));
  const outcomesText = await readOptional(io, posix.join(dir, "outcomes.jsonl"));
  if (metaText === null || outcomesText === null) throw new UsageError(`${dir}: brak meta.json albo outcomes.jsonl`);
  const meta = MetaSchema.parse(JSON.parse(metaText));
  const cases = await readDataset(io, meta.dataset);
  const outcomes = relabel(latestOutcomes(parseOutcomes(outcomesText)), cases);
  await io.writeText(posix.join(dir, "report.md"), renderReport(reportMeta(meta, dir), outcomes));
  io.log(`Raport: ${posix.join(dir, "report.md")}`);
  return 0;
}
