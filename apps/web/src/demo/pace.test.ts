import { toPublicEvent } from "@trybunal/domain";
import { describe, expect, it } from "vitest";
import { trial } from "../test/trials.js";
import {
  AFTER_ASSESSMENT_MS,
  MAX_SPEECH_MS,
  MIN_SPEECH_MS,
  MS_PER_CHAR,
  pauseAfter,
  READING_FILES_MS,
} from "./pace.js";

const statement = (text: string) => ({ type: "StatementMade", round: 1, criticId: "hr", statement: text, revisedScore: null }) as const;

describe("pauseAfter", () => {
  it("wniesienie: czas na czytanie akt; ocena: krotka przerwa; koniec rozprawy: zero", () => {
    const [filed, assessment, ...rest] = trial([7, 6, 5, 7, 3], []).map(toPublicEvent);
    expect(filed && pauseAfter(filed)).toBe(READING_FILES_MS);
    expect(assessment && pauseAfter(assessment)).toBe(AFTER_ASSESSMENT_MS);
    const verdict = rest.at(-1);
    expect(verdict?.type).toBe("VerdictAnnounced");
    expect(verdict && pauseAfter(verdict)).toBe(0);
    expect(pauseAfter({ type: "TrialAborted", reason: "budzet" })).toBe(0);
  });

  it("mowa i wypowiedz: czas czytania od dlugosci tekstu, w granicach", () => {
    expect(pauseAfter(statement("x".repeat(100)))).toBe(100 * MS_PER_CHAR);
    expect(pauseAfter({ type: "ProsecutionDelivered", speech: "y".repeat(150) })).toBe(150 * MS_PER_CHAR);
    expect(pauseAfter(statement("Tak."))).toBe(MIN_SPEECH_MS);
    expect(pauseAfter(statement("z".repeat(2000)))).toBe(MAX_SPEECH_MS);
  });
});
