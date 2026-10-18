import { describe, expect, it, vi } from "vitest";
import { FakeSource } from "../test/fakeSource.js";
import { CLOSED, openTrialStream, type StreamHandlers } from "./stream.js";

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

  it("error przy wznawianiu: tylko informacja; error po zamknieciu przez przegladarke: utrata", () => {
    const { source, handlers } = setup();
    source.emit("error");
    expect(handlers.onTrouble).toHaveBeenLastCalledWith("reconnecting", "Połączenie zerwane, wznawiam…");
    expect(source.closed).toBe(false);
    source.readyState = CLOSED;
    source.emit("error");
    expect(handlers.onTrouble).toHaveBeenLastCalledWith("lost", expect.stringMatching(/^Nie można połączyć się z rozprawą/u));
    expect(source.closed).toBe(true);
    source.emit("error");
    expect(handlers.onTrouble).toHaveBeenCalledTimes(2);
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
