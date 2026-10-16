import { existsSync, readFileSync } from "node:fs";
import { AnthropicLlmClient } from "@trybunal/llm";
import pg from "pg";
import { buildApp } from "./app.js";
import { masterKeyText, readConfig, toNanoUsd } from "./config.js";
import { newKey, parseMasterKey } from "./crypto.js";
import { TrialHub } from "./hub.js";
import { Journal } from "./journal.js";
import { migrate, PostgresEventStore } from "./postgres.js";
import { rehearsalLlm, slowRehearsalLlm } from "./rehearsal.js";
import { TrialService } from "./service.js";
import { InMemoryEventStore } from "./store.js";

// Punkt wejscia serwera: konfiguracja, baza, model i zamykanie. Logika jest w modulach z testami.
if (existsSync(".env")) {
  process.loadEnvFile(".env");
}
const config = readConfig(process.env);

let pool: pg.Pool | undefined;
let journal: Journal;
if (config.DATABASE_URL === undefined) {
  console.warn("Brak DATABASE_URL — dziennik w pamieci, rozprawy znikna po restarcie.");
  journal = new Journal(new InMemoryEventStore(), newKey());
} else {
  pool = new pg.Pool({ connectionString: config.DATABASE_URL });
  // Bez sluchacza blad bezczynnego polaczenia (restart bazy) zabilby proces jako nieobsluzony.
  pool.on("error", (error) => {
    console.error("Blad polaczenia z baza:", error.message);
  });
  await migrate(pool);
  journal = new Journal(new PostgresEventStore(pool), parseMasterKey(masterKeyText(config, (path) => readFileSync(path, "utf8")) ?? ""));
}

const apiKey = config.ANTHROPIC_API_KEY;
const rehearsal = config.TRYBUNAL_REHEARSAL_DELAY_MS > 0 ? slowRehearsalLlm(config.TRYBUNAL_REHEARSAL_DELAY_MS) : rehearsalLlm;
const llm = config.TRYBUNAL_REHEARSAL || apiKey === undefined ? rehearsal : () => AnthropicLlmClient.fromApiKey(apiKey);
const hub = new TrialHub((error) => {
  console.error("Blad sluchacza strumienia:", error);
});
const service = new TrialService({
  journal,
  hub,
  llm,
  trialBudgetNanoUsd: toNanoUsd(config.TRIAL_BUDGET_USD),
  dailyBudgetNanoUsd: toNanoUsd(config.DAILY_BUDGET_USD),
  maxRunning: config.MAX_RUNNING_TRIALS,
  onError: (error, trialId) => {
    app.log.error({ err: error, trialId }, "Blad w tle rozprawy");
  },
});
const app = await buildApp({
  service,
  journal,
  hub,
  rateLimit: { max: config.RATE_LIMIT_PER_HOUR, timeWindowMs: 3_600_000 },
  logStream: process.stdout,
  trustProxy: config.TRUST_PROXY,
});

// Zamkniecie: najpierw rozprawy zapisuja przerwanie, potem serwer i baza.
// Nowe wniesienia dostaja 503 od pierwszej chwili zamykania; po 10 s konczymy mimo wszystko.
const shutdown = async () => {
  setTimeout(() => process.exit(1), 10_000).unref();
  try {
    await service.close();
    await app.close();
    await pool?.end();
  } catch (error) {
    console.error("Blad przy zamykaniu:", error);
    process.exitCode = 1;
  }
};
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void shutdown();
  });
}

await app.listen({ port: config.PORT, host: config.HOST });
