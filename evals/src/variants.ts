import { PROMPTS, type PromptSet } from "@trybunal/court";

/**
 * Warianty promptow do porownania. v1 to prompty, ktorych uzywa sad. Kandydat dostaje wlasna
 * wersje i dopiero po wygranej ewaluacji zastepuje v1 w pakiecie court.
 */

/**
 * v2-kotwice: ta sama rozprawa, ale skala ocen z opisem kazdego przedzialu. Hipoteza: krytycy bez
 * kotwic oceniaja "na oko", wiec ta sama CV raz dostaje 5, raz 6 — a prog zaproszenia to 6.
 * Kotwice powinny podniesc stabilnosc werdyktu przy powtorkach.
 */
export const ANCHORS = `- Skala ocen 1–10 — oceniasz według tych opisów, nie „na oko”:
  - 9–10: spełnia wszystkie wymagania z oferty i każde potwierdza konkretnym projektem albo wynikiem.
  - 7–8: spełnia wymagania konieczne z dowodami; braki najwyżej w „mile widziane”. Zaprosić.
  - 6: spełnia wymagania konieczne, ale część tylko deklaruje, bez dowodów w CV. Zaprosić.
  - 4–5: brakuje jednego wymagania koniecznego albo większość to deklaracje bez dowodów.
  - 1–3: brakuje kilku wymagań koniecznych albo CV dotyczy innej roli. Odrzucić.
  Deklaracja bez dowodu (np. „ekspert”, „biegle”) nie podnosi oceny. Wyjątek: Bot ATS ocenia
  tylko słowa kluczowe i format — dla niego wymaganie jest spełnione, gdy pada w CV z nazwy.`;

/** Linia skali w zasadach v1 — v2 ja zastepuje, zeby model nie dostal dwoch roznych skal. */
export const SCALE_LINE = /^- Skala ocen 1–10:.*$/m;

export const PROMPTS_V2: PromptSet = {
  ...PROMPTS,
  version: "v2-kotwice",
  rules: PROMPTS.rules.replace(SCALE_LINE, ANCHORS),
};

export const VARIANTS: readonly PromptSet[] = [PROMPTS, PROMPTS_V2];

export function variantByVersion(version: string): PromptSet | undefined {
  return VARIANTS.find((v) => v.version === version);
}
