import { act } from "@testing-library/react";
import type { Envelope } from "../trial/envelope.js";
import { FakeSource } from "./fakeSource.js";

/** Fabryka zrodel dla komponentow; zapamietuje ostatnie zrodlo, zeby test mogl nim sterowac. */
export function fakeSources() {
  const created: FakeSource[] = [];
  const factory = (url: string) => {
    const source = new FakeSource(url);
    created.push(source);
    return source;
  };
  const last = () => {
    const source = created.at(-1);
    if (source === undefined) throw new Error("Zadne zrodlo nie zostalo otwarte");
    return source;
  };
  /** Wysyla koperty jak serwer (w act, zeby React zdazyl przerysowac). */
  const send = (...list: readonly Envelope[]) => {
    act(() => {
      for (const e of list) last().emit(e.event.type, JSON.stringify(e));
    });
  };
  const end = (reason: "finished" | "interrupted") => {
    act(() => {
      last().emit("end", JSON.stringify({ reason }));
    });
  };
  return { factory, created, last, send, end };
}
