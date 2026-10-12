import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { parseArgs } from "node:util";
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

/** Plik i konsola wstrzykiwane, zeby CLI dalo sie przetestowac bez dysku i bez sieci. */
export interface CliIo {
  readonly readText: (path: string) => Promise<string>;
  readonly writeText: (path: string, text: string) => Promise<void>;
  readonly log: (line: string) => void;
  readonly apiKey: string | undefined;
  readonly createLlm?: (apiKey: string) => LlmClient;
}

export const USAGE = `Uzycie: pnpm trial --cv <plik> --offer <plik> [--rounds 1] [--budget-usd 1] [--out out/] [--replay kaseta.json]`;

/** Zwraca kod wyjscia: 0 werdykt, 1 rozprawa przerwana, 2 bledne wywolanie. */
export async function main(argv: readonly string[], io: CliIo): Promise<number> {
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
    io.log(`${(error as Error).message}\n${USAGE}`);
    return 2;
  }
  const rounds = Number(args.rounds);
  const budgetUsd = Number(args["budget-usd"]);
  if (args.cv === undefined || args.offer === undefined || !Number.isInteger(rounds) || !(budgetUsd > 0)) {
    io.log(USAGE);
    return 2;
  }
  // Zrodlo odpowiedzi: nagranie (bez klucza i kosztow) albo Claude z nagrywaniem tej rozprawy.
  let source: LlmClient;
  let recorder: RecordingLlmClient | undefined;
  if (args.replay !== undefined) {
    source = new ReplayLlmClient(CassetteSchema.parse(JSON.parse(await io.readText(args.replay))));
  } else if (io.apiKey !== undefined) {
    recorder = new RecordingLlmClient((io.createLlm ?? AnthropicLlmClient.fromApiKey)(io.apiKey));
    source = recorder;
  } else {
    io.log("Brak ANTHROPIC_API_KEY (w srodowisku albo w pliku .env). Bez klucza mozna odtworzyc nagranie: --replay.");
    return 2;
  }
  const llm = new BudgetedLlmClient(source, Math.round(budgetUsd * 1e9));

  const run = await runTrial(
    { trialId: randomUUID(), cvText: await io.readText(args.cv), jobOffer: await io.readText(args.offer), debateRounds: rounds },
    { llm, onEvent: (event, state) => { io.log(narrate(event, state)); } },
  );

  await io.writeText(join(args.out, "events.json"), JSON.stringify(run.events, null, 2));
  await io.writeText(join(args.out, "calls.json"), JSON.stringify(run.calls, null, 2));
  if (recorder !== undefined) {
    await io.writeText(join(args.out, "cassette.json"), JSON.stringify(recorder.cassette(), null, 2));
  }
  io.log(costSummary(run.calls));
  return run.state.phase === "closed" ? 0 : 1;
}
