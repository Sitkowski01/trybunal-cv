import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { costNanoUsd, formatUsd, isModelId, MODELS, type TokenUsage } from "./pricing.js";

const usage = (input: number, output: number, cacheWrite = 0, cacheRead = 0): TokenUsage => ({
  inputTokens: input,
  outputTokens: output,
  cacheWriteTokens: cacheWrite,
  cacheReadTokens: cacheRead,
});

describe("costNanoUsd", () => {
  it("Sonnet: milion tokenow wejscia to $2, milion wyjscia to $10", () => {
    expect(costNanoUsd("claude-sonnet-5-5", usage(1_000_000, 0))).toBe(2_000_000_000);
    expect(costNanoUsd("claude-sonnet-5-5", usage(0, 1_000_000))).toBe(10_000_000_000);
  });

  it("liczy kazdy rodzaj tokenow osobna stawka", () => {
    // Opus: po 1000 tokenow kazdego rodzaju, kazdy po swojej stawce.
    expect(costNanoUsd("claude-opus-5-5", usage(1000, 1000, 1000, 1000))).toBe(1000 * (4000 + 20_000 + 5000 + 200));
  });

  it("odczyt z cache: Sonnet i Haiku 10 razy taniej od zwyklego wejscia, Opus 20 razy", () => {
    const ratio = (model: keyof typeof MODELS) => costNanoUsd(model, usage(10_000, 0)) / costNanoUsd(model, usage(0, 0, 0, 10_000));
    expect(ratio("claude-sonnet-5-5")).toBe(10);
    expect(ratio("claude-haiku-5-5")).toBe(10);
    expect(ratio("claude-opus-5-5")).toBe(20);
  });

  it("Haiku do 100 tys. tokenow wejscia liczy stawke podstawowa", () => {
    expect(costNanoUsd("claude-haiku-5-5", usage(60_000, 100, 20_000, 20_000))).toBe(
      60_000 * 100 + 100 * 500 + 20_000 * 125 + 20_000 * 10,
    );
  });

  it("Haiku powyzej 100 tys. tokenow wejscia (lacznie z cache) liczy stawke dlugiego kontekstu", () => {
    expect(costNanoUsd("claude-haiku-5-5", usage(60_000, 100, 20_000, 20_001))).toBe(
      60_000 * 500 + 100 * 2500 + 20_000 * 625 + 20_001 * 50,
    );
  });

  it("Sonnet nie ma doplaty za dlugi kontekst", () => {
    expect(costNanoUsd("claude-sonnet-5-5", usage(500_000, 0))).toBe(500_000 * 2000);
  });

  it("koszt jest liczba calkowita i rosnie z kazdym tokenem", () => {
    const n = fc.integer({ min: 0, max: 200_000 });
    fc.assert(
      fc.property(fc.constantFrom(...(Object.keys(MODELS) as (keyof typeof MODELS)[])), n, n, n, n, (model, a, b, c, d) => {
        const base = costNanoUsd(model, usage(a, b, c, d));
        return Number.isSafeInteger(base) && costNanoUsd(model, usage(a, b + 1, c, d)) > base;
      }),
    );
  });
});

describe("isModelId", () => {
  it("rozpoznaje modele z cennika i nic poza nimi", () => {
    expect(isModelId("claude-haiku-5-5")).toBe(true);
    expect(isModelId("claude-sonnet-4")).toBe(false);
    expect(isModelId("toString")).toBe(false);
  });
});

describe("formatUsd", () => {
  it.each([
    [0, "$0.0000"],
    [100_000, "$0.0001"],
    [1, "$0.0001"],
    [123_456_789, "$0.1235"],
    [2_000_000_000, "$2.0000"],
    [12_345_000_000, "$12.3450"],
  ])("%d n$ -> %s", (nano, text) => {
    expect(formatUsd(nano)).toBe(text);
  });
});
