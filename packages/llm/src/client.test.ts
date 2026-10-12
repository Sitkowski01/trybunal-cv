import { describe, expect, it } from "vitest";
import { z } from "zod";
import { IncompleteOutputError, InvalidOutputError, LlmError, LlmTransportError, parseOutput } from "./client.js";
import { costNanoUsd } from "./pricing.js";

const USAGE = { inputTokens: 1000, outputTokens: 200, cacheWriteTokens: 0, cacheReadTokens: 0 };
const Answer = z.object({ score: z.number().int().min(1).max(10), note: z.string().trim().min(1) });

describe("parseOutput", () => {
  it("zwraca dane po schemacie, z jego transformacjami", () => {
    expect(parseOutput('{"score":7,"note":"  ok "}', Answer, "claude-haiku-5-5", USAGE)).toEqual({ score: 7, note: "ok" });
  });

  it("tekst, ktory nie jest JSON-em, to InvalidOutputError z surowa odpowiedzia", () => {
    const error = catchError(() => parseOutput("Oto ocena: 7", Answer, "claude-haiku-5-5", USAGE));
    expect(error).toBeInstanceOf(InvalidOutputError);
    expect(error).toMatchObject({ rawOutput: "Oto ocena: 7", problems: ["odpowiedz nie jest poprawnym JSON-em"] });
  });

  it("naruszenie schematu wymienia pola, ktore sa zle", () => {
    const error = catchError(() => parseOutput('{"score":11,"note":""}', Answer, "claude-haiku-5-5", USAGE));
    // Tresc komunikatow pochodzi z zod; sprawdzamy, ktorych pol dotycza.
    expect((error as InvalidOutputError).problems.map((p) => p.split(":")[0])).toEqual(["score", "note"]);
    expect((error as Error).message).toContain("Odpowiedz modelu nie spelnia schematu: score:");
  });

  it("brak odpowiedzi to LlmTransportError: bez kodu i retry-after, gdy ich nie ma", () => {
    expect(new LlmTransportError("timeout", true, true)).toMatchObject({
      name: "LlmTransportError",
      message: "timeout",
      retryable: true,
      mayHaveBeenBilled: true,
      status: null,
      retryAfterMs: null,
    });
  });

  it("sciezka zagniezdzonego pola po kropkach, problemy w komunikacie po sredniku", () => {
    const Nested = z.object({ a: z.object({ b: z.number(), c: z.number() }) });
    const error = catchError(() => parseOutput('{"a":{"b":"x","c":"y"}}', Nested, "claude-haiku-5-5", USAGE)) as InvalidOutputError;
    expect(error.problems.map((p) => p.split(":")[0])).toEqual(["a.b", "a.c"]);
    expect(error.message).toMatch(/^Odpowiedz modelu nie spelnia schematu: a\.b: .+; a\.c: .+$/);
  });

  it("blad calego obiektu ma czytelna sciezke", () => {
    const error = catchError(() => parseOutput("[]", Answer, "claude-haiku-5-5", USAGE)) as InvalidOutputError;
    expect(error.problems[0]).toMatch(/^\(calosc\): /);
  });
});

describe("bledy modelu", () => {
  it("niosa koszt zuzytych tokenow, bo za nieudana odpowiedz tez sie placi", () => {
    const error = new InvalidOutputError(["x"], "raw", "claude-sonnet-5-5", USAGE);
    expect(error).toBeInstanceOf(LlmError);
    expect(error.costNanoUsd).toBe(costNanoUsd("claude-sonnet-5-5", USAGE));
  });

  it("maja wlasne nazwy w logach", () => {
    expect(new LlmError("x", "claude-haiku-5-5", USAGE).name).toBe("LlmError");
    expect(new InvalidOutputError([], "", "claude-haiku-5-5", USAGE).name).toBe("InvalidOutputError");
    const incomplete = new IncompleteOutputError("max_tokens", "claude-haiku-5-5", USAGE);
    expect(incomplete).toMatchObject({ name: "IncompleteOutputError", stopReason: "max_tokens" });
    expect(incomplete.message).toBe("Odpowiedz modelu przerwana: max_tokens");
  });
});

function catchError(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error("Oczekiwano bledu");
}
