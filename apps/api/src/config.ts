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
