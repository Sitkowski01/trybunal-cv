import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { TrialEventSchema } from "@trybunal/domain";
import {
  AnthropicLlmClient,
  BudgetedLlmClient,
  CassetteSchema,
  type LlmClient,
  RecordingLlmClient,
  ReplayLlmClient,
} from "@trybunal/llm";
import { costSummary, narrate } from "./narration.js";
import { runTrial } from "./runner.js";

/** Plik, katalog, konsola i model wstrzykiwane, zeby CLI dalo sie przetestowac bez dysku i bez sieci. */
export interface CliIo {
  readonly readText: (path: string) => Promise<string>;
  readonly writeText: (path: string, text: string) => Promise<void>;
  readonly makeDir: (path: string) => Promise<void>;
  readonly log: (line: string) => void;
  readonly apiKey: string | undefined;
  readonly createLlm?: (apiKey: string) => LlmClient;
  /** Ctrl+C: rozprawa konczy sie zdarzeniem TrialAborted, a pliki i tak sie zapisza. */
  readonly signal?: AbortSignal;
  readonly newId?: () => string;
}

export const USAGE = `Uzycie: pnpm trial --cv <plik> --offer <plik> [--rounds 1] [--budget-usd 1] [--out out/] [--replay kaseta.json]`;

/** Blad wywolania: zle argumenty albo pliki. Wykryty, zanim zaplacimy za pierwsze zapytanie. */
class UsageError extends Error {}

async function read(io: CliIo, path: string, what: string): Promise<string> {
  try {
    return await io.readText(path);
  } catch (error) {
    throw new UsageError(`Nie mozna odczytac pliku ${what} (${path}): ${(error as Error).message}`);
  }
}

/** Zwraca kod wyjscia: 0 werdykt, 1 rozprawa przerwana, 2 bledne wywolanie. */
export async function main(argv: readonly string[], io: CliIo): Promise<number> {
  try {
    return await run(argv, io);
  } catch (error) {
    if (error instanceof UsageError) {
      io.log(error.message);
      return 2;
    }
    throw error;
  }
}

async function run(argv: readonly string[], io: CliIo): Promise<number> {
  let args;
  try {
    args = parseArgs({
      args: [...argv],
      options: {
        cv: { type: "string" },
        offer: { type: "string" },
        rounds: { type: "string", default: "1" },
        "budget-usd": { type: "string", default: "1" },
        out: { type: "string", default: "out" },
        replay: { type: "string" },
      },
    }).values;
  } catch (error) {
    throw new UsageError(`${(error as Error).message}\n${USAGE}`);
  }
  const rounds = Number(args.rounds);
  const budgetUsd = Number(args["budget-usd"]);
  if (args.cv === undefined || args.offer === undefined || args.rounds.trim() === "" || !(budgetUsd > 0)) {
    throw new UsageError(USAGE);
  }

  // Wejscie sprawdzone tym samym schematem co zdarzenie wniesienia sprawy — przed oplacona rozprawa.
  const trialId = (io.newId ?? randomUUID)();
  const input = { trialId, cvText: await read(io, args.cv, "CV"), jobOffer: await read(io, args.offer, "oferty"), debateRounds: rounds };
  const filed = TrialEventSchema.safeParse({ type: "TrialFiled", ...input });
  if (!filed.success) {
    throw new UsageError(`Niepoprawne dane rozprawy: ${describeIssues(filed.error.issues)}`);
  }

  let source: LlmClient;
  let recorder: RecordingLlmClient | undefined;
  if (args.replay !== undefined) {
    const parsed = CassetteSchema.safeParse(parseJson(await read(io, args.replay, "nagrania")));
    if (!parsed.success) {
      throw new UsageError(`Niepoprawne nagranie ${args.replay}: ${describeIssues(parsed.error.issues)}`);
    }
    source = new ReplayLlmClient(parsed.data);
  } else if (io.apiKey !== undefined) {
    recorder = new RecordingLlmClient((io.createLlm ?? AnthropicLlmClient.fromApiKey)(io.apiKey));
    source = recorder;
  } else {
    throw new UsageError("Brak ANTHROPIC_API_KEY (w srodowisku albo w pliku .env). Bez klucza mozna odtworzyc nagranie: --replay.");
  }

  // Katalog na wyniki przed rozprawa: blad zapisu ma wyjsc, zanim zaplacimy, a nie po.
  const outDir = join(args.out, trialId);
  try {
    await io.makeDir(outDir);
  } catch (error) {
    throw new UsageError(`Nie mozna utworzyc katalogu ${outDir}: ${(error as Error).message}`);
  }

  const llm = new BudgetedLlmClient(source, Math.round(budgetUsd * 1e9));
  const result = await runTrial(input, {
    llm,
    ...(io.signal === undefined ? {} : { signal: io.signal }),
    onEvent: (event, state) => {
      io.log(narrate(event, state));
    },
  });

  // Najpierw nagranie — to za nie zaplacilismy i jego nie da sie odtworzyc.
  if (recorder !== undefined) {
    await io.writeText(join(outDir, "cassette.json"), JSON.stringify(recorder.cassette(), null, 2));
  }
  await io.writeText(join(outDir, "events.json"), JSON.stringify(result.events, null, 2));
  await io.writeText(join(outDir, "calls.json"), JSON.stringify(result.calls, null, 2));
  io.log(costSummary(result.calls));
  io.log(`Wyniki: ${outDir}`);
  return result.state.phase === "closed" ? 0 : 1;
}

/** Problemy ze schematem: sciezka pola i komunikat, wszystkie po sredniku. */
function describeIssues(issues: readonly { readonly path: readonly PropertyKey[]; readonly message: string }[]): string {
  return issues.map((i) => `${i.path.map(String).join(".") || "(calosc)"}: ${i.message}`).join("; ");
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new UsageError(`Nagranie nie jest poprawnym JSON-em: ${(error as Error).message}`);
  }
}
