import { existsSync } from "node:fs";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { AnthropicLlmClient } from "@trybunal/llm";
import { main } from "./cli.js";

// Punkt wejscia: prawdziwy dysk, .env, Ctrl+C i kod wyjscia. Cala logika jest w main() i ma testy.
if (existsSync(".env")) {
  process.loadEnvFile(".env");
}
// Pierwsze Ctrl+C konczy biezace rozprawy bez zapisu i pisze raport z gotowych; drugie zabija proces.
const interrupt = new AbortController();
process.once("SIGINT", () => {
  console.log("Przerywam ewaluacje — raport z gotowych rozpraw...");
  interrupt.abort();
});

process.exitCode = await main(process.argv.slice(2), {
  readText: (path) => readFile(path, "utf8"),
  writeText: (path, text) => writeFile(path, text, "utf8"),
  appendText: (path, text) => appendFile(path, text, "utf8"),
  makeDir: async (path) => {
    await mkdir(path, { recursive: true });
  },
  log: (line) => {
    console.log(line);
  },
  apiKey: process.env.ANTHROPIC_API_KEY,
  createLlm: (apiKey) => AnthropicLlmClient.fromApiKey(apiKey),
  signal: interrupt.signal,
  now: () => new Date(),
});
