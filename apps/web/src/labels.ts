import type { CriticId, Phase } from "@trybunal/domain";
import type { Activity } from "./trial/activity.js";

/**
 * Teksty interfejsu. Nazwy i rubryki krytykow zyja w domenie (bez polskich znakow, bo ida tez
 * do promptow i logow); tu jest ich wersja dla czlowieka na ekranie.
 */
export const CRITIC_LABELS: Readonly<Record<CriticId, { readonly name: string; readonly role: string; readonly emblem: string }>> = {
  ats: { name: "Bot ATS", role: "Słowa kluczowe i format, który przejdzie automatyczny filtr", emblem: "⚙" },
  hr: { name: "HR screener", role: "Pierwsze 6 sekund: spójna ścieżka, luki, sygnały ostrzegawcze", emblem: "◎" },
  techLead: { name: "Tech Lead", role: "Czy umiejętności są potwierdzone projektami", emblem: "⌘" },
  hiringManager: { name: "Hiring Manager", role: "Wpływ pracy wyrażony liczbami", emblem: "◆" },
  prosecutor: { name: "Prokurator", role: "Najmocniejszy powód, żeby odrzucić", emblem: "⚖" },
};

export const PHASES: readonly { readonly phase: Phase; readonly label: string }[] = [
  { phase: "assessing", label: "Oceny" },
  { phase: "prosecution", label: "Oskarżenie" },
  { phase: "debate", label: "Debata" },
  { phase: "deliberation", label: "Narada" },
  { phase: "closed", label: "Werdykt" },
];

export const ACTIVITY_LABELS: Readonly<Record<Activity, string>> = {
  thinking: "czyta akta…",
  assessed: "ocenił",
  speaking: "przemawia",
  preparing: "szykuje odpowiedź…",
  listening: "słucha",
  idle: "czeka",
};

export const SEVERITY_LABELS = { low: "drobne", medium: "istotne", high: "poważne" } as const;

/** Rodzaje danych osobowych ukrytych przez serwer (klucze z odpowiedzi API). */
export const PII_LABELS: Readonly<Record<string, string>> = {
  email: "e-mail",
  link: "link",
  birthDate: "data urodzenia",
  pesel: "PESEL",
  phone: "telefon",
  postalCode: "kod pocztowy",
  street: "adres",
  name: "imię i nazwisko",
};

/**
 * Koszt w nanodolarach jako "$0.0123": jak formatUsd w packages/llm (CLI) — zaokraglenie w gore,
 * zeby nie zanizac kosztu. Kopia, bo frontend nie moze zalezec od warstwy LLM (reguly architektury).
 */
export function formatUsd(nanoUsd: number): string {
  const tenThousandths = Math.ceil(nanoUsd / 100_000);
  return `$${String(Math.floor(tenThousandths / 10_000))}.${String(tenThousandths % 10_000).padStart(4, "0")}`;
}

/** Srednia ocen z jednym miejscem po przecinku, po polsku. */
export const formatScore = (score: number) => score.toLocaleString("pl-PL", { maximumFractionDigits: 1 });

/** "2 e-maile"-podobne podsumowanie bez odmiany: "e-mail ×2, telefon ×1". */
export function describeAnonymized(found: Readonly<Record<string, number>>): string | null {
  const parts = Object.entries(found)
    .filter(([, count]) => count > 0)
    .map(([kind, count]) => `${PII_LABELS[kind] ?? kind} ×${String(count)}`);
  return parts.length === 0 ? null : parts.join(", ");
}
