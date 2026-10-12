/**
 * Anonimizacja CV przed rozprawa: dane kontaktowe i identyfikatory nie sa potrzebne krytykom,
 * a nie powinny trafic ani do modelu, ani do dziennika. Zamieniamy je na znaczniki, zeby krytyk
 * widzial, ze kontakt jest podany (ATS to sprawdza), ale nie widzial jaki.
 * Kolejnosc regul ma znaczenie: najpierw linki i e-maile (zawieraja cyfry), potem PESEL przed telefonem.
 * Imienia i nazwiska nie da sie pewnie wykryc w tekscie — podaje je wnoszacy sprawe.
 */
export type PiiKind = "email" | "link" | "birthDate" | "pesel" | "phone" | "postalCode" | "street" | "name";

export interface Anonymized {
  readonly text: string;
  /** Ile zamian kazdego rodzaju — do pokazania kandydatowi, co zostalo ukryte. */
  readonly found: Readonly<Partial<Record<PiiKind, number>>>;
}

interface Rule {
  readonly kind: PiiKind;
  readonly pattern: RegExp;
  readonly replacement: string;
  /** Dodatkowy warunek na dopasowanie, ktorego nie da sie wygodnie wyrazic wyrazeniem. */
  readonly accept?: (match: string) => boolean;
}

const digits = (s: string) => s.replace(/\D/g, "").length;

const RULES: readonly Rule[] = [
  { kind: "email", pattern: /[\p{L}\d._%+-]+@[\p{L}\d-]+(?:\.[\p{L}\d-]+)*\.\p{L}{2,}/gu, replacement: "[EMAIL]" },
  {
    kind: "link",
    // Bez \b na poczatku: po PESEL-u sklejonym z linkiem druga anonimizacja dalaby co innego niz pierwsza.
    // Interpunkcja na koncu (przecinek po linku) nie jest czescia adresu.
    pattern: /(?:https?:\/\/|www\.|(?:linkedin|github|gitlab)\.com\/)\S*[^\s.,;:!?)\]"']/giu,
    replacement: "[LINK]",
  },
  {
    kind: "birthDate",
    pattern: /\b(?:data urodzenia|urodzon[ya]|ur\.)\s*:?\s*\d{1,2}[./-]\d{1,2}[./-]\d{4}/giu,
    replacement: "[DATA URODZENIA]",
  },
  { kind: "pesel", pattern: /(?<!\d)\d{11}(?!\d)/gu, replacement: "[PESEL]" },
  {
    kind: "phone",
    pattern: /(?<![\d\w(])(?:\+|00)?\(?\d[\d ()-]{7,16}\d(?![\d\w])/gu,
    replacement: "[TELEFON]",
    // 9 cyfr (PL) do 13 (z kodem kraju po 00); zakres lat "2019 - 2023" ma 8 cyfr i nie przejdzie.
    accept: (m) => digits(m) >= 9 && digits(m) <= 13 && !/\d[./]\d/u.test(m),
  },
  { kind: "postalCode", pattern: /(?<!\d)\d{2}-\d{3}(?!\d)/gu, replacement: "[KOD POCZTOWY]" },
  {
    kind: "street",
    pattern: /\b(?:ul|al|os|pl)\.\s*\p{Lu}[\p{L}.-]*(?:\s+\p{Lu}[\p{L}.-]*)*\s+\d+[a-z]?(?:\/\d+[a-z]?)?/gu,
    replacement: "[ADRES]",
  },
];

/** Wszystkie formy imienia i nazwiska: calosc i kazda czesc osobno (CV pisze tez samo nazwisko). */
function nameRule(name: string): Rule | null {
  const parts = name.split(/\s+/u).filter((p) => p.length >= 2);
  if (parts.length === 0) {
    return null;
  }
  const escaped = parts.map((p) => p.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"));
  const alternatives = [escaped.join("\\s+"), ...escaped];
  // Dluzsze najpierw, zeby "Anna Nowak" bylo jedna zamiana, a nie dwiema.
  alternatives.sort((a, b) => b.length - a.length);
  return { kind: "name", pattern: new RegExp(`(?<!\\p{L})(?:${alternatives.join("|")})(?!\\p{L})`, "giu"), replacement: "[KANDYDAT]" };
}

export function anonymize(text: string, candidateName?: string): Anonymized {
  const found: Partial<Record<PiiKind, number>> = {};
  const name = candidateName === undefined ? null : nameRule(candidateName.trim());
  let result = text;
  for (const rule of name === null ? RULES : [...RULES, name]) {
    result = result.replace(rule.pattern, (match) => {
      if (rule.accept !== undefined && !rule.accept(match)) {
        return match;
      }
      found[rule.kind] = (found[rule.kind] ?? 0) + 1;
      return rule.replacement;
    });
  }
  return { text: result, found };
}
