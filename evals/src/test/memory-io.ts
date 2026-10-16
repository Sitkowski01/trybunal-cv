import { FakeLlmClient } from "@trybunal/llm";
import { heuristicScript } from "../heuristic.js";
import type { EvalsIo } from "../io.js";

export const cases = [
  { id: "a", cv: "cvs/a.md", offer: "offers/o.md", expected: "invite", tags: ["mocne"], note: "pasuje" },
  { id: "b", cv: "cvs/b.md", offer: "offers/o.md", expected: "reject", tags: ["slabe"], note: "nie pasuje" },
];

/** Typowe wywolanie `run` na zbiorze w pamieci. */
export const RUN = ["--dataset", "ds", "--out", "wyniki/r1", "--concurrency", "1"];

/**
 * Dysk w pamieci z gotowym zbiorem w ds/. Model to heurystyka udajaca Claude'a, ale z kosztem
 * atrapy (FAKE_USAGE) — widac budzet i wydatki katalogu.
 */
export function memoryIo(over: Partial<EvalsIo> = {}) {
  const files = new Map<string, string>([
    ["ds/cases.json", JSON.stringify(cases)],
    ["ds/cvs/a.md", "Java, Spring Boot, PostgreSQL"],
    ["ds/cvs/b.md", "Lubię gotować."],
    ["ds/offers/o.md", "- Java\n- Spring Boot\n- PostgreSQL"],
  ]);
  const logs: string[] = [];
  const dirs: string[] = [];
  const keys: string[] = [];
  const io: EvalsIo = {
    readText: (path) => {
      const text = files.get(path);
      return text === undefined ? Promise.reject(new Error(`ENOENT ${path}`)) : Promise.resolve(text);
    },
    writeText: (path, text) => {
      files.set(path, text);
      return Promise.resolve();
    },
    appendText: (path, text) => {
      files.set(path, (files.get(path) ?? "") + text);
      return Promise.resolve();
    },
    makeDir: (path) => {
      dirs.push(path);
      return Promise.resolve();
    },
    log: (line) => logs.push(line),
    apiKey: "klucz",
    createLlm: (key) => {
      keys.push(key);
      return new FakeLlmClient(heuristicScript);
    },
    now: () => new Date("2026-10-16T10:00:00Z"),
    ...over,
  };
  return { io, files, logs, dirs, keys };
}
