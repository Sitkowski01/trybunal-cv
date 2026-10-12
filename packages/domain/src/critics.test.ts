import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { CRITIC_IDS, CRITICS, criticById, isCriticId, jurors } from "./critics.js";

describe("sklad trybunalu", () => {
  it("ma pieciu krytykow w stalej kolejnosci miejsc przy stole", () => {
    expect(CRITICS.map((c) => c.id)).toEqual([
      "ats",
      "hr",
      "techLead",
      "hiringManager",
      "prosecutor",
    ]);
  });

  it("ma dokladnie jednego prokuratora", () => {
    expect(CRITICS.filter((c) => c.role === "prosecutor").map((c) => c.id)).toEqual([
      "prosecutor",
    ]);
  });

  it("przysiegli to wszyscy oprocz prokuratora", () => {
    expect(jurors().map((c) => c.id)).toEqual(["ats", "hr", "techLead", "hiringManager"]);
  });

  it("kazdy krytyk ma nazwe i to, na co patrzy", () => {
    for (const critic of CRITICS) {
      expect(critic.name.trim()).not.toBe("");
      expect(critic.focus.trim()).not.toBe("");
    }
  });

  it("nazwy krytykow sa unikalne", () => {
    expect(new Set(CRITICS.map((c) => c.name)).size).toBe(CRITICS.length);
  });

  it.each(CRITIC_IDS)("criticById(%s) zwraca krytyka o tym id", (id) => {
    expect(criticById(id).id).toBe(id);
  });

  it("criticById zwraca ten sam obiekt co lista", () => {
    expect(criticById("hr")).toBe(CRITICS[1]);
  });
});

describe("isCriticId", () => {
  it.each(CRITIC_IDS)("rozpoznaje %s", (id) => {
    expect(isCriticId(id)).toBe(true);
  });

  it.each(["", "judge", "ATS", "hr ", "techlead"])("odrzuca %j", (value) => {
    expect(isCriticId(value)).toBe(false);
  });

  it("odrzuca kazdy napis spoza listy", () => {
    fc.assert(
      fc.property(
        fc.string().filter((s) => !(CRITIC_IDS as readonly string[]).includes(s)),
        (value) => !isCriticId(value),
      ),
    );
  });
});
