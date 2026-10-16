import { DEBATE_ASK, JUDGE_ASK, PROMPTS, PROSECUTION_ASK, PROSECUTOR_STANCE, type PromptSet } from "@trybunal/court";

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

/**
 * v3-scena: ta sama rozprawa, ale wypowiedzi pisane pod sale. Pierwsze nagranie demo bylo
 * merytoryczne, ale jako pokaz nie dzialalo: wypowiedzi po 900–1300 znakow (dymek pokazuje
 * poczatek), kazda zaczynala sie od „Jako X podtrzymuje”, a prokurator konczyl mowe slowami
 * „zapraszam”. Hipoteza: krotkie wypowiedzi skierowane do konkretnego krytyka i konsekwentny
 * prokurator daja czytelny spor — bez utraty trafnosci werdyktu (ten liczy regula z ocen).
 */
export const SCENE_PROSECUTOR_STANCE =
  "Jesteś prokuratorem: szukasz najmocniejszego powodu, żeby kandydata odrzucić. W mowie i w debacie zawsze " +
  "wnosisz o odrzucenie — to twoja rola. Ocenę 1–10 wystawiasz jednak uczciwie, tak jak przysięgli.";
export const SCENE_PROSECUTION_ASK =
  "Wygłoś mowę oskarżenia na sali: 3–5 zdań, najwyżej 600 znaków. Dwa, trzy najmocniejsze argumenty za odrzuceniem, " +
  "każdy oparty na krótkim cytacie z CV. Zakończ wnioskiem o odrzucenie.";
export const SCENE_DEBATE_ASK =
  "Odpowiedz na sali 2–3 zdaniami, najwyżej 350 znaków. Zwróć się do jednego konkretnego krytyka po nazwie i odnieś się " +
  "do jego argumentu. Nie przedstawiaj się i nie zaczynaj od „podtrzymuję”. Jeśli coś cię przekonało, podaj nową ocenę " +
  "w revisedScore; jeśli nie, revisedScore = null.";
export const SCENE_JUDGE_ASK =
  "Zacznij od sentencji: jedno zdanie do 160 znaków, które sędzia ogłasza na sali. Po pustej linii napisz uzasadnienie " +
  "werdyktu dla kandydata.";

/** Podmienia koncowe polecenie zadania; brak go na koncu = zmienil sie prompt w court i wariant jest nieaktualny. */
export function replaceEnding(text: string, ending: string, replacement: string): string {
  if (!text.endsWith(ending)) throw new Error(`Zadanie nie konczy sie poleceniem: ${ending}`);
  return text.slice(0, text.length - ending.length) + replacement;
}

export const PROMPTS_SCENE: PromptSet = {
  ...PROMPTS,
  version: "v3-scena",
  instructionsFor: (critic) => PROMPTS.instructionsFor(critic).replace(PROSECUTOR_STANCE, SCENE_PROSECUTOR_STANCE),
  prosecutionTask: (state) => replaceEnding(PROMPTS.prosecutionTask(state), PROSECUTION_ASK, SCENE_PROSECUTION_ASK),
  debateTask: (state, criticId) => replaceEnding(PROMPTS.debateTask(state, criticId), DEBATE_ASK, SCENE_DEBATE_ASK),
  judgeTask: (state, verdict) => replaceEnding(PROMPTS.judgeTask(state, verdict), JUDGE_ASK, SCENE_JUDGE_ASK),
};

export const VARIANTS: readonly PromptSet[] = [PROMPTS, PROMPTS_V2, PROMPTS_SCENE];

/** Domyslnie: prompty sadu i aktualny kandydat. v2-kotwice przegralo (te same werdykty, drozej), zostaje do odtworzenia wynikow. */
export const DEFAULT_VARIANTS: readonly PromptSet[] = [PROMPTS, PROMPTS_SCENE];

export function variantByVersion(version: string): PromptSet | undefined {
  return VARIANTS.find((v) => v.version === version);
}
