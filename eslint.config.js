import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/dist/**", "**/coverage/**", "**/reports/**", "**/.stryker-tmp/**"] },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          // Pliki konfiguracyjne nie naleza do zadnego tsconfig — sprawdzamy je domyslnym.
          allowDefaultProject: ["*.js", "packages/*/*.config.ts", "apps/*/*.config.ts"],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ["**/*.js", "**/*.cjs"],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    files: ["**/*.cjs"],
    languageOptions: { sourceType: "commonjs", globals: { module: "writable" } },
  },
);
