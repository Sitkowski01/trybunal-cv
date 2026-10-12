/**
 * Sklad trybunalu. Przysiegli oceniaja CV niezaleznie, prokurator szuka powodu do odrzucenia,
 * sedzia nie ocenia sam — wazy glosy i oglasza werdykt.
 */
export const CRITIC_IDS = ["ats", "hr", "techLead", "hiringManager", "prosecutor"] as const;

export type CriticId = (typeof CRITIC_IDS)[number];

export type CourtRole = "juror" | "prosecutor";

export interface Critic {
  readonly id: CriticId;
  readonly name: string;
  readonly role: CourtRole;
  readonly focus: string;
  /** Rubryka: o co krytyk pyta przy kazdym CV. Z niej powstaje prompt i lista na scenie. */
  readonly criteria: readonly string[];
}

const CRITICS_BY_ID: { readonly [K in CriticId]: Critic & { readonly id: K } } = {
  ats: {
    id: "ats",
    name: "Bot ATS",
    role: "juror",
    focus: "slowa kluczowe z ogloszenia i format, ktory przejdzie automatyczny filtr",
    criteria: [
      "slowa kluczowe z ogloszenia obecne w CV doslownie",
      "czytelna struktura: sekcje, daty, brak tabel i grafik",
      "technologie wymagane w ofercie wymienione z nazwy",
    ],
  },
  hr: {
    id: "hr",
    name: "HR screener",
    role: "juror",
    focus: "pierwsze 6 sekund: spojna sciezka, luki w zatrudnieniu, sygnaly ostrzegawcze",
    criteria: [
      "spojna sciezka kariery bez niewyjasnionych luk",
      "przejrzystosc: najwazniejsze widac w pierwszych sekundach",
      "poziom stanowiska dopasowany do doswiadczenia",
    ],
  },
  techLead: {
    id: "techLead",
    name: "Tech Lead",
    role: "juror",
    focus: "czy umiejetnosci sa potwierdzone projektami i jaki to poziom",
    criteria: [
      "kazda wymieniona umiejetnosc potwierdzona projektem",
      "glebokosc techniczna: decyzje, skala, trudne problemy",
      "realny poziom seniority zamiast deklarowanego",
    ],
  },
  hiringManager: {
    id: "hiringManager",
    name: "Hiring Manager",
    role: "juror",
    focus: "wplyw pracy wyrazony liczbami zamiast listy obowiazkow",
    criteria: [
      "wyniki wyrazone liczbami: skala, czas, pieniadze",
      "wplyw na zespol albo produkt, nie lista obowiazkow",
      "czy kandydat rozwiaze problem opisany w ogloszeniu",
    ],
  },
  prosecutor: {
    id: "prosecutor",
    name: "Prokurator",
    role: "prosecutor",
    focus: "najmocniejszy powod, zeby kandydata odrzucic",
    criteria: [
      "najslabszy punkt CV, ktory moze przewazyc",
      "rozjazd miedzy deklaracjami a dowodami",
      "powod, dla ktorego inny kandydat bylby bezpieczniejszy",
    ],
  },
};

export const CRITICS: readonly Critic[] = CRITIC_IDS.map((id) => CRITICS_BY_ID[id]);

export function isCriticId(value: string): value is CriticId {
  return (CRITIC_IDS as readonly string[]).includes(value);
}

export function criticById(id: CriticId): Critic {
  return CRITICS_BY_ID[id];
}

export function jurors(): readonly Critic[] {
  return CRITICS.filter((c) => c.role === "juror");
}
