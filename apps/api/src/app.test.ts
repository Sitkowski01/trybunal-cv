import type { LlmClient } from "@trybunal/llm";
import type { FastifyInstance } from "fastify";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp, MAX_PDF_BYTES, redactIds } from "./app.js";
import { newKey } from "./crypto.js";
import { TrialHub } from "./hub.js";
import { Journal } from "./journal.js";
import { rehearsalLlm } from "./rehearsal.js";
import { type ServiceOptions, TrialService } from "./service.js";
import { InMemoryEventStore } from "./store.js";

const body = { cvText: "Anna Nowak. Java, Spring.", jobOffer: "Junior Java", debateRounds: 1, candidateName: "Anna Nowak" };
const hanging: LlmClient = {
  generate: (_req, signal) => new Promise((_res, reject) => signal?.addEventListener("abort", () => { reject(new Error("anulowano")); })),
};

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function setup(overrides: Partial<ServiceOptions> = {}, rateLimitMax = 100, logs?: string[]) {
  const journal = new Journal(new InMemoryEventStore(), newKey());
  const hub = new TrialHub();
  let ids = 0;
  const service = new TrialService({
    journal, hub, llm: rehearsalLlm, trialBudgetNanoUsd: 1e9, dailyBudgetNanoUsd: 1e10, maxRunning: 3, newId: () => `t-${String(++ids)}`, ...overrides,
  });
  const logStream = logs === undefined ? undefined : { write: (line: string) => { logs.push(line); } };
  app = await buildApp({ service, journal, hub, rateLimit: { max: rateLimitMax, timeWindowMs: 60_000 }, heartbeatMs: 20, ...(logStream === undefined ? {} : { logStream }) });
  return { app, service, journal, hub };
}

/** Formularz multipart z plikiem PDF albo dowolnymi bajtami w polu "cv". */
function multipart(fields: Record<string, string>, file?: { name: string; bytes: Uint8Array }) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  if (file !== undefined) form.append(file.name, new Blob([new Uint8Array(file.bytes)], { type: "application/pdf" }), "cv.pdf");
  const request = new Request("http://x", { method: "POST", body: form });
  return request.arrayBuffer().then((payload) => ({ payload: Buffer.from(payload), headers: { "content-type": request.headers.get("content-type") ?? "" } }));
}

async function pdf(text: string) {
  const doc = await PDFDocument.create();
  doc.addPage().drawText(text, { x: 20, y: 700, size: 12, font: await doc.embedFont(StandardFonts.Helvetica) });
  return doc.save();
}

describe("POST /trials", () => {
  it("JSON: 202 z id, adresem strumienia i licznikiem anonimizacji", async () => {
    const { app, service } = await setup();
    const res = await app.inject({ method: "POST", url: "/trials", payload: body });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ trialId: "t-1", anonymized: { name: 1 }, eventsUrl: "/trials/t-1/events" });
    await service.settled("t-1");
  });

  it("formularz z PDF: CV z pliku, liczba rund z pola tekstowego", async () => {
    const { app, service, journal } = await setup();
    const form = await multipart({ jobOffer: "Junior Java", debateRounds: "0" }, { name: "cv", bytes: await pdf("Java, Spring, Kafka") });
    const res = await app.inject({ method: "POST", url: "/trials", ...form });
    expect(res.statusCode).toBe(202);
    await service.settled("t-1");
    expect((await journal.read("t-1"))[0]?.event).toMatchObject({ cvText: "Java, Spring, Kafka", debateRounds: 0 });
  });

  it("formularz z CV jako tekstem tez dziala", async () => {
    const { app, service } = await setup();
    const res = await app.inject({ method: "POST", url: "/trials", ...(await multipart({ cvText: "Java", jobOffer: "Java" })) });
    expect(res.statusCode).toBe(202);
    await service.settled("t-1");
  });

  it.each([
    [{ ...body, debateRounds: 7 }, "debateRounds"],
    [{ jobOffer: "x" }, "cvText"],
    [{ ...body, cvText: " " }, "cvText"],
  ])("bledne dane -> 400 z problemami (%#)", async (payload, field) => {
    const { app } = await setup();
    const res = await app.inject({ method: "POST", url: "/trials", payload });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ problems: string[] }>().problems[0]).toMatch(new RegExp(`^${field}: `));
  });

  it("plik, ktory nie jest PDF-em -> 422; plik w innym polu -> 400", async () => {
    const { app } = await setup();
    const notPdf = await multipart({ jobOffer: "x" }, { name: "cv", bytes: new TextEncoder().encode("hej") });
    expect((await app.inject({ method: "POST", url: "/trials", ...notPdf })).json()).toEqual({ error: "Plik nie jest PDF-em" });
    const wrong = await multipart({ jobOffer: "x" }, { name: "zdjecie", bytes: await pdf("x") });
    const res = await app.inject({ method: "POST", url: "/trials", ...wrong });
    expect(res.statusCode).toBe(400);
  });

  it("PDF ponad limit rozmiaru -> 413", async () => {
    const { app } = await setup();
    const big = await multipart({ jobOffer: "x" }, { name: "cv", bytes: new Uint8Array(MAX_PDF_BYTES + 1) });
    expect((await app.inject({ method: "POST", url: "/trials", ...big })).statusCode).toBe(413);
  });

  it("za duzo rozpraw naraz -> 429 z Retry-After; dzienny budzet -> 503", async () => {
    const busy = await setup({ llm: () => hanging, maxRunning: 1 });
    await busy.app.inject({ method: "POST", url: "/trials", payload: body });
    const res = await busy.app.inject({ method: "POST", url: "/trials", payload: body });
    expect([res.statusCode, res.headers["retry-after"]]).toEqual([429, "30"]);
    await busy.service.close();
    await busy.app.close();

    const broke = await setup({ trialBudgetNanoUsd: 2e10 });
    expect((await broke.app.inject({ method: "POST", url: "/trials", payload: body })).statusCode).toBe(503);
  });

  it("limit wniesien z jednego IP -> 429", async () => {
    const { app, service } = await setup({}, 1);
    expect((await app.inject({ method: "POST", url: "/trials", payload: body })).statusCode).toBe(202);
    expect((await app.inject({ method: "POST", url: "/trials", payload: body })).statusCode).toBe(429);
    await service.settled("t-1");
  });
});

describe("GET /trials/:id, anulowanie, zapomnienie", () => {
  it("stan rozprawy bez tekstu CV i oferty", async () => {
    const { app, service } = await setup();
    await app.inject({ method: "POST", url: "/trials", payload: body });
    await service.settled("t-1");
    const state = (await app.inject({ url: "/trials/t-1" })).json<Record<string, unknown>>();
    expect(state).toMatchObject({ trialId: "t-1", phase: "closed", running: false, verdict: { decision: "invite" } });
    expect(state.lastSeq).toBe(13);
    expect(state).not.toHaveProperty("cvText");
    expect(state).not.toHaveProperty("jobOffer");
    // Cytaty krytykow to fragmenty CV (tak jak u prawdziwego modelu), ale oferta nie wraca wcale.
    expect(JSON.stringify(state)).not.toContain(body.jobOffer);
    expect(JSON.stringify(state)).not.toContain("Anna Nowak");
  });

  it("nieznana rozprawa -> 404 na kazdym adresie", async () => {
    const { app } = await setup();
    for (const [method, url] of [["GET", "/trials/x"], ["GET", "/trials/x/events"], ["POST", "/trials/x/cancel"], ["DELETE", "/trials/x"]] as const) {
      expect((await app.inject({ method, url })).statusCode).toBe(404);
    }
  });

  it("cancel trwajacej -> 202, zakonczonej -> 409", async () => {
    const { app, service } = await setup({ llm: () => hanging });
    await app.inject({ method: "POST", url: "/trials", payload: body });
    const cancelled = await app.inject({ method: "POST", url: "/trials/t-1/cancel" });
    expect([cancelled.statusCode, cancelled.json()]).toEqual([202, { cancelled: true }]);
    await service.settled("t-1");
    const again = await app.inject({ method: "POST", url: "/trials/t-1/cancel" });
    expect([again.statusCode, again.json()]).toEqual([409, { error: "Rozprawa juz sie zakonczyla" }]);
  });

  it("DELETE zapomina rozprawe: 204, potem 410 przy odczycie", async () => {
    const { app } = await setup({ llm: () => hanging });
    await app.inject({ method: "POST", url: "/trials", payload: body });
    expect((await app.inject({ method: "DELETE", url: "/trials/t-1" })).statusCode).toBe(204);
    const res = await app.inject({ url: "/trials/t-1/events" });
    expect(res.statusCode).toBe(410);
  });

  it("nieoczekiwany blad -> 500 bez szczegolow", async () => {
    const { app, journal } = await setup();
    journal.read = () => Promise.reject(new Error("tajne szczegoly bazy"));
    const res = await app.inject({ url: "/trials/t-1" });
    expect([res.statusCode, res.json()]).toEqual([500, { error: "Blad serwera" }]);
  });

  it("numer wznowienia ponad zakres kolumny integer -> 400, nie blad bazy", async () => {
    const { app } = await setup();
    expect((await app.inject({ url: "/trials/t-1/events?after=2147483648" })).statusCode).toBe(400);
  });

  it("cancel zapomnianej rozprawy -> 410", async () => {
    const { app, service } = await setup();
    await app.inject({ method: "POST", url: "/trials", payload: body });
    await service.settled("t-1");
    await app.inject({ method: "DELETE", url: "/trials/t-1" });
    expect((await app.inject({ method: "POST", url: "/trials/t-1/cancel" })).statusCode).toBe(410);
  });

  it("rozprawa bez zapisanego wniesienia -> 404, a nie 500", async () => {
    const { app, journal } = await setup();
    await journal.create("t-9");
    const res = await app.inject({ url: "/trials/t-9" });
    expect([res.statusCode, res.json()]).toEqual([404, { error: "Rozprawa t-9 nie ma zapisanych zdarzen" }]);
  });

  it("CV jako plik i jako tekst naraz -> 400, w dowolnej kolejnosci pol", async () => {
    const { app } = await setup();
    const fileFirst = await multipart({ jobOffer: "x" }, { name: "cv", bytes: await pdf("Java") });
    const form = new FormData();
    form.append("cv", new Blob([new Uint8Array(await pdf("Java"))], { type: "application/pdf" }), "cv.pdf");
    form.append("cvText", "Java");
    form.append("jobOffer", "x");
    const request = new Request("http://x", { method: "POST", body: form });
    const textAfter = { payload: Buffer.from(await request.arrayBuffer()), headers: { "content-type": request.headers.get("content-type") ?? "" } };
    const textBefore = await multipart({ cvText: "Java", jobOffer: "x" }, { name: "cv", bytes: await pdf("Java") });
    for (const form of [textBefore, textAfter]) {
      const res = await app.inject({ method: "POST", url: "/trials", ...form });
      expect([res.statusCode, res.json<{ problems: string[] }>().problems]).toEqual([400, ["cv: CV jako plik albo tekst, nie oba naraz"]]);
    }
    expect((await app.inject({ method: "POST", url: "/trials", ...fileFirst })).statusCode).toBe(202);
  });

  it("zamykany serwer -> 503 dla nowych wniesien", async () => {
    const { app, service } = await setup();
    await service.close();
    expect((await app.inject({ method: "POST", url: "/trials", payload: body })).statusCode).toBe(503);
  });

  it("id rozprawy wyciete z adresow w logach", () => {
    expect(redactIds("/trials/3c62-ab/events?after=2")).toBe("/trials/:id/events?after=2");
    expect(redactIds("/trials/abc")).toBe("/trials/:id");
    expect(redactIds("/trials")).toBe("/trials");
  });

  it("za proxy limit liczony per adres klienta z X-Forwarded-For", async () => {
    const journal = new Journal(new InMemoryEventStore(), newKey());
    const hub = new TrialHub();
    const service = new TrialService({ journal, hub, llm: rehearsalLlm, trialBudgetNanoUsd: 1e9, dailyBudgetNanoUsd: 1e10, maxRunning: 3 });
    app = await buildApp({ service, journal, hub, rateLimit: { max: 1, timeWindowMs: 60_000 }, trustProxy: true });
    const post = (ip: string) => app?.inject({ method: "POST", url: "/trials", payload: body, headers: { "x-forwarded-for": ip } });
    expect((await post("10.0.0.1"))?.statusCode).toBe(202);
    expect((await post("10.0.0.2"))?.statusCode).toBe(202);
    expect((await post("10.0.0.1"))?.statusCode).toBe(429);
    await service.close();
  });

  it("GET /health", async () => {
    const { app } = await setup();
    expect((await app.inject({ url: "/health" })).json()).toEqual({ ok: true });
  });
});

describe("odpowiedzi bledow — tresc", () => {
  it.each([
    ["GET", "/trials/x", 404, { error: "Nie ma rozprawy x" }],
    ["DELETE", "/trials/x", 404, { error: "Nie ma rozprawy x" }],
    ["GET", "/trials/x/events?after=-1", 400, { error: "Niepoprawne dane", problems: ["(calosc): Too small: expected number to be >=0"] }],
  ] as const)("%s %s -> %i z trescia", async (method, url, status, json) => {
    const { app } = await setup();
    const res = await app.inject({ method, url });
    expect([res.statusCode, res.json()]).toEqual([status, json]);
  });

  it("zapomniana -> 410 z komunikatem; zajety sad -> 429 i 503 z komunikatem", async () => {
    const { app } = await setup({ llm: () => hanging, maxRunning: 1 });
    await app.inject({ method: "POST", url: "/trials", payload: body });
    const busy = await app.inject({ method: "POST", url: "/trials", payload: body });
    expect(busy.json()).toEqual({ error: "Sad prowadzi juz 1 rozpraw — sprobuj za chwile" });
    await app.inject({ method: "DELETE", url: "/trials/t-1" });
    expect((await app.inject({ url: "/trials/t-1" })).json()).toEqual({ error: "Rozprawa t-1 zostala zapomniana na zadanie kandydata" });
    const broke = await setup({ trialBudgetNanoUsd: 2e10 });
    expect((await broke.app.inject({ method: "POST", url: "/trials", payload: body })).json()).toEqual({ error: "Dzienny budzet sadu jest wyczerpany — wroc jutro" });
  });

  it("plik w zlym polu -> 400 z nazwa pola", async () => {
    const { app } = await setup();
    const wrong = await multipart({ jobOffer: "x" }, { name: "zdjecie", bytes: await pdf("x") });
    expect((await app.inject({ method: "POST", url: "/trials", ...wrong })).json()).toEqual({
      error: "Niepoprawne dane",
      problems: ['zdjecie: nieoczekiwany plik, CV wysylamy w polu "cv"'],
    });
  });

  it("blad Fastify 4xx przechodzi z wlasnym kodem i komunikatem (zly JSON -> 400)", async () => {
    const { app } = await setup();
    const res = await app.inject({ method: "POST", url: "/trials", payload: "{zly", headers: { "content-type": "application/json" } });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string }>().error).toMatch(/JSON/u);
  });

  it.each([302, 500, 503])("blad z kodem %i spoza 4xx -> 500 bez szczegolow, zalogowany", async (statusCode) => {
    const logs: string[] = [];
    const { app, journal } = await setup({}, 100, logs);
    journal.read = () => Promise.reject(Object.assign(new Error("tajne szczegoly"), { statusCode }));
    const res = await app.inject({ url: "/trials/t-1" });
    expect([res.statusCode, res.json()]).toEqual([500, { error: "Blad serwera" }]);
    expect(logs.some((l) => l.includes("tajne szczegoly") && l.includes('"level":50'))).toBe(true);
  });
});

describe("limity i logi", () => {
  it("PDF do 2 MB przechodzi (domyslny limit wtyczki to 1 MB)", async () => {
    const { app, service } = await setup();
    const bytes = await pdf("Java");
    const padded = new Uint8Array(1_500_000);
    padded.set(bytes);
    padded.fill(32, bytes.length);
    const res = await app.inject({ method: "POST", url: "/trials", ...(await multipart({ jobOffer: "x" }, { name: "cv", bytes: padded })) });
    expect(res.statusCode).toBe(202);
    await service.settled("t-1");
  });

  it("drugi plik albo ponad 10 pol -> 413", async () => {
    const { app } = await setup();
    const form = new FormData();
    form.append("cv", new Blob([new Uint8Array(await pdf("a"))]), "a.pdf");
    form.append("cv", new Blob([new Uint8Array(await pdf("b"))]), "b.pdf");
    const request = new Request("http://x", { method: "POST", body: form });
    const twoFiles = { payload: Buffer.from(await request.arrayBuffer()), headers: { "content-type": request.headers.get("content-type") ?? "" } };
    expect((await app.inject({ method: "POST", url: "/trials", ...twoFiles })).statusCode).toBe(413);
    const fields = Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`pole${String(i)}`, "x"]));
    expect((await app.inject({ method: "POST", url: "/trials", ...(await multipart(fields)) })).statusCode).toBe(413);
  });

  it("lekki limit na wszystkich trasach: 121. zapytanie w minucie -> 429", async () => {
    const { app } = await setup();
    for (let i = 0; i < 120; i++) await app.inject({ url: "/health" });
    expect((await app.inject({ url: "/health" })).statusCode).toBe(429);
  });

  it("bez trustProxy limit liczy sie per polaczenie, X-Forwarded-For nic nie zmienia", async () => {
    const { app, service } = await setup({}, 1);
    const post = (ip: string) => app.inject({ method: "POST", url: "/trials", payload: body, headers: { "x-forwarded-for": ip } });
    expect((await post("10.0.0.1")).statusCode).toBe(202);
    expect((await post("10.0.0.2")).statusCode).toBe(429);
    await service.settled("t-1");
  });

  it("logi maja adresy bez id rozprawy, a strumien SSE nie konczy sie bledem odpowiedzi", async () => {
    const logs: string[] = [];
    const { app, service } = await setup({}, 100, logs);
    await app.inject({ method: "POST", url: "/trials", payload: body });
    await service.settled("t-1");
    await app.inject({ url: "/trials/t-1/events" });
    const all = logs.join("");
    expect(all).toContain('"url":"/trials/:id/events"');
    expect(all).not.toContain("t-1");
    expect(logs.filter((l) => /"level":(40|50)/u.test(l))).toEqual([]);
  });
});
