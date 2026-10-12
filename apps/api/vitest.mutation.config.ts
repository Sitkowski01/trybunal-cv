import { defineConfig, mergeConfig } from "vitest/config";
import base from "./vitest.config.js";

// Stryker: bez testow integracyjnych (kontener Postgres na kazdy przebieg). Ich kod (postgres.ts)
// jest wylaczony z mutacji i sprawdzany testami *.int.test.ts w zwyklym `pnpm test`.
export default mergeConfig(base, defineConfig({ test: { exclude: ["src/**/*.int.test.ts"] } }));
