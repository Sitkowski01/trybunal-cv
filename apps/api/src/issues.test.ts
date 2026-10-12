import { describe, expect, it } from "vitest";
import { describeIssues } from "./issues.js";

describe("describeIssues", () => {
  it("sciezka zagniezdzona z kropkami, pusta jako (calosc)", () => {
    expect(describeIssues([{ path: ["a", 0, "b"], message: "zle" }, { path: [], message: "nie obiekt" }])).toEqual([
      "a.0.b: zle",
      "(calosc): nie obiekt",
    ]);
  });
});
