import cv from "@examples/cv-monika-sadowska.md?raw";
import offer from "@examples/oferta-junior-java-fintech.md?raw";

/**
 * Sprawa z nagrania demo — fikcyjne CV i oferta z examples/ (te same co w zbiorze ewaluacji).
 * Wybrana sposrod trzech nagranych spraw granicznych: najwiecej zmian zdania i werdykt o wlos od progu.
 */
export const DEMO_CASE = {
  cv,
  offer,
  summary: "Księgowa z 8 latami rozliczeń płatności po bootcampie Javy aplikuje na juniora do zespołu płatności.",
} as const;
