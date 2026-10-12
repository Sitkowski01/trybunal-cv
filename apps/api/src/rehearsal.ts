import { CRITIC_IDS, type CriticId } from "@trybunal/domain";
import { type FakeScript, FakeLlmClient } from "@trybunal/llm";

/**
 * Proba generalna: rozprawa bez modelu i bez klucza API. Odpowiedzi stale, ale rozne dla krytykow
 * (jest spor i zmiana zdania), zeby frontend, scena i testy e2e mialy co pokazac.
 */
const SCORES: Readonly<Record<CriticId, number>> = { ats: 7, hr: 6, techLead: 5, hiringManager: 7, prosecutor: 3 };
const criticOf = (label: string) => CRITIC_IDS.find((id) => label.endsWith(`:${id}`));

export const rehearsalScript: FakeScript = (request) => {
  const critic = criticOf(request.label);
  if (request.label.startsWith("assessment:") && critic !== undefined) {
    return {
      score: SCORES[critic],
      summary: `Proba generalna: ocena krytyka ${critic}.`,
      strengths: ["Konkretne technologie w doswiadczeniu"],
      concerns: [],
      rewrites: [],
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
