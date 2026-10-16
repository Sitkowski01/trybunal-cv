import type { LlmClient } from "@trybunal/llm";
import { UsageError } from "./args.js";
import { type EvalCase, loadDataset } from "./dataset.js";

/** Dysk, konsola, model i zegar wstrzykiwane, zeby CLI dalo sie przetestowac bez dysku i bez sieci. */
export interface EvalsIo {
  /** Odczyt pliku; brak pliku = odrzucona obietnica. */
  readonly readText: (path: string) => Promise<string>;
  readonly writeText: (path: string, text: string) => Promise<void>;
  readonly appendText: (path: string, text: string) => Promise<void>;
  readonly makeDir: (path: string) => Promise<void>;
  readonly log: (line: string) => void;
  readonly apiKey: string | undefined;
  readonly createLlm: (apiKey: string) => LlmClient;
  readonly signal?: AbortSignal;
  readonly now: () => Date;
}

/** Tresc pliku albo null, gdy go nie ma (np. pierwszy przebieg w katalogu). */
export async function readOptional(io: EvalsIo, path: string): Promise<string | null> {
  try {
    return await io.readText(path);
  } catch {
    return null;
  }
}

export async function readDataset(io: EvalsIo, dir: string): Promise<EvalCase[]> {
  try {
    return await loadDataset(dir, io.readText);
  } catch (error) {
    throw new UsageError(`Nie mozna wczytac zbioru ${dir}: ${(error as Error).message}`);
  }
}
