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
| `packages/llm` | klient modelu: adapter Claude, koszt i budżet, atrapa do testów, nagrania rozmów |

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

## Rozmowa z modelem

- **Port `LlmClient`.** Logika rozprawy nie wie, czy rozmawia z Claude'em, atrapą w testach,
  czy nagraniem w demo.
- **Ustrukturyzowane odpowiedzi + pełna walidacja.** Odpowiedź ma format JSON Schema z zod,
  ale API gwarantuje tylko kształt JSON-a — zakresy, długości i `enum` trafiają do modelu jako
  opis. Dlatego każda odpowiedź przechodzi przez pełny schemat; błąd niesie koszt zużytych tokenów.
- **Cache wspólnego kontekstu.** Zasady, CV i oferta idą na początku promptu z punktem cache;
  rola krytyka dopiero za nim. Pięciu krytyków ma ten sam początek, więc od drugiego płaci się
  za niego 5% ceny (Sonnet 5.5).
- **Koszt w nanodolarach** (liczby całkowite, bez floatów w pieniądzach) i **twardy budżet**:
  przed zapytaniem rezerwowany jest najgorszy możliwy koszt (tokenów nie więcej niż bajtów
  UTF-8 promptu), więc równoległe zapytania nie przebiją limitu.
- **Nagrania.** Prawdziwa rozprawa nagrana raz służy jako demo bez serwera i test e2e.

Test na prawdziwym API uruchamia się tylko z kluczem:
`ANTHROPIC_API_KEY=... pnpm --filter @trybunal/llm test`.

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
