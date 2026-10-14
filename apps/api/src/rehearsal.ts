import { sleep } from "@trybunal/court";
import { CRITIC_IDS, type CriticId } from "@trybunal/domain";
import { type FakeScript, FakeLlmClient, type LlmClient } from "@trybunal/llm";

/**
 * Proba generalna: rozprawa bez modelu i bez klucza API. Odpowiedzi stale, ale rozne dla krytykow
 * (jest spor i zmiana zdania), zeby frontend, scena i testy e2e mialy co pokazac.
 */
const SCORES: Readonly<Record<CriticId, number>> = { ats: 7, hr: 6, techLead: 5, hiringManager: 7, prosecutor: 3 };
const criticOf = (label: string) => CRITIC_IDS.find((id) => label.endsWith(`:${id}`));

/** Najdluzszy cytat, jaki bierzemy z CV — schemat oceny dopuszcza 500 znakow. */
const MAX_QUOTE = 120;

/**
 * Pierwsza linia CV z co najmniej trzema literami, przycieta do MAX_QUOTE. To fragment CV, wiec
 * przejdzie kontrole zmyslonych cytatow — a poprawka do niego pokaze diff na ekranie.
 */
export function firstQuotableLine(cvText: string): string | null {
  for (const raw of cvText.split("\n")) {
    const line = raw.trim().slice(0, MAX_QUOTE).trim();
    if ((line.match(/\p{L}/gu)?.length ?? 0) >= 3) return line;
  }
  return null;
}

export const rehearsalScript: FakeScript = (request) => {
  const critic = criticOf(request.label);
  if (request.label.startsWith("assessment:") && critic !== undefined) {
    const quote = firstQuotableLine(request.documents.find((d) => d.name === "cv")?.text ?? "");
    // Hiring Manager poprawia pierwszy punkt CV, Tech Lead ma do niego zastrzezenie.
    return {
      score: SCORES[critic],
      summary: `Proba generalna: ocena krytyka ${critic}.`,
      strengths: ["Konkretne technologie w doswiadczeniu"],
      concerns: critic === "techLead" && quote !== null ? [{ quote, issue: "Brak projektu, ktory to potwierdza.", severity: "medium" }] : [],
      rewrites:
        critic === "hiringManager" && quote !== null
          ? [{ original: quote, proposed: `${quote} (wynik: czas odpowiedzi API krotszy o 40%)`, reason: "Wplyw wyrazony liczba." }]
          : [],
    };
  }
  if (request.label === "prosecution") {
    return { speech: "Wysoki Sadzie, to CV obiecuje wiecej, niz pokazuje. Wnosze o odrzucenie." };
  }
  if (request.label.startsWith("statement:")) {
    // Tech Lead daje sie przekonac w pierwszej rundzie — w werdykcie widac zmiane zdania.
    const changes = request.label === "statement:1:techLead";
    return { statement: changes ? "Po namysle podnosze ocene." : "Podtrzymuje swoja ocene.", revisedScore: changes ? 6 : null };
  }
  return { justification: "Proba generalna: sad zaprasza kandydata na rozmowe, z uwagami krytykow." };
};

export const rehearsalLlm = () => new FakeLlmClient(rehearsalScript);

/**
 * Proba generalna z przerwa przed kazda odpowiedzia, zeby na ekranie bylo widac kolejne fazy
 * rozprawy, a nie od razu werdykt. Anulowanie przerywa tez czekanie.
 */
export const slowRehearsalLlm =
  (delayMs: number) =>
  (): LlmClient => {
    const fake = rehearsalLlm();
    return {
      generate: async (request, signal) => {
        await sleep(delayMs, signal);
        return fake.generate(request, signal);
      },
    };
  };
