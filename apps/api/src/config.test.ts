import { describe, expect, it } from "vitest";
import { readConfig, toNanoUsd, withFileSecrets } from "./config.js";

describe("readConfig", () => {
  it("wartosci domyslne: demo w pamieci z proba generalna", () => {
    expect(readConfig({ TRYBUNAL_REHEARSAL: "1" })).toEqual({
      PORT: 3000,
      HOST: "127.0.0.1",
      TRYBUNAL_REHEARSAL: true,
      TRYBUNAL_REHEARSAL_DELAY_MS: 0,
      TRIAL_BUDGET_USD: 0.5,
      DAILY_BUDGET_USD: 5,
      MAX_RUNNING_TRIALS: 3,
      RATE_LIMIT_PER_HOUR: 5,
      TRUST_PROXY: false,
    });
  });

  it("czyta liczby i adresy ze zmiennych tekstowych; puste zmienne jak brak", () => {
    const config = readConfig({
      PORT: "8080", DATABASE_URL: "postgres://u:p@db:5432/trybunal", TRYBUNAL_MASTER_KEY: "k", ANTHROPIC_API_KEY: "sk", TRIAL_BUDGET_USD: "0.25",
      DAILY_BUDGET_USD: "", TRYBUNAL_REHEARSAL: "0",
    });
    expect(config).toMatchObject({ PORT: 8080, DATABASE_URL: "postgres://u:p@db:5432/trybunal", TRIAL_BUDGET_USD: 0.25, DAILY_BUDGET_USD: 5, TRYBUNAL_REHEARSAL: false });
  });

  it.each([
    [{ TRYBUNAL_REHEARSAL: "0" }, "ANTHROPIC_API_KEY: brak klucza"],
    [{ ANTHROPIC_API_KEY: "sk", DATABASE_URL: "postgres://db/x" }, "TRYBUNAL_MASTER_KEY: wymagany razem z DATABASE_URL"],
    [{ ANTHROPIC_API_KEY: "sk", TRIAL_BUDGET_USD: "6" }, "TRIAL_BUDGET_USD: budzet rozprawy wiekszy niz budzet dnia"],
    [{ ANTHROPIC_API_KEY: "sk", PORT: "70000" }, "PORT: "],
    [{ ANTHROPIC_API_KEY: "sk", DAILY_BUDGET_USD: "-1" }, "DAILY_BUDGET_USD: "],
    [{ ANTHROPIC_API_KEY: "sk", TRYBUNAL_REHEARSAL: "tak" }, "TRYBUNAL_REHEARSAL: "],
    [{ TRYBUNAL_REHEARSAL: "1", TRYBUNAL_REHEARSAL_DELAY_MS: "10001" }, "TRYBUNAL_REHEARSAL_DELAY_MS: "],
    [{ TRYBUNAL_REHEARSAL: "1", TRYBUNAL_REHEARSAL_DELAY_MS: "-1" }, "TRYBUNAL_REHEARSAL_DELAY_MS: "],
  ])("bledna konfiguracja zatrzymuje start z nazwa zmiennej (%#)", (env, message) => {
    expect(() => readConfig(env)).toThrow(`Bledna konfiguracja serwera:\n  ${message}`);
  });

  it("przerwa proby generalnej: granica 10 s dopuszczona", () => {
    expect(readConfig({ TRYBUNAL_REHEARSAL: "1", TRYBUNAL_REHEARSAL_DELAY_MS: "10000" }).TRYBUNAL_REHEARSAL_DELAY_MS).toBe(10_000);
  });

  it("budzet w dolarach na nano-dolary jak w warstwie LLM", () => {
    expect(toNanoUsd(0.5)).toBe(500_000_000);
    expect(toNanoUsd(0.1 + 0.2)).toBe(300_000_000);
  });
});

describe("readConfig — granice", () => {
  it("bez wskazania proba generalna jest wylaczona; budzet rozprawy rowny dziennemu jest dozwolony", () => {
    expect(readConfig({ ANTHROPIC_API_KEY: "sk", TRIAL_BUDGET_USD: "5", DAILY_BUDGET_USD: "5" })).toMatchObject({ TRYBUNAL_REHEARSAL: false, TRIAL_BUDGET_USD: 5 });
  });

  it("kazdy problem w osobnej linii", () => {
    expect(() => readConfig({ PORT: "x", DAILY_BUDGET_USD: "-1" })).toThrow(/^Bledna konfiguracja serwera:\n {2}PORT: [^\n]+\n {2}DAILY_BUDGET_USD: [^\n]+$/u);
  });
});

describe("withFileSecrets", () => {
  const files: Record<string, string> = { "/run/db": "postgres://u:tajne@db:5432/t\n", "/run/klucz": "a2V5\n", "/run/api": "sk-1" };
  const read = (path: string) => {
    const text = files[path];
    if (text === undefined) throw new Error("ENOENT");
    return text;
  };

  it("sekrety z plikow, bez konca linii; reszta zmiennych bez zmian", () => {
    const env = { DATABASE_URL_FILE: "/run/db", TRYBUNAL_MASTER_KEY_FILE: "/run/klucz", ANTHROPIC_API_KEY_FILE: "/run/api", PORT: "8080" };
    expect(withFileSecrets(env, read)).toEqual({
      ...env,
      DATABASE_URL: "postgres://u:tajne@db:5432/t",
      TRYBUNAL_MASTER_KEY: "a2V5",
      ANTHROPIC_API_KEY: "sk-1",
    });
  });

  it("bez plikow (albo z pustym _FILE, jak w .env.example) zmienne zostaja; nie dotyka innych _FILE", () => {
    const env = { DATABASE_URL: "postgres://db/x", TRYBUNAL_MASTER_KEY_FILE: "", OTHER_FILE: "/run/klucz" };
    expect(withFileSecrets(env, read)).toEqual(env);
  });

  it("pusta zmienna obok pliku liczy sie jak brak", () => {
    expect(withFileSecrets({ TRYBUNAL_MASTER_KEY: "", TRYBUNAL_MASTER_KEY_FILE: "/run/klucz" }, read).TRYBUNAL_MASTER_KEY).toBe("a2V5");
  });

  it("wartosc i plik naraz albo brak pliku: blad z nazwa zmiennej, wszystkie problemy naraz", () => {
    const env = { ANTHROPIC_API_KEY: "sk", ANTHROPIC_API_KEY_FILE: "/run/api", DATABASE_URL_FILE: "/nie/ma" };
    expect(() => withFileSecrets(env, read)).toThrow(
      "Bledna konfiguracja serwera:\n  DATABASE_URL_FILE: nie mozna odczytac pliku /nie/ma\n  ANTHROPIC_API_KEY_FILE: podaj ANTHROPIC_API_KEY albo ANTHROPIC_API_KEY_FILE, nie oba",
    );
  });

  it("adres bazy z pliku przechodzi zwykla walidacje konfiguracji", () => {
    const config = readConfig(withFileSecrets({ DATABASE_URL_FILE: "/run/db", TRYBUNAL_MASTER_KEY_FILE: "/run/klucz", TRYBUNAL_REHEARSAL: "1" }, read));
    expect(config).toMatchObject({ DATABASE_URL: "postgres://u:tajne@db:5432/t", TRYBUNAL_MASTER_KEY: "a2V5" });
  });
});
