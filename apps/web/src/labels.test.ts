import { CRITIC_IDS } from "@trybunal/domain";
import { describe, expect, it } from "vitest";
import { ACTIVITY_LABELS, CRITIC_LABELS, describeAnonymized, formatScore, formatUsd, PHASES, PII_LABELS, SEVERITY_LABELS } from "./labels.js";

describe("etykiety", () => {
  it("kazdy krytyk z domeny ma opis na ekranie", () => {
    expect(Object.keys(CRITIC_LABELS)).toEqual([...CRITIC_IDS]);
  });

  it("teksty interfejsu (zmiana tekstu widoczna w review jak zmiana kodu)", () => {
    expect({ CRITIC_LABELS, PHASES, ACTIVITY_LABELS, SEVERITY_LABELS, PII_LABELS }).toMatchSnapshot();
  });

  it("fazy w kolejnosci rozprawy", () => {
    expect(PHASES.map((p) => p.phase)).toEqual(["assessing", "prosecution", "debate", "deliberation", "closed"]);
  });
});

describe("formatUsd", () => {
  // Jak formatUsd w packages/llm: cztery miejsca, zaokraglenie w gore.
  it.each<[number, string]>([
    [0, "$0.0000"],
    [1, "$0.0001"],
    [100_000, "$0.0001"],
    [100_001, "$0.0002"],
    [1_234_567, "$0.0013"],
    [2_500_000_000, "$2.5000"],
    [12_345_600_000, "$12.3456"],
  ])("%d nano-USD -> %s", (nano, text) => {
    expect(formatUsd(nano)).toBe(text);
  });
});

describe("formatScore i describeAnonymized", () => {
  it("srednia po polsku, najwyzej jedno miejsce po przecinku", () => {
    expect(formatScore(6.5)).toBe("6,5");
    expect(formatScore(6.25)).toBe("6,3");
    expect(formatScore(7)).toBe("7");
  });

  it("ukryte dane: tylko niezerowe; nieznany rodzaj pod swoja nazwa; nic -> null", () => {
    expect(describeAnonymized({ email: 2, phone: 0, name: 1, nowy: 1 })).toBe("e-mail ×2, imię i nazwisko ×1, nowy ×1");
    expect(describeAnonymized({ phone: 0 })).toBeNull();
    expect(describeAnonymized({})).toBeNull();
  });
});
