import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { CourtSceneProps } from "../scene/CourtScene.js";
import { full, setupPage as setup } from "../test/page.js";

// Prawdziwa scena potrzebuje WebGL, ktorego jsdom nie ma; atrapa pokazuje, co dostala od strony.
vi.mock("../scene/CourtScene.js", () => ({
  default: ({ direction, reducedMotion, lowPower }: CourtSceneProps) => (
    <div data-testid="scene" data-shot={direction.shot} data-speaker={direction.bubble?.who ?? ""} data-verdict={direction.verdict ?? ""} data-still={String(reducedMotion)} data-low={String(lowPower)} />
  ),
}));

describe("sala 3D na stronie rozprawy", () => {
  it("bez wsparcia WebGL nie ma sceny ani przelacznika", () => {
    setup();
    expect(screen.queryByRole("region", { name: "Sala rozpraw" })).toBeNull();
    expect(screen.queryByRole("button", { name: /salę 3D/u })).toBeNull();
  });

  it("scena dostaje rezyserie ze strumienia: mowca w debacie, potem werdykt", async () => {
    const { send } = setup(undefined, null, { reducedMotion: false, lowPower: false });
    send(...full.slice(0, 8)); // wniesienie, 5 ocen, mowa, pierwsza wypowiedz (ATS)
    const scene = await screen.findByTestId("scene");
    expect(scene).toHaveAttribute("data-shot", "jury");
    expect(scene).toHaveAttribute("data-speaker", "ats");
    expect(scene).toHaveAttribute("data-still", "false");
    expect(scene).toHaveAttribute("data-low", "false");
    send(...full.slice(8));
    expect(scene).toHaveAttribute("data-shot", "judge");
    expect(scene).toHaveAttribute("data-verdict", "invite");
  });

  it("przelacznik chowa i pokazuje scene; tryb bez ruchu i oszczedny trafiaja do sceny", async () => {
    const { user } = setup(undefined, null, { reducedMotion: true, lowPower: true });
    const shown = await screen.findByTestId("scene");
    expect(shown).toHaveAttribute("data-still", "true");
    expect(shown).toHaveAttribute("data-low", "true");
    const toggle = screen.getByRole("button", { name: "Ukryj salę 3D" });
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    await user.click(toggle);
    expect(screen.queryByTestId("scene")).toBeNull();
    expect(screen.getByRole("button", { name: "Pokaż salę 3D" })).toHaveAttribute("aria-pressed", "false");
    await user.click(screen.getByRole("button", { name: "Pokaż salę 3D" }));
    expect(await screen.findByTestId("scene")).toBeInTheDocument();
  });
});
