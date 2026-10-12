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

## Jak działa rozprawa

```
TrialFiled ─► 5 × AssessmentSubmitted ─► ProsecutionDelivered ─► 0–3 rundy StatementMade ─► VerdictAnnounced
 (CV, oferta)   (niezależnie, równolegle)   (prokurator atakuje)    (każdy krytyk, może zmienić ocenę)
```

- **Event sourcing.** Stan rozprawy to złożenie jej zdarzeń (`replay`). Te same zdarzenia
  odtworzą rozprawę w API, w powtórce na scenie i w demo. `evolve` odrzuca zdarzenie nie na
  swoim miejscu (`TrialRuleError`), a `TrialEventSchema` (zod) sprawdza kształt zdarzeń z bazy
  i od modelu.
- **Werdykt liczy reguła, nie model.** Zaproszenie, gdy średnia przysięgłych ≥ 6 i ATS ≥ 4;
  prokurator oskarża, ale nie głosuje. Rozrzut ocen ≥ 4 oznacza CV niejednoznaczne.
  Model sędziego pisze tylko uzasadnienie. Zdarzenie werdyktu zapisuje decyzję i wersję
  reguły, więc zmiana progów nie przepisuje starych rozpraw.
- **Odpowiedzi modelu nie są zaufane.** Ocena przechodzi przez schemat (skala 1–10, limity),
  a cytat, którego nie ma w CV, jest odrzucany. Porównanie znosi różnice zapisu z PDF:
  litery rozłożone na znak i ogonek, miękkie łączniki, typograficzne cudzysłowy.
- **Poprawki jako diff** słowo po słowie (najdłuższy wspólny podciąg).

## Uruchomienie

Wymagania: Node 24, pnpm 11.

```bash
pnpm install
pnpm check      # typy, lint, reguły architektury, testy z pokryciem
pnpm mutation   # mutation testing (Stryker)
```

## Jakość

- TypeScript w trybie `strict` z `noUncheckedIndexedAccess` i `exactOptionalPropertyTypes`.
- Testy jednostkowe i property-based (Vitest, fast-check): losowe rozprawy, pełny Unicode,
  optymalność diffu względem naiwnej rekurencji. Pokrycie min. 95%.
- Mutation testing (Stryker), próg 90%.
- Reguły architektury (dependency-cruiser): domena nie korzysta z IO ani z innych pakietów,
  frontend nie zna warstwy LLM, brak cykli.
- Każdy commit ma maks. 200 linii zmian (hook `.githooks/pre-commit`).
