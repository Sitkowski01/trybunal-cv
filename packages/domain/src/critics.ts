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
}

const CRITICS_BY_ID: { readonly [K in CriticId]: Critic & { readonly id: K } } = {
  ats: {
    id: "ats",
    name: "Bot ATS",
    role: "juror",
    focus: "slowa kluczowe z ogloszenia i format, ktory przejdzie automatyczny filtr",
  },
  hr: {
    id: "hr",
    name: "HR screener",
    role: "juror",
    focus: "pierwsze 6 sekund: spojna sciezka, luki w zatrudnieniu, sygnaly ostrzegawcze",
  },
  techLead: {
    id: "techLead",
    name: "Tech Lead",
    role: "juror",
    focus: "czy umiejetnosci sa potwierdzone projektami i jaki to poziom",
  },
  hiringManager: {
    id: "hiringManager",
    name: "Hiring Manager",
    role: "juror",
    focus: "wplyw pracy wyrazony liczbami zamiast listy obowiazkow",
  },
  prosecutor: {
    id: "prosecutor",
    name: "Prokurator",
    role: "prosecutor",
    focus: "najmocniejszy powod, zeby kandydata odrzucic",
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
