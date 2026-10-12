import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { main } from "./cli.js";

// Punkt wejscia: prawdziwy dysk, .env i kod wyjscia. Cala logika jest w main() i ma testy.
if (existsSync(".env")) {
  process.loadEnvFile(".env");
}
process.exitCode = await main(process.argv.slice(2), {
  readText: (path) => readFile(path, "utf8"),
  writeText: async (path, text) => {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, text, "utf8");
  },
  log: (line) => {
    console.log(line);
  },
  apiKey: process.env.ANTHROPIC_API_KEY,
});
