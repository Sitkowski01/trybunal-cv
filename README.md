# Trybunał CV

CV i ogłoszenie o pracę trafiają przed sąd. Pięciu niezależnych krytyków — Bot ATS,
HR screener, Tech Lead, Hiring Manager i Prokurator — ocenia kandydata, spiera się
w debacie, a sędzia ogłasza werdykt z uzasadnieniem i poprawionymi punktami CV.
Rozprawę widać na żywo jako animowaną scenę 3D.

> Projekt w budowie.

## Struktura

| Pakiet | Rola |
|---|---|
| `packages/domain` | czysta logika rozprawy: skład trybunału, oceny, werdykt — bez IO |

## Uruchomienie

Wymagania: Node 24, pnpm 11.

```bash
pnpm install
pnpm check      # typy, lint, reguły architektury, testy z pokryciem
pnpm mutation   # mutation testing (Stryker)
```

## Jakość

- TypeScript w trybie `strict` z `noUncheckedIndexedAccess` i `exactOptionalPropertyTypes`.
- Testy jednostkowe i property-based (Vitest, fast-check), pokrycie min. 95%.
- Mutation testing (Stryker), próg 90%.
- Reguły architektury (dependency-cruiser): domena nie korzysta z IO ani z innych pakietów,
  frontend nie zna warstwy LLM, brak cykli.
- Każdy commit ma maks. 200 linii zmian (hook `.githooks/pre-commit`).
