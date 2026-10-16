import { z } from "zod";
import { describeIssues } from "./issues.js";

/**
 * Konfiguracja serwera ze zmiennych srodowiska, sprawdzona przy starcie — zla wartosc zatrzymuje
 * serwer z czytelnym komunikatem, zamiast wyjsc w polowie pierwszej rozprawy.
 * Bez DATABASE_URL dziennik jest w pamieci (demo), bez klucza API dziala tylko proba generalna.
 */
const usd = z.coerce.number().positive();
const flag = z.enum(["0", "1"]).transform((v) => v === "1");

const EnvSchema = z
  .object({
    PORT: z.coerce.number().int().min(0).max(65_535).default(3000),
    HOST: z.string().default("127.0.0.1"),
    DATABASE_URL: z.url().optional(),
    /** 32 bajty base64; wymagany z baza — inaczej po restarcie zadnej rozprawy nie da sie odczytac. */
    TRYBUNAL_MASTER_KEY: z.string().optional(),
    ANTHROPIC_API_KEY: z.string().min(1).optional(),
    /** 1: rozprawy bez modelu (proba generalna) — demo, frontend, e2e. */
    TRYBUNAL_REHEARSAL: flag.default(false),
    /** Przerwa przed kazda odpowiedzia proby generalnej — zeby w demo bylo widac kolejne fazy. */
    TRYBUNAL_REHEARSAL_DELAY_MS: z.coerce.number().int().min(0).max(10_000).default(0),
    TRIAL_BUDGET_USD: usd.default(0.5),
    DAILY_BUDGET_USD: usd.default(5),
    MAX_RUNNING_TRIALS: z.coerce.number().int().positive().default(3),
    RATE_LIMIT_PER_HOUR: z.coerce.number().int().positive().default(5),
    /** 1 za proxy (Docker, nginx): limit liczony per X-Forwarded-For, a nie per adres proxy. */
    TRUST_PROXY: flag.default(false),
  })
  .superRefine((env, ctx) => {
    if (env.DATABASE_URL !== undefined && env.TRYBUNAL_MASTER_KEY === undefined) {
      ctx.addIssue({ code: "custom", path: ["TRYBUNAL_MASTER_KEY"], message: "wymagany razem z DATABASE_URL (openssl rand -base64 32)" });
    }
    if (env.ANTHROPIC_API_KEY === undefined && !env.TRYBUNAL_REHEARSAL) {
      ctx.addIssue({ code: "custom", path: ["ANTHROPIC_API_KEY"], message: "brak klucza — ustaw go albo TRYBUNAL_REHEARSAL=1" });
    }
    if (env.TRIAL_BUDGET_USD > env.DAILY_BUDGET_USD) {
      ctx.addIssue({ code: "custom", path: ["TRIAL_BUDGET_USD"], message: "budzet rozprawy wiekszy niz budzet dnia" });
    }
  });

export type ServerConfig = z.infer<typeof EnvSchema>;

/** Sekrety, ktore mozna podac jako plik: NAZWA_FILE=sciezka (konwencja obrazow Dockera). */
export const FILE_SECRETS = ["DATABASE_URL", "TRYBUNAL_MASTER_KEY", "ANTHROPIC_API_KEY"] as const;

/**
 * Podstawia sekrety z plikow (sekret Dockera, wolumen) — nie trafiaja wtedy do zmiennych
 * srodowiska, ktore widac w docker inspect i logach. Wartosc i plik naraz to blad: nie wiadomo,
 * ktora obowiazuje. Koncowa nowa linia (echo, base64) odpada.
 */
export function withFileSecrets(env: Readonly<Record<string, string | undefined>>, readFile: (path: string) => string): Record<string, string | undefined> {
  const resolved: Record<string, string | undefined> = { ...env };
  const problems: string[] = [];
  for (const name of FILE_SECRETS) {
    const path = env[`${name}_FILE`];
    if (path === undefined || path === "") continue;
    const value = env[name];
    if (value !== undefined && value !== "") {
      problems.push(`${name}_FILE: podaj ${name} albo ${name}_FILE, nie oba`);
      continue;
    }
    try {
      resolved[name] = readFile(path).trim();
    } catch {
      problems.push(`${name}_FILE: nie mozna odczytac pliku ${path}`);
    }
  }
  if (problems.length > 0) throw new Error(`Bledna konfiguracja serwera:\n  ${problems.join("\n  ")}`);
  return resolved;
}

export function readConfig(env: Readonly<Record<string, string | undefined>>): ServerConfig {
  // Pusta zmienna (np. "DATABASE_URL=" w .env) traktowana jak brak.
  const present = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== ""));
  const result = EnvSchema.safeParse(present);
  if (!result.success) {
    const problems = describeIssues(result.error.issues);
    throw new Error(`Bledna konfiguracja serwera:\n  ${problems.join("\n  ")}`);
  }
  return result.data;
}

export const toNanoUsd = (usdAmount: number) => Math.round(usdAmount * 1e9);
