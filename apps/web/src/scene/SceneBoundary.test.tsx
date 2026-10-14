import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SceneBoundary } from "./SceneBoundary.js";

function Broken(): never {
  throw new Error("brak modelu");
}

describe("granica bledu sceny", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("bez bledu pokazuje scene", () => {
    render(<SceneBoundary>scena</SceneBoundary>);
    expect(screen.getByText("scena")).toBeInTheDocument();
  });

  it("blad wewnatrz sceny zamienia ja w komunikat zamiast wywracac strone", () => {
    // React zapisuje zlapany blad w konsoli — tu jest oczekiwany.
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(
      <main>
        <SceneBoundary>
          <Broken />
        </SceneBoundary>
        <p>widok 2D</p>
      </main>,
    );
    expect(screen.getByText(/Nie udało się wczytać sali 3D/u)).toBeInTheDocument();
    expect(screen.getByText("widok 2D")).toBeInTheDocument();
  });
});
