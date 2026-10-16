import { PROMPTS } from "@trybunal/court";
import { describe, expect, it } from "vitest";
import { ANCHORS, PROMPTS_V2, SCALE_LINE, VARIANTS, variantByVersion } from "./variants.js";

describe("warianty promptow", () => {
  it("v1 to prompty sadu, v2 rozni sie tylko zasadami: kotwice zastepuja linie skali", () => {
    expect(VARIANTS.map((v) => v.version)).toEqual(["v1", "v2-kotwice"]);
    expect(VARIANTS[0]).toBe(PROMPTS);
    const [before = "", after = ""] = PROMPTS.rules.split(SCALE_LINE);
    expect(after.length).toBeGreaterThan(0);
    expect(PROMPTS_V2).toEqual({ ...PROMPTS, version: "v2-kotwice", rules: `${before}${ANCHORS}${after}` });
    // Jedna skala, nie dwie.
    expect(PROMPTS_V2.rules.match(/Skala ocen/g)).toHaveLength(1);
    expect(PROMPTS_V2.rules).not.toContain("6–7 zaprosić");
  });

  it("kotwice opisuja kazdy przedzial skali, w tym prog zaproszenia 6", () => {
    for (const band of ["9–10", "7–8", "- 6:", "4–5", "1–3"]) expect(ANCHORS).toContain(band);
    expect(ANCHORS).toContain("Wyjątek: Bot ATS");
  });

  it("wersje sa unikalne i da sie je znalezc po nazwie", () => {
    expect(new Set(VARIANTS.map((v) => v.version)).size).toBe(VARIANTS.length);
    expect(variantByVersion("v2-kotwice")).toBe(PROMPTS_V2);
    expect(variantByVersion("v3")).toBeUndefined();
  });
});
