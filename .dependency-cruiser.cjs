// Reguly architektury. Domena jest czysta: zero IO i zero zaleznosci od innych pakietow,
// wiec da sie ja testowac bez sieci i bazy. Scena w przegladarce zna tylko zdarzenia
// rozprawy, a nie warstwe LLM — dzieki temu mozna ja wylaczyc albo podmienic.
/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "domena-bez-io",
      comment: "packages/domain nie moze uzywac modulow Node ani pakietow z IO",
      severity: "error",
      from: { path: "^packages/domain/src" },
      to: {
        dependencyTypes: ["core"],
      },
    },
    {
      name: "domena-niezalezna",
      comment: "packages/domain nie zalezy od innych pakietow monorepo",
      severity: "error",
      from: { path: "^packages/domain/src" },
      to: { path: "^(packages/(?!domain)|apps/)" },
    },
    {
      name: "llm-bez-domeny",
      comment: "packages/llm to ogolny klient modelu (koszty, budzet, nagrania) — nie zna rozprawy",
      severity: "error",
      from: { path: "^packages/llm/src" },
      to: { path: "^(packages/(?!llm)|apps/)" },
    },
    {
      name: "web-bez-llm",
      comment: "frontend zna tylko domene (typy zdarzen), nigdy warstwy LLM ani API",
      severity: "error",
      from: { path: "^apps/web" },
      to: { path: "^(packages/llm|apps/api)" },
    },
    {
      name: "web-model-bez-widoku",
      comment: "stan sali, klient API i kontrakt postaci to czysty TS: bez Reacta i komponentow — uzyje ich tez scena 3D",
      severity: "error",
      from: { path: "^apps/web/src/(api/|scene/characters\\.ts$|trial/(court|seats|activity|envelope)\\.ts$)", pathNot: "\\.test\\.ts$" },
      to: { path: "(node_modules/react/|\\.tsx$|useCourt)" },
    },
    {
      name: "pakiety-nie-znaja-aplikacji",
      comment: "biblioteki w packages/ nie importuja z apps/",
      severity: "error",
      from: { path: "^packages/" },
      to: { path: "^apps/" },
    },
    {
      name: "bez-cykli",
      severity: "error",
      from: {},
      to: { circular: true },
    },
    {
      name: "produkcja-bez-testow",
      comment: "kod produkcyjny nie importuje plikow testowych ani pomocnikow testow (src/test/)",
      severity: "error",
      from: { pathNot: "(\\.test\\.tsx?$|/src/test/)" },
      to: { path: "(\\.test\\.tsx?$|/src/test/)" },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    exclude: { path: "(dist|coverage|reports|\\.stryker-tmp)/" },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.base.json" },
  },
};
