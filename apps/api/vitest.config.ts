import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      // pdf-worker.ts dziala w osobnym watku — pokrycia stamtad v8 nie widzi; sprawdzaja go testy readPdfIsolated.
      exclude: ["src/**/*.test.ts", "src/**/*.contract.ts", "src/index.ts", "src/main.ts", "src/pdf-worker.ts"],
      thresholds: { lines: 95, branches: 95, functions: 95, statements: 95 },
    },
  },
});
