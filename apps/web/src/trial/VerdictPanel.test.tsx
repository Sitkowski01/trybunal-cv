import type { Verdict } from "@trybunal/domain";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { VerdictPanel } from "./VerdictPanel.js";

describe("VerdictPanel", () => {
  const verdict: Verdict = {
    decision: "reject",
    juryAverage: 5.25,
    atsGateFailed: false,
    spread: 2,
    disputed: false,
    harshest: ["hr", "techLead"],
    mildest: ["ats"],
    mindChanges: [
      { criticId: "techLead", from: 5, to: 6 },
      { criticId: "hr", from: 4, to: 3 },
    ],
  };

  it("odrzucenie: pieczec, srednia z progiem, ATS przeszlo, bez sporu, zmiany zdania", () => {
    render(<VerdictPanel verdict={verdict} justification="Za malo dowodow." />);
    expect(screen.getByRole("region", { name: "Odrzucić" })).toHaveClass("verdict", "verdict--reject");
    const facts = screen.getAllByRole("definition").map((d) => d.textContent);
    expect(facts).toEqual(["5,3 (próg 6)", "przeszło", "2 ", "HR screener, Tech Lead / Bot ATS"]);
    expect(screen.getByText("Zmiana zdania w debacie: Tech Lead 5→6, HR screener 4→3")).toBeInTheDocument();
    expect(screen.getByRole("blockquote")).toHaveTextContent("Za malo dowodow.");
  });

  it("zaproszenie bez zmian zdania", () => {
    render(<VerdictPanel verdict={{ ...verdict, decision: "invite", mindChanges: [] }} justification="Zapraszamy." />);
    expect(screen.getByRole("region", { name: "Zaprosić" })).toHaveClass("verdict--invite");
    expect(screen.queryByText(/Zmiana zdania/u)).toBeNull();
  });
});
