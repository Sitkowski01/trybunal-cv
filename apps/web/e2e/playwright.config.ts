import { defineConfig, devices } from "@playwright/test";
import { DEMO, SCENE, WEB } from "./servers.js";

// E2E na prawdziwym API w trybie proby generalnej (bez modelu i klucza) i na zbudowanym frontendzie.
// Dwie pary serwerow: szybka (300 ms przed kazda odpowiedzia — widac fazy i jest czas na anulowanie)
// i wolna dla sali 3D (3 s — jak prawdziwy model; kamera zdazy dojechac do mowcy, a klatka liczona przez procesor
// skonczy sie przed nastepna wypowiedzia).
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

// PW_CHANNEL=msedge: przegladarka z systemu, gdy nie da sie pobrac Chromium Playwrighta.
// PW_SOFTWARE_GL=1: WebGL liczony przez procesor, jak w CI (sprawdzenie lokalne trybu oszczednego).
const browser = {
  ...devices["Desktop Chrome"],
  ...(process.env.PW_CHANNEL === undefined ? {} : { channel: process.env.PW_CHANNEL }),
};
const softwareGl = process.env.PW_SOFTWARE_GL === undefined ? [] : ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--disable-gpu"];

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
  // Aplikacja bez WebGL: sprawdza widok 2D (tak samo dziala przegladarka bez WebGL 2), a w CI bez karty
  // graficznej scena liczona przez procesor nie zabiera czasu testom rozprawy. Sala 3D rusza osobno, po nich.
  projects: [
    { name: "app", testIgnore: ["scene.spec.ts", "demo.spec.ts"], use: { ...browser, launchOptions: { args: ["--disable-webgl"] } } },
    { name: "scene", testMatch: "scene.spec.ts", dependencies: ["app"], use: { ...browser, launchOptions: { args: softwareGl } } },
    // Demo: bez API, tylko pliki z dist-demo (build --mode demo) pod /trybunal/ — sprawdza tez wzgledne sciezki.
    {
      name: "demo",
      testMatch: "demo.spec.ts",
      use: { ...browser, baseURL: `http://127.0.0.1:${String(DEMO.web)}${DEMO.path}`, launchOptions: { args: ["--disable-webgl"] } },
    },
  ],
  webServer: [
    ...servers(WEB),
    ...servers(SCENE),
    {
      cwd: "..",
      command: `vite preview --outDir dist-demo --base ${DEMO.path} --host 127.0.0.1 --port ${String(DEMO.web)} --strictPort`,
      url: `http://127.0.0.1:${String(DEMO.web)}${DEMO.path}`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
