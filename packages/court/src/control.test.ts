import { describe, expect, it } from "vitest";
import { abortReason, allOrNothing, MAX_REASON, sleep } from "./control.js";

/** Zadanie, ktore konczy sie dopiero na sygnal albo na anulowanie. */
function controllable() {
  const finish = new Map<number, () => void>();
  const aborted: number[] = [];
  const done: number[] = [];
  const run = (item: number, signal: AbortSignal) =>
    new Promise<void>((resolve, reject) => {
      signal.addEventListener("abort", () => {
        aborted.push(item);
        reject(new Error(`anulowano ${String(item)}`));
      });
      finish.set(item, () => {
        done.push(item);
        resolve();
      });
    });
  return { run, finish, aborted, done };
}

describe("allOrNothing", () => {
  it("konczy sie, gdy wszystkie zadania sie udadza", async () => {
    const seen: number[] = [];
    await allOrNothing([1, 2, 3], (n) => (seen.push(n), Promise.resolve()));
    expect(seen).toEqual([1, 2, 3]);
  });

  it("porazka jednego anuluje pozostale, a blad wychodzi po ich zakonczeniu", async () => {
    const { run, aborted } = controllable();
    const failing = (n: number, signal: AbortSignal) => (n === 2 ? Promise.reject(new Error("dwojka")) : run(n, signal));
    await expect(allOrNothing([1, 2, 3], failing)).rejects.toThrow("dwojka");
    expect(aborted.sort()).toEqual([1, 3]);
  });

  it("zadanie, ktore skonczylo sie przed porazka, zostaje skonczone", async () => {
    const { run, finish, done } = controllable();
    const result = allOrNothing([1, 2], (n, s) => (n === 2 ? Promise.resolve().then(() => Promise.reject(new Error("x"))) : run(n, s)));
    finish.get(1)?.();
    await expect(result).rejects.toThrow("x");
    expect(done).toEqual([1]);
  });

  it("anulowanie z zewnatrz dociera do kazdego zadania", async () => {
    const { run, aborted } = controllable();
    const outer = new AbortController();
    const result = allOrNothing([1, 2], run, outer.signal);
    outer.abort();
    await expect(result).rejects.toThrow(/anulowano/);
    expect(aborted.sort()).toEqual([1, 2]);
  });
});

describe("abortReason", () => {
  it("bierze komunikat bledu", () => {
    expect(abortReason(new Error("Budzet wyczerpany"))).toBe("Budzet wyczerpany");
  });

  it("odrzucenie czyms, co nie jest Error, tez daje tekst", () => {
    expect(abortReason("siec")).toBe("siec");
  });

  it("anulowanie z zewnatrz ma pierwszenstwo przed bledem, ktory spowodowalo", () => {
    const controller = new AbortController();
    controller.abort();
    expect(abortReason(new Error("APIUserAbortError"), controller.signal)).toBe("Rozprawa anulowana");
    expect(abortReason(new Error("x"), new AbortController().signal)).toBe("x");
  });

  it("pusty komunikat nie wywraca zapisu przerwania", () => {
    expect(abortReason(new Error(""))).toBe("Nieznany blad");
    expect(abortReason(new Error("  "))).toBe("Nieznany blad");
  });

  it("przycina do limitu zdarzenia, a tekst na granicy zostawia", () => {
    expect(abortReason(new Error("x".repeat(MAX_REASON)))).toBe("x".repeat(MAX_REASON));
    expect(abortReason(new Error("x".repeat(MAX_REASON + 1)))).toBe(`${"x".repeat(MAX_REASON - 3)}...`);
  });
});

describe("sleep", () => {
  it("czeka i konczy sie bez wartosci", async () => {
    const started = Date.now();
    await expect(sleep(20)).resolves.toBeUndefined();
    expect(Date.now() - started).toBeGreaterThanOrEqual(15);
  });
});
