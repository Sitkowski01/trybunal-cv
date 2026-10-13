import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { assessment } from "../test/trials.js";
import type { Seat } from "./seats.js";
import { Report } from "./Report.js";

describe("Report", () => {
  const seat = (criticId: Seat["criticId"], extra: Parameters<typeof assessment>[2]): Seat => ({
    criticId,
    assessment: assessment(criticId, 5, extra),
    score: 5,
    statements: [],
  });

  it("zastrzezenia od najpowazniejszych, z autorem i waga; mocne strony z autorem", () => {
    render(
      <Report
        seats={[
          seat("ats", { concerns: [{ quote: "Java", issue: "drobne", severity: "low" }], strengths: ["Testy"] }),
          seat("hr", { concerns: [{ quote: "Spring", issue: "srednie", severity: "medium" }] }),
          seat("techLead", { concerns: [{ quote: "Boot", issue: "powazne", severity: "high" }] }),
        ]}
      />,
    );
    const concerns = document.querySelectorAll(".concern");
    expect([...concerns].map((c) => c.className)).toEqual(["concern concern--high", "concern concern--medium", "concern concern--low"]);
    expect(concerns[0]).toHaveTextContent("Boot");
    expect(concerns[0]).toHaveTextContent("Tech Lead · poważne");
    expect(concerns[2]).toHaveTextContent("Bot ATS · drobne");
    expect(screen.getByRole("heading", { name: "Mocne strony" })).toBeInTheDocument();
    expect(screen.getByText("Testy").closest("li")).toHaveTextContent("Testy — Bot ATS");
  });

  it("miejsce bez oceny jest pomijane", () => {
    render(<Report seats={[{ criticId: "hr", assessment: null, score: null, statements: [] }]} />);
    expect(screen.getByText("Krytycy nie zaproponowali poprawek.")).toBeInTheDocument();
    expect(screen.getByText("Brak zastrzeżeń.")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Mocne strony" })).toBeNull();
  });

  it("poprawka jako diff z uzasadnieniem i autorem", () => {
    render(<Report seats={[seat("hiringManager", { rewrites: [{ original: "Pisalem testy.", proposed: "Pisalem testy (90%).", reason: "Liczby" }] })]} />);
    expect(screen.getByText("Hiring Manager: Liczby")).toBeInTheDocument();
    expect(document.querySelector(".rewrite .diff")).toHaveTextContent("Pisalem testy.testy (90%).");
  });
});
