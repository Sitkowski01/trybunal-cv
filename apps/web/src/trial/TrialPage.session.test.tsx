import { act, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { fakeApi, full, setupPage as setup, status } from "../test/page.js";

describe("TrialPage - polaczenie", () => {
  it("problemy z polaczeniem: komunikat, a po wznowieniu znika", () => {
    const { last } = setup();
    // Zdarzenia polaczenia (nie koperty) wysylamy recznie, wiec tez w act.
    const emit = (type: string) => {
      act(() => {
        last().emit(type);
      });
    };
    emit("error");
    expect(screen.getByRole("alert")).toHaveTextContent("Polaczenie zerwane, wznawiam...");
    emit("open");
    expect(screen.queryByRole("alert")).toBeNull();
    last().readyState = 2;
    emit("error");
    expect(screen.getByRole("alert")).toHaveTextContent(/^Nie mozna polaczyc sie/u);
    expect(status()).toHaveTextContent("Utracono połączenie z rozprawą.");
  });

  it("koniec strumienia bez werdyktu", () => {
    const { send, end } = setup();
    send(...full.slice(0, 2));
    end("interrupted");
    expect(status()).toHaveTextContent("Rozprawa urwała się bez werdyktu");
  });

  it("informacja o ukrytych danych osobowych", () => {
    setup(fakeApi(), "e-mail ×1");
    expect(screen.getByText("Przed rozprawą ukryto dane osobowe: e-mail ×1.")).toBeInTheDocument();
  });
});

describe("TrialPage - akcje na sali", () => {
  it("w trakcie mozna przerwac; po werdykcie juz nie, za to zapomniec", async () => {
    const { send, api, user } = setup();
    expect(screen.queryByRole("button", { name: "Przerwij rozprawę" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Zapomnij/u })).toBeNull();
    send(...full.slice(0, 2));
    await user.click(screen.getByRole("button", { name: "Przerwij rozprawę" }));
    expect(api.cancel).toHaveBeenCalledWith("t-1");
    send(...full.slice(2));
    expect(screen.queryByRole("button", { name: "Przerwij rozprawę" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Zapomnij rozprawę (usuń dane)" }));
    expect(api.forget).toHaveBeenCalledWith("t-1");
    expect(await screen.findByText(/^Rozprawa zapomniana/u)).toBeInTheDocument();
  });

  it("zdarzenie niezgodne z przebiegiem: alert i koniec sledzenia", () => {
    const { send } = setup();
    send(full[0] as (typeof full)[number], { ...(full[6] as (typeof full)[number]), seq: 2 });
    expect(screen.getByRole("alert")).toHaveTextContent(/^Serwer przysłał zdarzenie niezgodne z przebiegiem rozprawy/u);
    expect(status()).toHaveTextContent("Utracono połączenie z rozprawą.");
    expect(screen.queryByRole("button", { name: "Przerwij rozprawę" })).toBeNull();
  });

  it("nowa sprawa zamyka sale - takze po zapomnieniu", async () => {
    const { send, user, onClose, last, unmount } = setup();
    await user.click(screen.getByRole("button", { name: "Nowa sprawa" }));
    expect(onClose).toHaveBeenCalledOnce();
    send(...full);
    await user.click(screen.getByRole("button", { name: /Zapomnij/u }));
    await user.click(await screen.findByRole("button", { name: "Nowa sprawa" }));
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(last().closed).toBe(false);
    unmount();
    expect(last().closed).toBe(true);
  });
});
