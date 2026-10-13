import { defineConfig, devices } from "@playwright/test";

// E2E na prawdziwym API w trybie proby generalnej (bez modelu i klucza) i na zbudowanym frontendzie.
// Przerwa 300 ms przed kazda odpowiedzia: widac fazy na zywo i jest czas na anulowanie.
const API_PORT = 3199;
const WEB_PORT = 4199;

export default defineConfig({
  testDir: ".",
  fullyParallel: true,
  forbidOnly: process.env.CI !== undefined,
  retries: process.env.CI === undefined ? 0 : 1,
  reporter: process.env.CI === undefined ? "list" : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: `http://127.0.0.1:${String(WEB_PORT)}`,
    trace: "retain-on-failure",
  },
  // PW_CHANNEL=msedge: przegladarka z systemu, gdy nie da sie pobrac Chromium Playwrighta.
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], ...(process.env.PW_CHANNEL === undefined ? {} : { channel: process.env.PW_CHANNEL }) } }],
  webServer: [
    {
      command: "node ../../api/dist/main.js",
      url: `http://127.0.0.1:${String(API_PORT)}/health`,
      // Pusta DATABASE_URL = dziennik w pamieci, nawet gdy w powloce jest adres prawdziwej bazy.
      env: { DATABASE_URL: "", TRYBUNAL_REHEARSAL: "1", TRYBUNAL_REHEARSAL_DELAY_MS: "300", PORT: String(API_PORT), RATE_LIMIT_PER_HOUR: "1000", MAX_RUNNING_TRIALS: "20", DAILY_BUDGET_USD: "1000" },
      reuseExistingServer: false,
    },
    {
      // Frontend i API buduje wczesniej pnpm e2e (pnpm build) — tu tylko serwowanie.
      cwd: "..",
      command: `vite preview --host 127.0.0.1 --port ${String(WEB_PORT)} --strictPort`,
      url: `http://127.0.0.1:${String(WEB_PORT)}`,
      env: { API_URL: `http://127.0.0.1:${String(API_PORT)}` },
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
