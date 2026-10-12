import type { LlmClient } from "@trybunal/llm";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { newKey } from "./crypto.js";
import { TrialHub } from "./hub.js";
import { type EventEnvelope, Journal } from "./journal.js";
import { rehearsalLlm } from "./rehearsal.js";
import { type ServiceOptions, TrialService } from "./service.js";
import { formatEnd, formatEvent, openStream } from "./sse.js";
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

async function setup(overrides: Partial<ServiceOptions> = {}) {
  const journal = new Journal(new InMemoryEventStore(), newKey());
  const hub = new TrialHub();
  const service = new TrialService({
    journal, hub, llm: rehearsalLlm, trialBudgetNanoUsd: 1e9, dailyBudgetNanoUsd: 1e10, maxRunning: 3, newId: () => "t-1", ...overrides,
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
    expect(res.headers["content-type"]).toBe("text/event-stream; charset=utf-8");
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
    const { app, journal } = await setup();
    await journal.create("t-1");
    await journal.append("t-1", 1, { type: "TrialFiled", trialId: "t-1", ...body }, []);
    expect(frames((await app.inject({ url: "/trials/t-1/events" })).body)).toEqual([1, formatEnd("interrupted").trim()]);
  });

  it("na zywo: zapisane, potem nowe zdarzenia, puls w ciszy, koniec po przerwaniu", async () => {
    const { app, service, hub } = await setup({ llm: () => hanging });
    const address = await app.listen({ port: 0, host: "127.0.0.1" });
    await app.inject({ method: "POST", url: "/trials", payload: body });
    const stream = readUntil(`${address}/trials/t-1/events`, (t) => t.includes("event: end"));
    await expect.poll(() => hub.listenerCount("t-1")).toBe(1);
    await new Promise((r) => setTimeout(r, 50));
    service.cancel("t-1");
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
    const write = await openStream("t", 1, { journal, hub, isRunning: () => true, heartbeatMs: 1000 });
    const written: string[] = [];
    const response = { writeHead: () => response, write: (c: string) => written.push(c), end: (c: string) => written.push(c) };
    const request = { on: () => request };
    write(request as never, response as never);
    hub.publish(env(4));
    hub.publish(env(5, true));
    hub.publish(env(6));
    expect(frames(written.join(""))).toEqual([2, 3, 4, 5, formatEnd("finished").trim()]);
    expect(hub.listenerCount("t")).toBe(0);
  });

  it("blad odczytu: wyjatek dla obslugi HTTP i bez wiszacej subskrypcji", async () => {
    const hub = new TrialHub();
    const journal = { read: () => Promise.reject(new Error("404")) } as unknown as Journal;
    await expect(openStream("t", 0, { journal, hub, isRunning: () => true, heartbeatMs: 1000 })).rejects.toThrow("404");
    expect(hub.listenerCount("t")).toBe(0);
  });
});
