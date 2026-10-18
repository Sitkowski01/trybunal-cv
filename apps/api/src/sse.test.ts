import type { LlmClient } from "@trybunal/llm";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "./app.js";
import { newKey } from "./crypto.js";
import { TrialHub } from "./hub.js";
import { LocalBus } from "./bus.js";
import { ALIVE_MS, type EventEnvelope, Journal } from "./journal.js";
import { rehearsalLlm } from "./rehearsal.js";
import { type ServiceOptions, TrialService } from "./service.js";
import { formatEnd, formatEvent, openStream, publicEvent } from "./sse.js";
import { InMemoryEventStore } from "./store.js";

const body = { cvText: "Java, Spring.", jobOffer: "Junior Java", debateRounds: 1 };
const hanging: LlmClient = {
  generate: (_req, signal) => new Promise((_res, reject) => signal?.addEventListener("abort", () => { reject(new Error("anulowano")); })),
};

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function setup(overrides: Partial<ServiceOptions> = {}, now?: () => Date) {
  const journal = new Journal(new InMemoryEventStore(), newKey(), now);
  const hub = new TrialHub();
  const service = new TrialService({
    journal, bus: new LocalBus(hub), llm: rehearsalLlm, trialBudgetNanoUsd: 1e9, dailyBudgetNanoUsd: 1e10, maxRunning: 3, newId: () => "t-1", ...overrides,
  });
  app = await buildApp({ service, journal, hub, rateLimit: { max: 100, timeWindowMs: 60_000 }, heartbeatMs: 20 });
  return { app, service, journal, hub };
}

/** Numery zdarzen i zdarzenia "end" w kolejnosci, z surowego strumienia SSE. */
const frames = (text: string) =>
  text.split("\n\n").filter((f) => f.startsWith("id: ") || f.startsWith("event: end")).map((f) => (f.startsWith("id: ") ? Number(f.slice(4, f.indexOf("\n"))) : f));

/** Czyta strumien z prawdziwego gniazda, az pojawi sie oczekiwany fragment. */
async function readUntil(url: string, until: (text: string) => boolean, headers: Record<string, string> = {}) {
  const controller = new AbortController();
  const res = await fetch(url, { headers, signal: controller.signal });
  if (res.body === null) throw new Error("brak strumienia");
  const reader = (res.body as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  let text = "";
  while (!until(text)) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  return { res, text, close: () => { controller.abort(); } };
}

describe("formatowanie SSE", () => {
  it("id = numer zdarzenia, typ jako nazwa zdarzenia, koperta w jednej linii danych", () => {
    const envelope: EventEnvelope = {
      trialId: "t", seq: 7, occurredAt: "2026-10-12T10:00:00.000Z", schemaVersion: 1, event: { type: "ProsecutionDelivered", speech: "a\nb" }, calls: [],
    };
    expect(formatEvent(envelope)).toBe(`id: 7\nevent: ProsecutionDelivered\ndata: ${JSON.stringify(envelope)}\n\n`);
    expect(formatEvent(envelope).split("\n")).toHaveLength(5);
    expect(formatEnd("interrupted")).toBe('event: end\ndata: {"reason":"interrupted"}\n\n');
  });
});

describe("GET /trials/:id/events", () => {
  it("zakonczona rozprawa: wszystkie zdarzenia i jawny koniec", async () => {
    const { app, service } = await setup();
    await app.inject({ method: "POST", url: "/trials", payload: body });
    await service.settled("t-1");
    const res = await app.inject({ url: "/trials/t-1/events" });
    expect(res.headers).toMatchObject({
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    expect(frames(res.body)).toEqual([...Array.from({ length: 13 }, (_, i) => i + 1), formatEnd("finished").trim()]);
  });

  it("wznowienie od Last-Event-ID (naglowek ma pierwszenstwo przed ?after=)", async () => {
    const { app, service } = await setup();
    await app.inject({ method: "POST", url: "/trials", payload: body });
    await service.settled("t-1");
    expect(frames((await app.inject({ url: "/trials/t-1/events?after=11" })).body)).toEqual([12, 13, formatEnd("finished").trim()]);
    const res = await app.inject({ url: "/trials/t-1/events?after=1", headers: { "last-event-id": "12" } });
    expect(frames(res.body)).toEqual([13, formatEnd("finished").trim()]);
  });

  it("bledny numer wznowienia -> 400", async () => {
    const { app } = await setup();
    for (const after of ["-1", "x", "1.5"]) {
      expect((await app.inject({ url: `/trials/t-1/events?after=${after}` })).statusCode).toBe(400);
    }
  });

  it("rozprawa bez konca, ktora nie trwa (restart serwera): zapisane zdarzenia i koniec 'interrupted'", async () => {
    // Zalozona przez proces sprzed restartu: bez pulsu dluzej niz ALIVE_MS.
    let offset = -ALIVE_MS - 1000;
    const { app, journal } = await setup({}, () => new Date(Date.now() + offset));
    await journal.create("t-1");
    await journal.append("t-1", 1, { type: "TrialFiled", trialId: "t-1", ...body }, []);
    offset = 0;
    expect(frames((await app.inject({ url: "/trials/t-1/events" })).body)).toEqual([1, formatEnd("interrupted").trim()]);
  });

  it("na zywo: zapisane, potem nowe zdarzenia, puls w ciszy, koniec po przerwaniu", async () => {
    const { app, service, hub } = await setup({ llm: () => hanging });
    const address = await app.listen({ port: 0, host: "127.0.0.1" });
    await app.inject({ method: "POST", url: "/trials", payload: body });
    const stream = readUntil(`${address}/trials/t-1/events`, (t) => t.includes("event: end"));
    await expect.poll(() => hub.listenerCount("t-1")).toBe(1);
    await new Promise((r) => setTimeout(r, 50));
    await service.cancel("t-1");
    const { text } = await stream;
    expect(frames(text)).toEqual([1, 2, formatEnd("finished").trim()]);
    expect(text).toContain(": ping\n\n");
    expect(text).toContain("event: TrialAborted");
    expect(hub.listenerCount("t-1")).toBe(0);
  });

  it("rozlaczenie klienta sprzata subskrypcje, ale nie anuluje rozprawy", async () => {
    const { app, service, hub } = await setup({ llm: () => hanging });
    const address = await app.listen({ port: 0, host: "127.0.0.1" });
    await app.inject({ method: "POST", url: "/trials", payload: body });
    const { close } = await readUntil(`${address}/trials/t-1/events`, (t) => t.includes("id: 1"));
    close();
    await expect.poll(() => hub.listenerCount("t-1")).toBe(0);
    expect(service.isRunning("t-1")).toBe(true);
    await service.close();
  });
});

describe("openStream — szczelina miedzy odczytem a subskrypcja", () => {
  const env = (seq: number, terminal = false): EventEnvelope => ({
    trialId: "t", seq, occurredAt: "2026-10-12T10:00:00.000Z", schemaVersion: 1,
    event: terminal ? { type: "TrialAborted", reason: "x" } : { type: "StatementMade", round: 1, criticId: "hr", statement: "x", revisedScore: null },
    calls: [],
  });

  it("koniec rozprawy miedzy sprawdzeniem 'trwa' a podlaczeniem klienta nie ginie — strumien sie konczy", async () => {
    const hub = new TrialHub();
    const journal = { read: () => Promise.resolve([env(1)]) } as unknown as Journal;
    // Sprawdzenie widzi trwajaca rozprawe; zaraz potem (np. w innej instancji) rozprawa sie konczy.
    const write = await openStream("t", 0, {
      journal,
      hub,
      isRunning: () => {
        queueMicrotask(() => {
          hub.stop("t");
        });
        return Promise.resolve(true);
      },
      heartbeatMs: 1000,
    });
    await Promise.resolve();
    const written: string[] = [];
    const response = { destroyed: false, on: () => response, writeHead: () => response, write: (c: string) => written.push(c), end: (c: string) => written.push(c) };
    write({ destroyed: false } as never, response as never);
    expect(frames(written.join(""))).toEqual([1, formatEnd("interrupted").trim()]);
    expect(hub.listenerCount("t")).toBe(0);
  });

  it("zdarzenia z czasu odczytu nie gina i nie dubluja sie; bufor przed zywymi", async () => {
    const hub = new TrialHub();
    // Odczyt z bazy trwa, a w tym czasie rozprawa zapisuje 3 i 4 (3 zdazylo jeszcze trafic do odczytu).
    const journal = {
      read: () => {
        hub.publish(env(3));
        hub.publish(env(4));
        return Promise.resolve([env(2), env(3)]);
      },
    } as unknown as Journal;
    const write = await openStream("t", 1, { journal, hub, isRunning: () => Promise.resolve(true), heartbeatMs: 1000 });
    const written: string[] = [];
    const response = { destroyed: false, on: () => response, writeHead: () => response, write: (c: string) => written.push(c), end: (c: string) => written.push(c) };
    const request = { destroyed: false };
    write(request as never, response as never);
    // 4 przyszlo tylko w czasie odczytu (bufor) — musi wyjsc z bufora, na zywo juz nie przyjdzie.
    hub.publish(env(5, true));
    hub.publish(env(6));
    expect(frames(written.join(""))).toEqual([2, 3, 4, 5, formatEnd("finished").trim()]);
    expect(hub.listenerCount("t")).toBe(0);
  });

  it("blad odczytu: wyjatek dla obslugi HTTP i bez wiszacej subskrypcji", async () => {
    const hub = new TrialHub();
    const journal = { read: () => Promise.reject(new Error("404")) } as unknown as Journal;
    await expect(openStream("t", 0, { journal, hub, isRunning: () => Promise.resolve(true), heartbeatMs: 1000 })).rejects.toThrow("404");
    expect(hub.listenerCount("t")).toBe(0);
  });
});

describe("strumien — prywatnosc i koniec bez werdyktu", () => {
  it("wniesienie idzie bez tekstu CV i oferty, tylko z dlugosciami", () => {
    const filed: EventEnvelope = {
      trialId: "t", seq: 1, occurredAt: "2026-10-12T10:00:00.000Z", schemaVersion: 1,
      event: { type: "TrialFiled", trialId: "t", cvText: "Java, Spring", jobOffer: "Junior", debateRounds: 1 }, calls: [],
    };
    expect(publicEvent(filed).event).toEqual({ type: "TrialFiled", trialId: "t", debateRounds: 1, cvChars: 12, jobOfferChars: 6 });
    expect(formatEvent(filed)).not.toContain("Spring");
    const other: EventEnvelope = { ...filed, seq: 2, event: { type: "TrialAborted", reason: "x" } };
    expect(publicEvent(other)).toBe(other);
  });

  it("rozprawa staje bez zapisanego konca -> strumien konczy sie 'interrupted', a nie wisi", async () => {
    const hub = new TrialHub();
    const journal = { read: () => Promise.resolve([]) } as unknown as Journal;
    const write = await openStream("t", 0, { journal, hub, isRunning: () => Promise.resolve(true), heartbeatMs: 1000 });
    const written: string[] = [];
    const response = { destroyed: false, on: () => response, writeHead: () => response, write: (c: string) => written.push(c), end: (c: string) => written.push(c) };
    write({ destroyed: false } as never, response as never);
    hub.stop("t");
    expect(written.join("")).toBe(formatEnd("interrupted"));
    expect(hub.listenerCount("t")).toBe(0);
  });

  it("klient odszedl w trakcie odczytu z bazy: nic nie wysylamy i sprzatamy subskrypcje", async () => {
    const hub = new TrialHub();
    const journal = { read: () => Promise.resolve([]) } as unknown as Journal;
    const write = await openStream("t", 0, { journal, hub, isRunning: () => Promise.resolve(true), heartbeatMs: 1000 });
    const response = { destroyed: false, writeHead: () => { throw new Error("nie powinno pisac"); } };
    write({ destroyed: true } as never, response as never);
    expect(hub.listenerCount("t")).toBe(0);
  });
});

describe("strumien — puls", () => {
  it("puls w ciszy, a po koncu strumienia juz nic nie jest pisane", async () => {
    vi.useFakeTimers();
    try {
      const hub = new TrialHub();
      const journal = { read: () => Promise.resolve([]) } as unknown as Journal;
      const write = await openStream("t", 0, { journal, hub, isRunning: () => Promise.resolve(true), heartbeatMs: 100 });
      const written: string[] = [];
      const response = { destroyed: false, on: () => response, writeHead: () => response, write: (c: string) => written.push(c), end: (c: string) => written.push(c) };
      write({ destroyed: false } as never, response as never);
      await vi.advanceTimersByTimeAsync(250);
      expect(written).toEqual([": ping\n\n", ": ping\n\n"]);
      hub.stop("t");
      await vi.advanceTimersByTimeAsync(1000);
      expect(written).toEqual([": ping\n\n", ": ping\n\n", formatEnd("interrupted")]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("strumien — zgubione powiadomienia i padnieta instancja", () => {
  const env = (seq: number, terminal = false): EventEnvelope => ({
    trialId: "t", seq, occurredAt: "2026-10-12T10:00:00.000Z", schemaVersion: 1,
    event: terminal ? { type: "VerdictAnnounced", verdict: { decision: "invite", juryAverage: 7, atsScore: 7, spread: 1, ambiguous: false } } : { type: "StatementMade", round: 1, criticId: "hr", statement: "x", revisedScore: null },
    calls: [],
  } as EventEnvelope);
  const fakeResponse = () => {
    const written: string[] = [];
    const ends: (string | undefined)[] = [];
    const response = { destroyed: false, on: () => response, writeHead: () => response, write: (c: string) => written.push(c), end: (c?: string) => { ends.push(c); if (c !== undefined) written.push(c); } };
    return { response, written, ends };
  };
  const flush = () => new Promise((r) => setTimeout(r, 0));

  it("najpierw 'czy trwa', potem odczyt — werdykt zapisany w miedzyczasie nie konczy strumienia jako 'interrupted'", async () => {
    const order: string[] = [];
    const journal = { read: () => { order.push("read"); return Promise.resolve([env(1)]); } } as unknown as Journal;
    await openStream("t", 0, { journal, hub: new TrialHub(), isRunning: () => { order.push("isRunning"); return Promise.resolve(true); }, heartbeatMs: 1000 });
    expect(order).toEqual(["isRunning", "read"]);
  });

  it("dziura w numerach na zywo: brakujace doczytane z dziennika, po kolei i bez duplikatow", async () => {
    const hub = new TrialHub();
    const reads: number[] = [];
    const journal = {
      read: (_t: string, after: number) => {
        reads.push(after);
        return Promise.resolve(after === 0 ? [env(1)] : [env(2), env(3), env(4)]);
      },
    } as unknown as Journal;
    const write = await openStream("t", 0, { journal, hub, isRunning: () => Promise.resolve(true), heartbeatMs: 1000 });
    const { response, written } = fakeResponse();
    write({ destroyed: false } as never, response as never);
    hub.publish(env(4)); // 2 i 3 zgubione
    hub.publish(env(5)); // przychodzi w trakcie doczytywania — musi poczekac
    await flush();
    hub.publish(env(6, true));
    expect(reads).toEqual([0, 1]);
    expect(frames(written.join(""))).toEqual([1, 2, 3, 4, 5, 6, formatEnd("finished").trim()]);
    expect(hub.listenerCount("t")).toBe(0);
  });

  it("koniec rozprawy w trakcie doczytywania czeka na nie — doczytany werdykt wygrywa z interrupted", async () => {
    const hub = new TrialHub();
    const journal = { read: (_t: string, after: number) => Promise.resolve(after === 0 ? [env(1)] : [env(2), env(3, true)]) } as unknown as Journal;
    const write = await openStream("t", 0, { journal, hub, isRunning: () => Promise.resolve(true), heartbeatMs: 1000 });
    const { response, written } = fakeResponse();
    write({ destroyed: false } as never, response as never);
    hub.publish(env(3, true));
    hub.stop("t");
    await flush();
    expect(frames(written.join(""))).toEqual([1, 2, 3, formatEnd("finished").trim()]);
  });

  it("instancja prowadzaca padla: przy pulsie strumien widzi, ze rozprawa nie trwa, i konczy sie", async () => {
    vi.useFakeTimers();
    try {
      let running = true;
      const journal = { read: () => Promise.resolve([]) } as unknown as Journal;
      const write = await openStream("t", 0, { journal, hub: new TrialHub(), isRunning: () => Promise.resolve(running), heartbeatMs: 100 });
      const { response, written } = fakeResponse();
      write({ destroyed: false } as never, response as never);
      await vi.advanceTimersByTimeAsync(150);
      expect(written).toEqual([": ping\n\n"]);
      running = false;
      await vi.advanceTimersByTimeAsync(100);
      expect(written).toEqual([": ping\n\n", ": ping\n\n", formatEnd("interrupted")]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("rozprawa skonczyla sie, a powiadomienie o werdykcie zginelo: puls doczytuje werdykt", async () => {
    vi.useFakeTimers();
    try {
      let ended = false;
      const journal = { read: () => Promise.resolve(ended ? [env(1, true)] : []) } as unknown as Journal;
      const write = await openStream("t", 0, { journal, hub: new TrialHub(), isRunning: () => Promise.resolve(!ended), heartbeatMs: 100 });
      const { response, written } = fakeResponse();
      write({ destroyed: false } as never, response as never);
      ended = true;
      await vi.advanceTimersByTimeAsync(100);
      expect(frames(written.join(""))).toEqual([1, formatEnd("finished").trim()]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("blad bazy przy doczytywaniu: polaczenie zamkniete bez 'end', zeby przegladarka wznowila", async () => {
    const hub = new TrialHub();
    const journal = { read: (_t: string, after: number) => (after === 0 ? Promise.resolve([env(1)]) : Promise.reject(new Error("baza"))) } as unknown as Journal;
    const write = await openStream("t", 0, { journal, hub, isRunning: () => Promise.resolve(true), heartbeatMs: 1000 });
    const { response, written, ends } = fakeResponse();
    write({ destroyed: false } as never, response as never);
    hub.publish(env(3));
    await flush();
    expect(frames(written.join(""))).toEqual([1]);
    expect(ends).toEqual([undefined]);
    expect(hub.listenerCount("t")).toBe(0);
  });
});
