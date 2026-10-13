import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TrialApi } from "./api/client.js";
import { App } from "./App.js";
import { fakeSources } from "./test/sources.js";

const api: TrialApi = {
  file: vi.fn(() => Promise.resolve({ trialId: "t-9", anonymized: { email: 1, phone: 0 } })),
  cancel: vi.fn(),
  forget: vi.fn(),
  eventsUrl: (id) => `/api/trials/${id}/events`,
};

afterEach(() => {
  window.history.replaceState(null, "", "/");
});

function setup() {
  const sources = fakeSources();
  render(<App api={api} sources={sources.factory} />);
  return { ...sources, user: userEvent.setup({ delay: null }) };
}

describe("App", () => {
  it("bez rozprawy w adresie: formularz; po wniesieniu: sala z id w adresie i informacja o anonimizacji", async () => {
    const { user, last } = setup();
    expect(screen.getByRole("heading", { name: "Trybunał CV", level: 1 })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Wczytaj przykład" }));
    await user.click(screen.getByRole("button", { name: "Wnieś sprawę" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Łączenie z salą rozpraw…");
    expect(window.location.search).toBe("?rozprawa=t-9");
    expect(last().url).toBe("/api/trials/t-9/events");
    expect(screen.getByText("Przed rozprawą ukryto dane osobowe: e-mail ×1.")).toBeInTheDocument();
  });

  it("informacja o anonimizacji znika po nawigacji w przegladarce (dotyczy tylko swiezego wniesienia)", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: "Wczytaj przykład" }));
    await user.click(screen.getByRole("button", { name: "Wnieś sprawę" }));
    await screen.findByText(/ukryto dane osobowe/u);
    act(() => {
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(screen.queryByText(/ukryto dane osobowe/u)).toBeNull();
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("po odmontowaniu nie slucha juz nawigacji przegladarki", () => {
    const remove = vi.spyOn(window, "removeEventListener");
    const { unmount } = render(<App api={api} sources={fakeSources().factory} />);
    unmount();
    expect(remove).toHaveBeenCalledWith("popstate", expect.any(Function));
    remove.mockRestore();
  });

  it("rozprawa z adresu (odswiezenie, link) - bez informacji o anonimizacji", () => {
    window.history.replaceState(null, "", "/?rozprawa=t-1");
    const { last } = setup();
    expect(last().url).toBe("/api/trials/t-1/events");
    expect(screen.queryByText(/ukryto dane osobowe/u)).toBeNull();
  });

  it("nowa sprawa wraca do formularza; wstecz w przegladarce wraca do rozprawy", async () => {
    window.history.replaceState(null, "", "/?rozprawa=t-1");
    const { user, created } = setup();
    await user.click(screen.getByRole("button", { name: "Nowa sprawa" }));
    expect(window.location.search).toBe("");
    expect(screen.getByRole("button", { name: "Wnieś sprawę" })).toBeInTheDocument();
    expect(created[0]?.closed).toBe(true);
    act(() => {
      window.history.replaceState(null, "", "/?rozprawa=t-1");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(created).toHaveLength(2);
  });
});
