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
}

const RULES: readonly Rule[] = [
  // Wyrazenia bez zagniezdzonych nieograniczonych powtorzen: dlugi tekst bez "@" sprawdzany byl od kazdej litery
  // do konca (czas kwadratowy — 100 tys. znakow to 26 s zablokowanego serwera). Lookbehind: start tylko na poczatku slowa.
  {
    kind: "email",
    pattern: /(?<![\p{L}\d._%+-])[\p{L}\d._%+-]{1,64}@[\p{L}\d-]{1,63}(?:\.[\p{L}\d-]{1,63}){0,5}\.\p{L}{2,24}/gu,
    replacement: "[EMAIL]",
  },
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
  // "+48601234567" tez ma 11 cyfr — po plusie to telefon, nie PESEL.
  { kind: "pesel", pattern: /(?<![\d+])\d{11}(?!\d)/gu, replacement: "[PESEL]" },
  {
    kind: "phone",
    // Konkretne formaty zamiast "ciag cyfr i odstepow": zachlanny ciag polykal sasiedni kod pocztowy
    // ("601 234 567 00-950"), byl odrzucany jako za dlugi i numer zostawal w tekscie.
    // Polskie: komorkowy 3-3-3, stacjonarny (22) 123 45 67; z +48/0048. Inne kraje: + i grupy cyfr z odstepami.
    pattern:
      /(?<![\d\w+])(?:(?:(?:\+|00)\d{2}[ -]?)?(?:\(\d{2}\)[ -]?\d{3}[ -]?\d{2}[ -]?\d{2}|\d{2}[ -]?\d{3}[ -]?\d{2}[ -]?\d{2}|\d{3}[ -]?\d{3}[ -]?\d{3})|\+\d{1,3}(?:[ -]\d{2,4}){2,4})(?![\d\w])/gu,
    replacement: "[TELEFON]",
  },
  { kind: "postalCode", pattern: /(?<!\d)\d{2}-\d{3}(?!\d)/gu, replacement: "[KOD POCZTOWY]" },
  {
    kind: "street",
    // Pierwszy wyraz takze z malej litery ("ul. kwiatowa 5" w pospiesznie pisanym CV).
    pattern: /\b(?:ul|al|os|pl)\.\s*\p{L}[\p{L}.-]{0,40}(?:\s+\p{Lu}[\p{L}.-]{0,40}){0,4}\s+\d+[a-z]?(?:\/\d+[a-z]?)?/gu,
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
  // Calosc pierwsza (najdluzsza), zeby "Anna Nowak" bylo jedna zamiana, a nie dwiema.
  const alternatives = [escaped.join("\\s+"), ...escaped];
  return { kind: "name", pattern: new RegExp(`(?<!\\p{L})(?:${alternatives.join("|")})(?!\\p{L})`, "giu"), replacement: "[KANDYDAT]" };
}

export function anonymize(text: string, candidateName?: string): Anonymized {
  const found: Partial<Record<PiiKind, number>> = {};
  const name = candidateName === undefined ? null : nameRule(candidateName);
  let result = text;
  for (const rule of name === null ? RULES : [...RULES, name]) {
    result = result.replace(rule.pattern, () => {
      found[rule.kind] = (found[rule.kind] ?? 0) + 1;
      return rule.replacement;
    });
  }
  return { text: result, found };
}
