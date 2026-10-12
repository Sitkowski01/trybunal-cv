import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { main } from "./cli.js";

// Punkt wejscia: prawdziwy dysk, .env, Ctrl+C i kod wyjscia. Cala logika jest w main() i ma testy.
if (existsSync(".env")) {
  process.loadEnvFile(".env");
}
// Pierwsze Ctrl+C przerywa rozprawe tak, zeby zapisala dziennik i nagranie; drugie zabija proces.
const interrupt = new AbortController();
process.once("SIGINT", () => {
  console.log("Przerywam rozprawe — zapisuje to, co juz jest...");
  interrupt.abort();
});

process.exitCode = await main(process.argv.slice(2), {
  readText: (path) => readFile(path, "utf8"),
  writeText: (path, text) => writeFile(path, text, "utf8"),
  makeDir: async (path) => {
    await mkdir(path, { recursive: true });
  },
  log: (line) => {
    console.log(line);
  },
  apiKey: process.env.ANTHROPIC_API_KEY,
  signal: interrupt.signal,
});
