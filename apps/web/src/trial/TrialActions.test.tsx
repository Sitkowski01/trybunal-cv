import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client.js";
import { TrialActions, type TrialActionsProps } from "./TrialActions.js";

function setup(props: Partial<TrialActionsProps> = {}) {
  const all: TrialActionsProps = {
    trialId: "t-1",
    api: { cancel: vi.fn(() => Promise.resolve()), forget: vi.fn(() => Promise.resolve()) },
    running: false,
    settled: false,
    onForgotten: vi.fn(),
    onClose: vi.fn(),
    ...props,
  };
  render(<TrialActions {...all} />);
  return { ...all, user: userEvent.setup({ delay: null }) };
}

const buttons = () => screen.getAllByRole("button").map((b) => b.textContent);

describe("TrialActions", () => {
  it("przed pierwszym zdarzeniem: tylko nowa sprawa", () => {
    setup();
    expect(buttons()).toEqual(["Nowa sprawa"]);
  });

  it("rozprawa trwa: przerwanie i nowa sprawa", () => {
    setup({ running: true });
    expect(buttons()).toEqual(["Przerwij rozprawę", "Nowa sprawa"]);
  });

  it("skonczona: zapomnienie wola API i zglasza sukces", async () => {
    const { user, api, onForgotten, onClose } = setup({ settled: true });
    expect(buttons()).toEqual(["Zapomnij rozprawę (usuń dane)", "Nowa sprawa"]);
    await user.click(screen.getByRole("button", { name: "Zapomnij rozprawę (usuń dane)" }));
    expect(api.forget).toHaveBeenCalledWith("t-1");
    expect(onForgotten).toHaveBeenCalledOnce();
    await user.click(screen.getByRole("button", { name: "Nowa sprawa" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("przerywanie: przycisk nieaktywny do zdarzenia przerwania; po bledzie znow aktywny", async () => {
    let reject: (error: unknown) => void = () => undefined;
    const cancel = vi.fn(() => new Promise<void>((_, r) => (reject = r)));
    const { user } = setup({ running: true, api: { cancel, forget: vi.fn() } });
    await user.click(screen.getByRole("button", { name: "Przerwij rozprawę" }));
    const pending = screen.getByRole("button", { name: "Przerywam…" });
    expect(pending).toBeDisabled();
    await user.click(pending);
    expect(cancel).toHaveBeenCalledExactlyOnceWith("t-1");
    act(() => {
      reject(new ApiError(503, "Serwer sie zamyka"));
    });
    expect(await screen.findByRole("button", { name: "Przerwij rozprawę" })).toBeEnabled();
    expect(screen.getByRole("alert")).toHaveTextContent("Serwer sie zamyka");
  });

  it("blad bez ApiError: ogolny komunikat; kolejna proba czysci poprzedni blad", async () => {
    const forget = vi.fn(() => Promise.reject(new Error("?")));
    const { user, onForgotten } = setup({ settled: true, api: { cancel: vi.fn(), forget } });
    await user.click(screen.getByRole("button", { name: /Zapomnij/u }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Nieoczekiwany błąd");
    expect(onForgotten).not.toHaveBeenCalled();
    forget.mockReturnValue(new Promise(() => undefined));
    await user.click(screen.getByRole("button", { name: /Zapomnij/u }));
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
