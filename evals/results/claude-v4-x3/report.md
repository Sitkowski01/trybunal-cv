# Ewaluacja Trybunału CV — claude-v4-x3

2026-10-17 · Claude (modele z konfiguracji sądu) · przypadki: 20 · powtórzenia: 3 · rundy debaty: 1

Wydano łącznie: $14.4541 (z rozprawami przerwanymi przez budżet przebiegu albo Ctrl+C, których wyników nie zapisano).

## Metryki

| Metryka | v4 |
| --- | --- |
| Rozprawy (zakończone / wszystkie) | 57 / 60 |
| Trafność werdyktu | 91% |
| Trafność bez przypadków granicznych | 94% |
| Fałszywe zaproszenia (oczekiwano odrzucenia) | 5 |
| Fałszywe odrzucenia (oczekiwano zaproszenia) | 0 |
| Zgodność powtórzeń | 98% |
| Odchylenie średniej przysięgłych | 0.10 |
| Koszt łącznie | $14.2985 |
| Koszt rozprawy (średni / maks.) | $0.2384 / $0.3286 |
| Wejście z cache | 28% |
| Ponowione zapytania | 8% |

## Trafność według tagów (trafione / zakończone)

| Tag | v4 |
| --- | --- |
| mocne | 22/22 |
| slabe | 12/12 |
| ats | 5/8 |
| injection | 6/6 |
| luka | 2/2 |
| przebranzowienie | 7/9 |
| zawyzone | 6/6 |
| nadkwalifikacje | 6/6 |
| liczby | 14/14 |
| graniczny | 7/9 |

## Nieudane próby według kroku i powodu

| Krok — powód | v4 |
| --- | --- |
| assessment:ats — cytat spoza CV | 32 |
| assessment:ats — zły schemat odpowiedzi | 5 |
| assessment:hiringManager — cytat spoza CV | 5 |
| assessment:prosecutor — limit tokenów | 4 |
| assessment:techLead — cytat spoza CV | 4 |
| assessment:hr — limit tokenów | 2 |
| assessment:prosecutor — cytat spoza CV | 2 |
| assessment:hiringManager — błąd API | 1 |
| assessment:hr — zły schemat odpowiedzi | 1 |
| assessment:hr — cytat spoza CV | 1 |
| assessment:prosecutor — błąd API | 1 |
| assessment:techLead — limit tokenów | 1 |
| assessment:techLead — błąd API | 1 |

## Przypadki do obejrzenia

- **v4** — chybione (werdykt większości ≠ oczekiwany): java-ksiegowa-bootcamp, react-ats-akapity; niestabilne: java-ksiegowa-bootcamp
