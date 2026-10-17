import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RETENTION_EVERY_MS, startRetention } from "./retention.js";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("startRetention", () => {
  it("sprzata od razu i potem co godzine, z liczba dni z konfiguracji; zatrzymanie konczy cykl", async () => {
    const expire = vi.fn(() => Promise.resolve(2));
    const expired: number[] = [];
    const stop = startRetention({ expire, days: 30, onExpired: (n) => expired.push(n) });
    await vi.advanceTimersByTimeAsync(0);
    expect(expire).toHaveBeenCalledTimes(1);
    expect(expire).toHaveBeenCalledWith(30);
    await vi.advanceTimersByTimeAsync(RETENTION_EVERY_MS - 1);
    expect(expire).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(expire).toHaveBeenCalledTimes(2);
    expect(expired).toEqual([2, 2]);
    stop();
    await vi.advanceTimersByTimeAsync(RETENTION_EVERY_MS * 3);
    expect(expire).toHaveBeenCalledTimes(2);
  });

  it("nic do usuniecia: bez zgloszenia; blad jednego przebiegu nie zatrzymuje kolejnych", async () => {
    // Wyniki tworzone dopiero przy wywolaniu: odrzucona obietnica z gory bylaby nieobsluzona.
    const results = [() => Promise.resolve(0), () => Promise.reject(new Error("baza")), () => Promise.resolve(1)];
    const expire = vi.fn(() => (results.shift() ?? (() => Promise.resolve(0)))());
    const expired: number[] = [];
    const errors: unknown[] = [];
    const stop = startRetention({ expire, days: 7, everyMs: 1000, onExpired: (n) => expired.push(n), onError: (e) => errors.push(e) });
    await vi.advanceTimersByTimeAsync(2000);
    expect(expire).toHaveBeenCalledTimes(3);
    expect(expired).toEqual([1]);
    expect(errors).toEqual([new Error("baza")]);
    stop();
  });

  it("bez sluchaczy wynikow i bledow tez dziala", async () => {
    const stop = startRetention({ expire: () => Promise.reject(new Error("x")), days: 1 });
    await vi.advanceTimersByTimeAsync(0);
    stop();
  });
});
