import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Frontend wola API pod /api (bez CORS); proxy obcina prefiks. API_URL zmienia adres serwera (e2e).
const api = process.env.API_URL ?? "http://127.0.0.1:3000";
const proxy = {
  "/api": { target: api, changeOrigin: true, rewrite: (path: string) => path.replace(/^\/api/u, "") },
};

export default defineConfig({
  plugins: [react()],
  server: { proxy },
  preview: { proxy },
});
