import { wordDiff } from "@trybunal/domain";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DiffText } from "./DiffText.js";

describe("DiffText", () => {
  it("czesci diffu z domeny jako span, del i ins - sklejone daja oba teksty", () => {
    render(<DiffText before="Robilem API w Javie" after="Zbudowalem API w Javie i Kotlinie" />);
    const parts = [...(document.querySelector(".diff")?.children ?? [])].map((e) => [e.tagName, e.textContent]);
    expect(parts).toEqual(wordDiff("Robilem API w Javie", "Zbudowalem API w Javie i Kotlinie").map((p) => [{ same: "SPAN", removed: "DEL", added: "INS" }[p.kind], p.text]));
    expect(parts.map(([tag]) => tag)).toEqual(["DEL", "INS", "SPAN", "INS"]);
  });
});
