import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config.js";

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: "jsdom",
      // jsdom i klikanie przez user-event sa wolne na obciazonej maszynie (CI, rownolegle pliki).
      testTimeout: 15_000,
      include: ["src/**/*.test.{ts,tsx}"],
      setupFiles: ["src/test/setup.ts"],
      coverage: {
        provider: "v8",
        include: ["src/**/*.{ts,tsx}"],
        // CourtScene.tsx rysuje WebGL, ktorego jsdom nie ma: logika sceny jest w czystych modulach z testami,
        // a sam komponent sprawdza e2e w przegladarce (e2e/scene.spec.ts).
        exclude: ["src/**/*.test.{ts,tsx}", "src/test/**", "src/main.tsx", "src/scene/CourtScene.tsx"],
        thresholds: { lines: 95, branches: 95, functions: 95, statements: 95 },
      },
    },
  }),
);
