import { DEFAULT_CONFIG } from "@trybunal/court";
import { FakeLlmClient, type LlmClient, LlmTransportError } from "@trybunal/llm";
import { describe, expect, it, vi } from "vitest";
import { newKey } from "./crypto.js";
import { TrialHub } from "./hub.js";
import { LocalBus } from "./bus.js";
import { type EventEnvelope, HEARTBEAT_MS, Journal } from "./journal.js";
import { rehearsalLlm, rehearsalScript } from "./rehearsal.js";
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
    bus: new LocalBus(hub),
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

  it("odpowiada dopiero, gdy wniesienie jest w dzienniku", async () => {
    const { journal, service } = setup({ llm: () => hanging });
    await service.file(request);
    expect((await journal.read("t-1")).map((e) => e.event.type)).toEqual(["TrialFiled"]);
    await service.close();
  });

  it("nieudany zapis wniesienia: blad wywolujacego, rozprawa anulowana", async () => {
    const { journal, service, errors } = setup({ llm: () => hanging });
    journal.append = () => Promise.reject(new Error("baza padla"));
    await expect(service.file(request)).rejects.toThrow("baza padla");
    await service.settled("t-1");
    expect(service.isRunning("t-1")).toBe(false);
    expect(errors).toEqual([new Error("baza padla")]);
  });

  it("uzywa konfiguracji sadu z opcji (modele, proby)", async () => {
    const config = { ...DEFAULT_CONFIG, models: { ...DEFAULT_CONFIG.models, justification: "claude-haiku-5-5" as const } };
    const llm = new FakeLlmClient(rehearsalScript);
    const { service } = setup({ llm: () => llm, config });
    await service.file(request);
    await service.settled("t-1");
    expect(llm.calls.at(-1)).toMatchObject({ label: "justification", model: "claude-haiku-5-5" });
  });

  it("za dlugie pola odrzucone przed anonimizacja, z limitem w komunikacie", async () => {
    const { service } = setup();
    const error = (await service
      .file({ cvText: "a".repeat(30_001), jobOffer: "b".repeat(10_001), debateRounds: 1, candidateName: "c".repeat(201) })
      .catch((e: unknown) => e)) as InvalidTrialError;
    expect(error.problems).toEqual(["cvText: najwyzej 30000 znakow", "jobOffer: najwyzej 10000 znakow", "candidateName: najwyzej 200 znakow"]);
  });

  it("dokladnie na limicie dlugosci przechodzi", async () => {
    const { service } = setup({ llm: () => hanging });
    await expect(service.file({ ...request, cvText: "a".repeat(30_000), jobOffer: "b".repeat(10_000), candidateName: "c".repeat(200) })).resolves.toBeDefined();
    await service.close();
  });

  it("wyjatek sluchacza strumienia nie przerywa rozprawy ani zapisu", async () => {
    const store = new InMemoryEventStore();
    const journal = new Journal(store, newKey());
    const hub = new TrialHub();
    hub.subscribe("t-1", () => { throw new Error("zerwany strumien"); });
    const service = new TrialService({ journal, bus: new LocalBus(hub), llm: rehearsalLlm, trialBudgetNanoUsd: USD, dailyBudgetNanoUsd: 10 * USD, maxRunning: 1, newId: () => "t-1" });
    await service.file(request);
    await service.settled("t-1");
    expect((await journal.read("t-1")).at(-1)?.event.type).toBe("VerdictAnnounced");
  });

  it("po zakonczeniu rozprawy sluchacze dostaja stop", async () => {
    const { service, hub } = setup();
    const stopped: string[] = [];
    hub.subscribe("t-1", () => undefined, () => stopped.push("stop"));
    await service.file(request);
    await service.settled("t-1");
    expect(stopped).toEqual(["stop"]);
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
    await service.cancel("t-1");
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

  it("rezerwacja dokladnie rowna budzetowi dnia jeszcze przechodzi", async () => {
    const { service } = setup({ llm: () => hanging, trialBudgetNanoUsd: 5 * USD, dailyBudgetNanoUsd: 10 * USD });
    await service.file(request);
    await expect(service.file(request)).resolves.toMatchObject({ trialId: "t-2" });
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

  it("zapytanie bez odpowiedzi, ktore moglo kosztowac, liczy sie do budzetu dnia rezerwacja", async () => {
    const lost: LlmClient = { generate: () => Promise.reject(new LlmTransportError("Zapytanie przerwane", false, true)) };
    const { service, journal } = setup({ llm: () => lost });
    await service.file(request);
    await service.settled("t-1");
    const calls = (await journal.read("t-1")).flatMap((e) => e.calls);
    expect(calls).toMatchObject([{ outcome: "transport", costKnown: false }]);
    expect(calls[0]?.costNanoUsd).toBeGreaterThan(0);
    expect(await journal.spentSince(new Date(0))).toBe(calls[0]?.costNanoUsd);
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
    expect(await service.cancel("t-1")).toBe(true);
    await service.settled("t-1");
    expect((await journal.read("t-1")).at(-1)?.event).toEqual({ type: "TrialAborted", reason: "Rozprawa anulowana" });
    expect(await service.cancel("t-1")).toBe(false);
    expect(await service.cancel("brak")).toBe(false);
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
    // Licznik wszystkiego, za co model "wystawil rachunek" — porownamy z tym, co trafilo do dziennika.
    let paid = 0;
    const counting = (): LlmClient => {
      const inner = rehearsalLlm();
      return { generate: (req, signal) => inner.generate(req, signal).then((r) => { paid += r.costNanoUsd; return r; }) };
    };
    const { service, journal, hub, errors } = setup({ llm: counting });
    const append = journal.append.bind(journal);
    let stored = 0;
    journal.append = (id, seq, event, calls) => {
      if (seq === 3) return Promise.reject(new Error("baza padla"));
      stored += calls.reduce((sum, c) => sum + c.costNanoUsd, 0);
      return append(id, seq, event, calls);
    };
    const heard: number[] = [];
    hub.subscribe("t-1", (e) => heard.push(e.seq));
    await service.file(request);
    await service.settled("t-1");
    expect(errors[0]).toEqual(new Error("baza padla"));
    // Koszt zdarzen po awarii nie trafil do dziennika ani budzetu dnia — przynajmniej jest w logach.
    // Zdarzenie, ktorego zapis padl, i wszystkie pominiete pozniej: razem z zapisanymi = caly rachunek.
    expect(errors[1]).toEqual(new Error(`Niezapisany koszt rozprawy po awarii zapisu: ${String(paid - stored)} nano-USD`));
    expect(paid - stored).toBeGreaterThan(0);
    expect(errors).toHaveLength(2);
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
    await expect(service.file(request)).rejects.toEqual(new CourtBusyError("Serwer jest zamykany — sprobuj za chwile", "closing"));
  });
});

/** Magistrala z zapisem — widac, co instancja wyslala innym (prosby o anulowanie, koniec). */
function recordingBus(hub: TrialHub) {
  const local = new LocalBus(hub);
  const sent: string[] = [];
  let cancel: (trialId: string) => void = () => undefined;
  const bus = {
    published: (e: EventEnvelope) => { local.published(e); },
    stopped: (trialId: string) => { sent.push(`stop:${trialId}`); local.stopped(trialId); },
    cancelRequested: (trialId: string) => { sent.push(`cancel:${trialId}`); },
    onCancel: (handler: (trialId: string) => void) => { cancel = handler; },
  };
  return { bus, sent, deliverCancel: (trialId: string) => { cancel(trialId); } };
}

describe("TrialService — kilka instancji", () => {
  it("rozprawa innej instancji (trwa wg dziennika): cancel i forget wysylaja prosbe przez magistrale", async () => {
    const hub = new TrialHub();
    const { bus, sent } = recordingBus(hub);
    const { journal, service } = setup({ bus });
    await journal.create("obca");
    expect(await service.isActive("obca")).toBe(true);
    expect(service.isRunning("obca")).toBe(false);
    expect(await service.cancel("obca")).toBe(true);
    expect(await service.forget("obca")).toBe(true);
    expect(sent).toEqual(["cancel:obca", "cancel:obca"]);
    // Zapomniana i zakonczona — nie trwa, nikt nie dostaje prosby.
    await journal.markEnded("obca");
    expect(await service.cancel("obca")).toBe(false);
    expect(await service.forget("obca")).toBe(true);
    expect(sent).toHaveLength(2);
  });

  it("prosba o anulowanie z magistrali przerywa rozprawe tej instancji; obca rozprawa ignorowana", async () => {
    const hub = new TrialHub();
    const { bus, deliverCancel } = recordingBus(hub);
    const { journal, service } = setup({ bus, llm: () => hanging });
    await service.file(request);
    deliverCancel("inna");
    deliverCancel("t-1");
    await service.settled("t-1");
    expect((await journal.read("t-1")).at(-1)?.event).toEqual({ type: "TrialAborted", reason: "Rozprawa anulowana" });
  });

  it("koniec rozprawy: zapis w dzienniku, potem sygnal koniec dla strumieni", async () => {
    const hub = new TrialHub();
    const { bus, sent } = recordingBus(hub);
    const { journal, service } = setup({ bus });
    await service.file(request);
    expect(await journal.isActive("t-1")).toBe(true);
    await service.settled("t-1");
    expect(await journal.isActive("t-1")).toBe(false);
    expect(sent).toEqual(["stop:t-1"]);
  });

  it("nieudany zapis konca rozprawy trafia do bledow, a sygnal konca i tak wychodzi", async () => {
    const hub = new TrialHub();
    const { bus, sent } = recordingBus(hub);
    const { journal, service, errors } = setup({ bus });
    journal.markEnded = () => Promise.reject(new Error("baza padla"));
    await service.file(request);
    await service.settled("t-1");
    expect(errors).toContainEqual(new Error("baza padla"));
    expect(sent).toEqual(["stop:t-1"]);
  });
});

describe("TrialService — puls", () => {
  it("co HEARTBEAT_MS potwierdza trwajace rozprawy; bez rozpraw i po zamknieciu milczy", async () => {
    vi.useFakeTimers();
    try {
      const labels: string[] = [];
      const { journal, service } = setup({ llm: () => hanging, onError: (error, trialId) => labels.push(`${trialId}: ${(error as Error).message}`) });
      const touched: string[][] = [];
      journal.touch = (ids) => {
        touched.push([...ids]);
        return ids.includes("t-2") ? Promise.reject(new Error("puls padl")) : Promise.resolve();
      };
      await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);
      expect(touched).toEqual([]);
      await service.file(request);
      await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);
      expect(touched).toEqual([["t-1"]]);
      await service.file(request);
      await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);
      expect(touched.at(-1)).toEqual(["t-1", "t-2"]);
      expect(labels).toContain("puls: puls padl");
      await service.close();
      const count = touched.length;
      await vi.advanceTimersByTimeAsync(HEARTBEAT_MS * 3);
      expect(touched).toHaveLength(count);
    } finally {
      vi.useRealTimers();
    }
  });
});
