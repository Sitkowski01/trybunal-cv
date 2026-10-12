import type { LlmClient } from "@trybunal/llm";
import { describe, expect, it } from "vitest";
import { newKey } from "./crypto.js";
import { TrialHub } from "./hub.js";
import { type EventEnvelope, Journal } from "./journal.js";
import { rehearsalLlm } from "./rehearsal.js";
import { CourtBusyError, InvalidTrialError, type ServiceOptions, TrialService } from "./service.js";
import { InMemoryEventStore } from "./store.js";

const request = { cvText: "Anna Nowak, anna@x.pl. Java, Spring.", jobOffer: "Junior Java, kontakt: hr@firma.pl", debateRounds: 1, candidateName: "Anna Nowak" };
const USD = 1e9;

/** Model, ktory nigdy nie odpowiada — rozprawa trwa, dopoki ktos jej nie anuluje. */
const hanging: LlmClient = {
  generate: (_req, signal) =>
    new Promise((_resolve, reject) => {
      signal?.addEventListener("abort", () => { reject(new Error("anulowano")); });
    }),
};

function setup(overrides: Partial<ServiceOptions> = {}) {
  const store = new InMemoryEventStore();
  const journal = new Journal(store, newKey());
  const hub = new TrialHub();
  const errors: unknown[] = [];
  let ids = 0;
  const service = new TrialService({
    journal,
    hub,
    llm: rehearsalLlm,
    trialBudgetNanoUsd: 1 * USD,
    dailyBudgetNanoUsd: 10 * USD,
    maxRunning: 3,
    newId: () => `t-${String(++ids)}`,
    onError: (e) => errors.push(e),
    ...overrides,
  });
  return { store, journal, hub, service, errors };
}

describe("TrialService — wniesienie i przebieg", () => {
  it("prowadzi rozprawe w tle; zdarzenia po kolei w dzienniku i u sluchaczy", async () => {
    const { journal, hub, service } = setup();
    const heard: EventEnvelope[] = [];
    hub.subscribe("t-1", (e) => heard.push(e));
    const filed = await service.file(request);
    expect(filed).toEqual({ trialId: "t-1", anonymized: { email: 1, name: 1 } });
    expect(service.isRunning("t-1")).toBe(true);
    await service.settled("t-1");
    expect(service.isRunning("t-1")).toBe(false);

    const stored = await journal.read("t-1");
    expect(stored.map((e) => e.seq)).toEqual(stored.map((_, i) => i + 1));
    expect(stored.at(-1)?.event.type).toBe("VerdictAnnounced");
    expect(heard).toEqual(stored);
    expect(stored[1]?.calls.map((c) => c.label)).toEqual(["assessment:hr"]);
  });

  it("do modelu i dziennika trafia CV i oferta bez danych osobowych", async () => {
    const { journal, service } = setup();
    await service.file(request);
    await service.settled("t-1");
    const [first] = await journal.read("t-1");
    expect(first?.event).toMatchObject({ cvText: "[KANDYDAT], [EMAIL]. Java, Spring.", jobOffer: "Junior Java, kontakt: [EMAIL]" });
  });

  it("bledne dane -> InvalidTrialError z lista problemow, bez rozprawy", async () => {
    const { service, store } = setup();
    const error = await service.file({ ...request, cvText: "  ", debateRounds: 9 }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(InvalidTrialError);
    expect((error as InvalidTrialError).problems).toHaveLength(2);
    expect((error as InvalidTrialError).problems[0]).toMatch(/^cvText: /);
    expect(await store.wrappedKey("t-1")).toBeUndefined();
  });

  it("budzet rozprawy przekroczony -> rozprawa konczy sie przerwaniem", async () => {
    const { journal, service } = setup({ trialBudgetNanoUsd: 1 });
    await service.file(request);
    await service.settled("t-1");
    const last = (await journal.read("t-1")).at(-1)?.event;
    expect(last).toMatchObject({ type: "TrialAborted", reason: expect.stringMatching(/^Budzet/) as unknown });
  });
});

describe("TrialService — limity", () => {
  it("najwyzej maxRunning rozpraw naraz, rowniez gdy wnoszone sa jednoczesnie", async () => {
    const { service } = setup({ llm: () => hanging, maxRunning: 2 });
    const results = await Promise.allSettled([service.file(request), service.file(request), service.file(request)]);
    expect(results.map((r) => r.status)).toEqual(["fulfilled", "fulfilled", "rejected"]);
    const rejected = results[2] as PromiseRejectedResult;
    expect(rejected.reason).toEqual(new CourtBusyError("Sad prowadzi juz 2 rozpraw — sprobuj za chwile", "concurrency"));
    service.cancel("t-1");
    await service.settled("t-1");
    await expect(service.file(request)).resolves.toMatchObject({ trialId: "t-4" });
    await service.close();
  });

  it("dzienny budzet: wydane dzis + pelny budzet trwajacych i nowej rozprawy", async () => {
    const { service } = setup({ llm: () => hanging, trialBudgetNanoUsd: 4 * USD, dailyBudgetNanoUsd: 10 * USD });
    await service.file(request);
    await service.file(request);
    const error = (await service.file(request).catch((e: unknown) => e)) as CourtBusyError;
    expect(error).toMatchObject({ reason: "dailyBudget", message: "Dzienny budzet sadu jest wyczerpany — wroc jutro" });
    await service.close();
  });

  it("liczy tylko wydatki od polnocy UTC", async () => {
    const { service, journal } = setup({ trialBudgetNanoUsd: 6 * USD, now: () => new Date("2026-10-12T23:59:00Z") });
    const since: Date[] = [];
    const spy = journal.spentSince.bind(journal);
    journal.spentSince = (d) => { since.push(d); return spy(d); };
    await service.file(request);
    await service.settled("t-1");
    expect(since).toEqual([new Date("2026-10-12T00:00:00Z")]);
  });

  it("odrzucone wniesienie zwalnia miejsce", async () => {
    const { service } = setup({ llm: () => hanging, maxRunning: 1, trialBudgetNanoUsd: 11 * USD });
    await expect(service.file(request)).rejects.toMatchObject({ reason: "dailyBudget" });
    await expect(service.file({ ...request, cvText: "" })).rejects.toBeInstanceOf(InvalidTrialError);
    expect(service.isRunning("t-1")).toBe(false);
  });
});

describe("TrialService — anulowanie, zapomnienie, awarie", () => {
  it("cancel konczy rozprawe zdarzeniem przerwania; nieznana rozprawa -> false", async () => {
    const { service, journal } = setup({ llm: () => hanging });
    await service.file(request);
    expect(service.cancel("t-1")).toBe(true);
    await service.settled("t-1");
    expect((await journal.read("t-1")).at(-1)?.event).toEqual({ type: "TrialAborted", reason: "Rozprawa anulowana" });
    expect(service.cancel("t-1")).toBe(false);
  });

  it("forget przerywa trwajaca rozprawe i usuwa klucz", async () => {
    const { service, journal } = setup({ llm: () => hanging });
    await service.file(request);
    expect(await service.forget("t-1")).toBe(true);
    expect(service.isRunning("t-1")).toBe(false);
    await expect(journal.read("t-1")).rejects.toThrow(/zapomniana/);
    expect(await service.forget("brak")).toBe(false);
  });

  it("awaria zapisu: rozprawa anulowana, blad zgloszony raz, dalsze zdarzenia nie ida do sluchaczy", async () => {
    const { service, journal, hub, errors } = setup();
    const append = journal.append.bind(journal);
    journal.append = (id, seq, event, calls) => (seq === 3 ? Promise.reject(new Error("baza padla")) : append(id, seq, event, calls));
    const heard: number[] = [];
    hub.subscribe("t-1", (e) => heard.push(e.seq));
    await service.file(request);
    await service.settled("t-1");
    expect(errors).toEqual([new Error("baza padla")]);
    expect(heard).toEqual([1, 2]);
    expect(service.isRunning("t-1")).toBe(false);
  });

  it("close anuluje wszystkie trwajace rozprawy i czeka na zapis przerwania", async () => {
    const { service, journal } = setup({ llm: () => hanging });
    await service.file(request);
    await service.file(request);
    await service.close();
    for (const id of ["t-1", "t-2"]) {
      expect((await journal.read(id)).at(-1)?.event.type).toBe("TrialAborted");
    }
  });
});
