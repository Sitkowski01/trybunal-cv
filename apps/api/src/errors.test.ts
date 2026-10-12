import { describe, expect, it } from "vitest";
import { DecryptionError } from "./crypto.js";
import { TrialForgottenError, TrialNotFoundError } from "./journal.js";
import { UnreadablePdfError } from "./pdf.js";
import { CourtBusyError, InvalidTrialError } from "./service.js";
import { ConflictError } from "./store.js";

// Nazwy bledow trafiaja do logow i do mapowania na kody HTTP — musza mowic, co sie stalo.
describe("bledy domenowe API", () => {
  it.each([
    [new DecryptionError("x"), "DecryptionError"],
    [new TrialNotFoundError("x"), "TrialNotFoundError"],
    [new TrialForgottenError("x"), "TrialForgottenError"],
    [new UnreadablePdfError("x"), "UnreadablePdfError"],
    [new CourtBusyError("x", "closing"), "CourtBusyError"],
    [new InvalidTrialError(["a"]), "InvalidTrialError"],
    [new ConflictError("x"), "ConflictError"],
  ])("%s ma nazwe %s", (error, name) => {
    expect(error.name).toBe(name);
    expect(error).toBeInstanceOf(Error);
  });

  it("InvalidTrialError laczy problemy srednikiem", () => {
    expect(new InvalidTrialError(["cvText: za krotkie", "debateRounds: za duzo"]).message).toBe(
      "Niepoprawne dane rozprawy: cvText: za krotkie; debateRounds: za duzo",
    );
  });
});
