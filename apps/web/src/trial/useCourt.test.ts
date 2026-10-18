import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { fakeSources } from "../test/sources.js";
import { envelopes, fold, trial } from "../test/trials.js";
import { emptyCourt } from "./court.js";
import { type CourtSession, reduce, useCourt } from "./useCourt.js";

const list = envelopes(trial([7, 7, 7, 7, 7], []));
const start: CourtSession = { court: fold(list.slice(0, 2)), trouble: null };

describe("reduce", () => {
  it("wznawianie: komunikat, stan rozprawy bez zmian; otwarcie czysci komunikat", () => {
    const reconnecting = reduce(start, { type: "trouble", kind: "reconnecting", message: "wznawiam" });
    expect(reconnecting).toEqual({ court: start.court, trouble: "wznawiam" });
    expect(reduce(reconnecting, { type: "open" })).toEqual(start);
  });

  it.each(["lost", "bad-data"] as const)("%s: rozprawa przestaje byc sledzona", (kind) => {
    expect(reduce(start, { type: "trouble", kind, message: "x" })).toEqual({ court: { ...start.court, status: "lost" }, trouble: "x" });
  });

  it("zdarzenie sklada sie w stan i czysci komunikat; koniec bez werdyktu to przerwanie", () => {
    const next = reduce({ ...start, trouble: "wznawiam" }, { type: "envelope", envelope: list[2] as (typeof list)[number] });
    expect(next).toEqual({ court: fold(list.slice(0, 3)), trouble: null });
    expect(reduce(next, { type: "end", reason: "finished" }).court.status).toBe("interrupted");
  });
});

describe("useCourt", () => {
  it("otwiera strumien raz; nowy adres = nowy strumien, stary zamkniety; odmontowanie zamyka", () => {
    const sources = fakeSources();
    const { result, rerender, unmount } = renderHook(({ url }) => useCourt(url, sources.factory), { initialProps: { url: "/a" } });
    expect(result.current).toEqual({ court: emptyCourt, trouble: null });
    rerender({ url: "/a" });
    expect(sources.created.map((s) => s.url)).toEqual(["/a"]);
    rerender({ url: "/b" });
    expect(sources.created.map((s) => [s.url, s.closed])).toEqual([["/a", true], ["/b", false]]);
    unmount();
    expect(sources.last().closed).toBe(true);
  });

  it("zdarzenia strumienia przechodza przez hook: problem, wznowienie, zdarzenie, koniec", () => {
    const sources = fakeSources();
    const { result } = renderHook(() => useCourt("/a", sources.factory));
    act(() => {
      sources.last().emit("error");
    });
    expect(result.current.trouble).toBe("Połączenie zerwane, wznawiam…");
    act(() => {
      sources.last().emit("open");
    });
    expect(result.current.trouble).toBeNull();
    sources.send(...list.slice(0, 2));
    expect(result.current.court).toEqual(fold(list.slice(0, 2)));
    sources.end("interrupted");
    expect(result.current.court.status).toBe("interrupted");
  });
});
