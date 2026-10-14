import { defineConfig, devices } from "@playwright/test";
import { SCENE, WEB } from "./servers.js";

// E2E na prawdziwym API w trybie proby generalnej (bez modelu i klucza) i na zbudowanym frontendzie.
// Dwie pary serwerow: szybka (300 ms przed kazda odpowiedzia — widac fazy i jest czas na anulowanie)
// i wolna dla sali 3D (1,5 s — jak prawdziwy model, kamera zdazy dojechac do kazdego mowcy).
const servers = ({ api, web, delayMs }: { api: number; web: number; delayMs: number }) => [
  {
    command: "node ../../api/dist/main.js",
    url: `http://127.0.0.1:${String(api)}/health`,
    // Pusta DATABASE_URL = dziennik w pamieci, nawet gdy w powloce jest adres prawdziwej bazy.
    env: { DATABASE_URL: "", TRYBUNAL_REHEARSAL: "1", TRYBUNAL_REHEARSAL_DELAY_MS: String(delayMs), PORT: String(api), RATE_LIMIT_PER_HOUR: "1000", MAX_RUNNING_TRIALS: "20", DAILY_BUDGET_USD: "1000" },
    reuseExistingServer: false,
  },
  {
    // Frontend i API buduje wczesniej pnpm e2e (pnpm build) — tu tylko serwowanie.
    cwd: "..",
    command: `vite preview --host 127.0.0.1 --port ${String(web)} --strictPort`,
    url: `http://127.0.0.1:${String(web)}`,
    env: { API_URL: `http://127.0.0.1:${String(api)}` },
    reuseExistingServer: false,
    timeout: 120_000,
  },
];

export default defineConfig({
  testDir: ".",
  fullyParallel: true,
  forbidOnly: process.env.CI !== undefined,
  retries: process.env.CI === undefined ? 0 : 1,
  reporter: process.env.CI === undefined ? "list" : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: `http://127.0.0.1:${String(WEB.web)}`,
    trace: "retain-on-failure",
  },
  // PW_CHANNEL=msedge: przegladarka z systemu, gdy nie da sie pobrac Chromium Playwrighta.
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], ...(process.env.PW_CHANNEL === undefined ? {} : { channel: process.env.PW_CHANNEL }) } }],
  webServer: [...servers(WEB), ...servers(SCENE)],
});
