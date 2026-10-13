import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Frontend wola API pod /api (bez CORS); proxy obcina prefiks. API_URL zmienia adres serwera (e2e).
const api = process.env.API_URL ?? "http://127.0.0.1:3000";
const proxy = {
  "/api": { target: api, changeOrigin: true, rewrite: (path: string) => path.replace(/^\/api/u, "") },
};

/** Korzen monorepo — szukany w gore, bo Stryker uruchamia testy z kopii pakietu w .stryker-tmp. */
function workspaceRoot(from: string): string {
  if (existsSync(join(from, "pnpm-workspace.yaml"))) return from;
  const parent = dirname(from);
  if (parent === from) throw new Error("Nie znaleziono pnpm-workspace.yaml");
  return workspaceRoot(parent);
}

export default defineConfig({
  plugins: [react()],
  // Przykladowe CV i oferta z examples/ — te same co w CLI.
  resolve: { alias: { "@examples": join(workspaceRoot(import.meta.dirname), "examples") } },
  server: { proxy },
  preview: { proxy },
});
