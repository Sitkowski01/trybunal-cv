import { DEBATE_ASK, JUDGE_ASK, PROMPTS, PROSECUTION_ASK, PROSECUTOR_STANCE, type PromptSet } from "@trybunal/court";

/**
 * Warianty promptow do porownania. PROMPTS to prompty, ktorych uzywa sad (obecnie v3-scena).
 * Kandydat dostaje wlasna wersje i dopiero po wygranej ewaluacji zastepuje prompty w pakiecie court;
 * poprzednie wersje zostaja tu, zeby dalo sie odtworzyc i powtorzyc stare porownania.
 */

/** Podmienia koncowe polecenie zadania; brak go na koncu = zmienil sie prompt w court i wariant jest nieaktualny. */
export function replaceEnding(text: string, ending: string, replacement: string): string {
  if (!text.endsWith(ending)) throw new Error(`Zadanie nie konczy sie poleceniem: ${ending}`);
  return text.slice(0, text.length - ending.length) + replacement;
}

/**
 * v1: pierwsza wersja sadu. Merytorycznie dobra, ale jako pokaz nie dzialala: wypowiedzi po
 * 900–1300 znakow, kazda od „Jako X podtrzymuje”, a prokurator konczyl mowe slowami „zapraszam”.
 * Zastapiona przez v3-scena (16.10: ta sama trafnosc, rozprawa o 17% tansza).
 */
export const V1_PROSECUTOR_STANCE = "Jesteś prokuratorem: szukasz najmocniejszego powodu, żeby kandydata odrzucić. Bądź surowy, ale uczciwy.";
export const V1_PROSECUTION_ASK = "Wygłoś mowę oskarżenia: najmocniejsze argumenty za odrzuceniem kandydata, oparte na cytatach z CV.";
export const V1_DEBATE_ASK =
  "Odnieś się do argumentów innych. Jeśli coś cię przekonało, podaj nową ocenę w revisedScore; jeśli nie, revisedScore = null.";
export const V1_JUDGE_ASK = "Napisz uzasadnienie werdyktu dla kandydata.";

export const PROMPTS_V1: PromptSet = {
  ...PROMPTS,
  version: "v1",
  instructionsFor: (critic) => PROMPTS.instructionsFor(critic).replace(PROSECUTOR_STANCE, V1_PROSECUTOR_STANCE),
  prosecutionTask: (state) => replaceEnding(PROMPTS.prosecutionTask(state), PROSECUTION_ASK, V1_PROSECUTION_ASK),
  debateTask: (state, criticId) => replaceEnding(PROMPTS.debateTask(state, criticId), DEBATE_ASK, V1_DEBATE_ASK),
  judgeTask: (state, verdict) => replaceEnding(PROMPTS.judgeTask(state, verdict), JUDGE_ASK, V1_JUDGE_ASK),
};

/**
 * v2-kotwice: v1, ale skala ocen z opisem kazdego przedzialu. Hipoteza: krytycy bez kotwic oceniaja
 * "na oko", wiec ta sama CV raz dostaje 5, raz 6 — a prog zaproszenia to 6. Przegrala z v1
 * (16.10: te same werdykty, drozej); zostaje do odtworzenia wynikow.
 */
export const ANCHORS = `- Skala ocen 1–10 — oceniasz według tych opisów, nie „na oko”:
  - 9–10: spełnia wszystkie wymagania z oferty i każde potwierdza konkretnym projektem albo wynikiem.
  - 7–8: spełnia wymagania konieczne z dowodami; braki najwyżej w „mile widziane”. Zaprosić.
  - 6: spełnia wymagania konieczne, ale część tylko deklaruje, bez dowodów w CV. Zaprosić.
  - 4–5: brakuje jednego wymagania koniecznego albo większość to deklaracje bez dowodów.
  - 1–3: brakuje kilku wymagań koniecznych albo CV dotyczy innej roli. Odrzucić.
  Deklaracja bez dowodu (np. „ekspert”, „biegle”) nie podnosi oceny. Wyjątek: Bot ATS ocenia
  tylko słowa kluczowe i format — dla niego wymaganie jest spełnione, gdy pada w CV z nazwy.`;

/** Linia skali w zasadach — v2 ja zastepuje, zeby model nie dostal dwoch roznych skal. */
export const SCALE_LINE = /^- Skala ocen 1–10:.*$/m;

export const PROMPTS_V2: PromptSet = {
  ...PROMPTS_V1,
  version: "v2-kotwice",
  rules: PROMPTS_V1.rules.replace(SCALE_LINE, ANCHORS),
};

export const VARIANTS: readonly PromptSet[] = [PROMPTS_V1, PROMPTS_V2, PROMPTS];

/** Domyslnie: prompty sadu. Nowy kandydat dopisuje sie tu obok nich. */
export const DEFAULT_VARIANTS: readonly PromptSet[] = [PROMPTS];

export function variantByVersion(version: string): PromptSet | undefined {
  return VARIANTS.find((v) => v.version === version);
}
