import { PROMPTS } from "@trybunal/court";
import { describe, expect, it } from "vitest";
import { HEURISTIC_VARIANT, parseRunArgs, USAGE, UsageError } from "./args.js";
import { PROMPTS_V2 } from "./variants.js";

describe("parseRunArgs", () => {
  it("wartosci domyslne: Claude, oba warianty, 3 powtorzenia, budzet 15 USD i 1 USD na rozprawe", () => {
    expect(parseRunArgs(["--out", "x"])).toEqual({
      out: "x",
      llm: "anthropic",
      variants: [PROMPTS, PROMPTS_V2],
      repeats: 3,
      debateRounds: 1,
      cases: null,
      concurrency: 2,
      totalLimitNanoUsd: 15e9,
      trialLimitNanoUsd: 1e9,
      dataset: "evals/dataset",
      retryAborted: false,
    });
  });

  it("wszystkie opcje; listy przycinane z odstepow", () => {
    const argv = ["--out", "y", "--variants", "v2-kotwice ", "--repeats", "5", "--rounds", "0", "--cases", "a, b", "--concurrency", "4"];
    const more = ["--budget-usd", "2.5", "--trial-budget-usd", "0.25", "--dataset", "ds", "--retry-aborted"];
    expect(parseRunArgs([...argv, ...more])).toEqual({
      out: "y",
      llm: "anthropic",
      variants: [PROMPTS_V2],
      repeats: 5,
      debateRounds: 0,
      cases: ["a", "b"],
      concurrency: 4,
      totalLimitNanoUsd: 2.5e9,
      trialLimitNanoUsd: 0.25e9,
      dataset: "ds",
      retryAborted: true,
    });
  });

  it("heurystyka ignoruje --variants: jeden wariant o wlasnej nazwie", () => {
    const args = parseRunArgs(["--out", "x", "--llm", "heuristic", "--variants", "v1"]);
    expect(args.variants).toEqual([HEURISTIC_VARIANT]);
    expect(HEURISTIC_VARIANT).toEqual({ ...PROMPTS, version: "heurystyka" });
  });

  it.each([
    ["bez --out", [], USAGE],
    ["nieznana opcja", ["--out", "x", "--foo"], "Unknown option '--foo'"],
    ["zly model", ["--llm", "gpt"], "--llm: anthropic albo heuristic"],
    ["zero powtorzen", ["--repeats", "0"], "--repeats: liczba calkowita >= 1"],
    ["ulamek rund", ["--rounds", "1.5"], "--rounds: liczba calkowita >= 0"],
    ["puste rundy", ["--rounds", " "], "--rounds: liczba calkowita >= 0"],
    ["zero rownoleglosci", ["--concurrency", "0"], "--concurrency: liczba calkowita >= 1"],
    ["zerowy budzet", ["--budget-usd", "0"], "--budget-usd: kwota w USD wieksza od zera"],
    ["budzet rozprawy nie liczba", ["--trial-budget-usd", "abc"], "--trial-budget-usd: kwota w USD wieksza od zera"],
    ["nieznany wariant", ["--variants", "v1,v9"], "Nieznany wariant: v9. Dostepne: v1, v2-kotwice"],
  ])("bledne wywolanie (%s): UsageError z komunikatem", (name, argv, message) => {
    const full = name === "bez --out" || name === "nieznana opcja" ? argv : ["--out", "x", ...argv];
    expect(() => parseRunArgs(full)).toThrow(UsageError);
    expect(() => parseRunArgs(full)).toThrow(message);
  });

  it("bledy liczb koncza sie podpowiedzia uzycia", () => {
    expect(() => parseRunArgs(["--out", "x", "--repeats", "0"])).toThrow(`--repeats: liczba calkowita >= 1\n${USAGE}`);
  });
});
