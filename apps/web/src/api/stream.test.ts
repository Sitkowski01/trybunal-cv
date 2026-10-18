import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeSource } from "../test/fakeSource.js";
import { CLOSED, openTrialStream, RETRY_DELAYS_MS, type StreamHandlers } from "./stream.js";

const filed = { type: "TrialFiled", trialId: "t-1", debateRounds: 0, cvChars: 4, jobOfferChars: 4 };
const data = (seq: number, event: unknown = filed) => JSON.stringify({ seq, occurredAt: "2026-10-13T10:00:00Z", event, calls: [] });

function setup() {
  const handlers: StreamHandlers = { onOpen: vi.fn(), onEnvelope: vi.fn(), onEnd: vi.fn(), onTrouble: vi.fn() };
  let source: FakeSource | undefined;
  const close = openTrialStream("/api/trials/t-1/events", handlers, (url) => (source = new FakeSource(url)));
  if (source === undefined) throw new Error("brak zrodla");
  return { handlers, source, close };
}

describe("openTrialStream", () => {
  it("slucha wszystkich zdarzen rozprawy po nazwie oraz open, end i error", () => {
    const { source } = setup();
    expect(source.url).toBe("/api/trials/t-1/events");
    expect(source.types().sort()).toEqual(
      ["AssessmentSubmitted", "ProsecutionDelivered", "StatementMade", "TrialAborted", "TrialFiled", "VerdictAnnounced", "end", "error", "open"].sort(),
    );
  });

  it("przekazuje sprawdzone koperty i otwarcie polaczenia", () => {
    const { source, handlers } = setup();
    source.emit("open");
    source.emit("TrialFiled", data(1));
    expect(handlers.onOpen).toHaveBeenCalledOnce();
    expect(handlers.onEnvelope).toHaveBeenCalledWith({ seq: 1, occurredAt: "2026-10-13T10:00:00Z", event: filed, calls: [] });
  });

  it("zle dane: zamyka strumien i zglasza problem; kolejne zdarzenia ignoruje", () => {
    const { source, handlers } = setup();
    source.emit("TrialFiled", "{zle");
    source.emit("TrialFiled", data(1));
    source.emit("open");
    expect(source.closed).toBe(true);
    expect(handlers.onTrouble).toHaveBeenCalledExactlyOnceWith("bad-data", "Zdarzenie rozprawy nie jest poprawnym JSON-em");
    expect(handlers.onEnvelope).not.toHaveBeenCalled();
    expect(handlers.onOpen).not.toHaveBeenCalled();
  });

  it("blad w obsludze zdarzenia (nie w danych) leci dalej i nie zamyka strumienia", () => {
    const { source, handlers } = setup();
    vi.mocked(handlers.onEnvelope).mockImplementation(() => {
      throw new Error("blad Reacta");
    });
    expect(() => {
      source.emit("TrialFiled", data(1));
    }).toThrow("blad Reacta");
    expect(source.closed).toBe(false);
  });

  it.each<[string, "finished" | "interrupted"]>([
    ['{"reason":"finished"}', "finished"],
    ['{"reason":"interrupted"}', "interrupted"],
    ['{"reason":"cos"}', "interrupted"],
    ["nie json", "interrupted"],
  ])("end %s -> %s i zamkniecie", (payload, reason) => {
    const { source, handlers } = setup();
    source.emit("end", payload);
    source.emit("end", payload);
    expect(source.closed).toBe(true);
    expect(handlers.onEnd).toHaveBeenCalledExactlyOnceWith(reason);
  });

  it("error przy wznawianiu przez przegladarke: tylko informacja", () => {
    const { source, handlers } = setup();
    source.emit("error");
    expect(handlers.onTrouble).toHaveBeenLastCalledWith("reconnecting", "Połączenie zerwane, wznawiam…");
    expect(source.closed).toBe(false);
  });

  describe("strumien zamkniety przez przegladarke (np. 502 przy restarcie)", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    function many(url = "/api/trials/t-1/events") {
      const handlers: StreamHandlers = { onOpen: vi.fn(), onEnvelope: vi.fn(), onEnd: vi.fn(), onTrouble: vi.fn() };
      const sources: FakeSource[] = [];
      const close = openTrialStream(url, handlers, (u) => {
        const source = new FakeSource(u);
        sources.push(source);
        return source;
      });
      const last = () => sources.at(-1) as FakeSource;
      const fail = () => {
        last().readyState = CLOSED;
        last().emit("error");
      };
      return { handlers, sources, close, last, fail };
    }

    it("otwiera strumien ponownie po 1, 2, 4 s od ostatniego zdarzenia; potem utrata", () => {
      const { handlers, sources, last, fail } = many();
      last().emit("TrialFiled", data(1));
      last().emit("TrialFiled", data(2));
      fail();
      expect(handlers.onTrouble).toHaveBeenLastCalledWith("reconnecting", "Połączenie zerwane, wznawiam…");
      for (const delay of RETRY_DELAYS_MS) {
        vi.advanceTimersByTime(delay - 1);
        const count = sources.length;
        vi.advanceTimersByTime(1);
        expect(sources).toHaveLength(count + 1);
        expect(last().url).toBe("/api/trials/t-1/events?after=2");
        fail();
      }
      expect(handlers.onTrouble).toHaveBeenLastCalledWith("lost", expect.stringMatching(/^Nie można połączyć się z rozprawą/u));
      expect(last().closed).toBe(true);
      vi.advanceTimersByTime(60_000);
      expect(sources).toHaveLength(1 + RETRY_DELAYS_MS.length);
    });

    it("udane otwarcie zeruje licznik prob; zdarzenia ze starego zrodla sa ignorowane", () => {
      const { handlers, sources, fail, last } = many();
      fail();
      vi.advanceTimersByTime(1000);
      expect(last().url).toBe("/api/trials/t-1/events");
      last().emit("open");
      fail();
      vi.advanceTimersByTime(1000);
      expect(sources).toHaveLength(3);
      sources[0]?.emit("TrialFiled", data(1));
      expect(handlers.onEnvelope).not.toHaveBeenCalled();
      expect(handlers.onOpen).toHaveBeenCalledOnce();
    });

    it("adres z parametrem dostaje after przez &; zamkniecie odwoluje zaplanowana probe", () => {
      const { sources, close, last, fail } = many("/e?x=1");
      last().emit("TrialFiled", data(4));
      fail();
      vi.advanceTimersByTime(1000);
      expect(last().url).toBe("/e?x=1&after=4");
      fail();
      close();
      vi.advanceTimersByTime(60_000);
      expect(sources).toHaveLength(2);
      expect(last().closed).toBe(true);
    });
  });

  it("po zamknieciu przez nas nic juz nie dociera", () => {
    const { source, handlers, close } = setup();
    close();
    source.emit("open");
    source.emit("TrialFiled", data(1));
    source.emit("end", '{"reason":"finished"}');
    source.emit("error");
    expect(source.closed).toBe(true);
    for (const handler of Object.values(handlers)) expect(handler).not.toHaveBeenCalled();
  });
});
