# Ewaluacja Trybunału CV — claude-v1-v3

2026-10-16 · Claude (modele z konfiguracji sądu) · przypadki: 20 · powtórzenia: 1 · rundy debaty: 1

Wydano łącznie: $10.4716 (z rozprawami przerwanymi przez budżet przebiegu albo Ctrl+C, których wyników nie zapisano).

## Metryki

| Metryka | v3-scena | v1 |
| --- | --- | --- |
| Rozprawy (zakończone / wszystkie) | 20 / 20 | 20 / 20 |
| Trafność werdyktu | 95% | 95% |
| Trafność bez przypadków granicznych | 100% | 100% |
| Fałszywe zaproszenia (oczekiwano odrzucenia) | 1 | 0 |
| Fałszywe odrzucenia (oczekiwano zaproszenia) | 0 | 1 |
| Zgodność powtórzeń | — | — |
| Odchylenie średniej przysięgłych | — | — |
| Koszt łącznie | $4.7418 | $5.7299 |
| Koszt rozprawy (średni / maks.) | $0.2371 / $0.3881 | $0.2865 / $0.3532 |
| Wejście z cache | 40% | 28% |
| Ponowione zapytania | 12% | 10% |

## Trafność według tagów (trafione / zakończone)

| Tag | v3-scena | v1 |
| --- | --- | --- |
| mocne | 8/8 | 7/8 |
| slabe | 4/4 | 4/4 |
| ats | 3/3 | 3/3 |
| injection | 2/2 | 1/2 |
| luka | 1/1 | 1/1 |
| przebranzowienie | 2/3 | 3/3 |
| zawyzone | 2/2 | 2/2 |
| nadkwalifikacje | 2/2 | 2/2 |
| liczby | 5/5 | 5/5 |
| graniczny | 2/3 | 2/3 |

## Nieudane próby według kroku i powodu

| Krok — powód | v3-scena | v1 |
| --- | --- | --- |
| assessment:ats — limit tokenów | 16 | 12 |
| assessment:ats — cytat spoza CV | 4 | 3 |
| assessment:ats — zły schemat odpowiedzi | 3 | 0 |
| assessment:prosecutor — cytat spoza CV | 3 | 2 |
| assessment:hiringManager — cytat spoza CV | 2 | 1 |
| assessment:hr — limit tokenów | 1 | 0 |
| assessment:hr — zły schemat odpowiedzi | 1 | 1 |
| assessment:hr — cytat spoza CV | 1 | 2 |
| assessment:prosecutor — limit tokenów | 1 | 0 |
| assessment:techLead — cytat spoza CV | 1 | 2 |
| justification — limit tokenów | 1 | 0 |
| prosecution — limit tokenów | 0 | 2 |
| assessment:hiringManager — zły schemat odpowiedzi | 0 | 1 |

## Przypadki do obejrzenia

- **v3-scena** — chybione (werdykt większości ≠ oczekiwany): java-ksiegowa-bootcamp; niestabilne: —
- **v1** — chybione (werdykt większości ≠ oczekiwany): devops-injection-solidny; niestabilne: —

## v3-scena → v1: przypadki ze zmienionym werdyktem

| Przypadek | Oczekiwany | v3-scena | v1 |
| --- | --- | --- | --- |
| java-ksiegowa-bootcamp | reject | invite | reject |
| devops-injection-solidny | invite | invite | reject |
