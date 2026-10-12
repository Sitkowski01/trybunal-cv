import { randomUUID } from "node:crypto";
import { type CourtConfig, runTrial } from "@trybunal/court";
import { MAX_CV_CHARS, MAX_JOB_OFFER_CHARS, TrialEventSchema } from "@trybunal/domain";
import { BudgetedLlmClient, type LlmClient } from "@trybunal/llm";
import type { TrialHub } from "./hub.js";
import type { Journal } from "./journal.js";
import { type Anonymized, anonymize } from "./pii.js";
import { describeIssues } from "./issues.js";

export interface FileRequest {
  readonly cvText: string;
  readonly jobOffer: string;
  readonly debateRounds: number;
  /** Imie i nazwisko kandydata do usuniecia z CV — nie da sie go pewnie wykryc w tekscie. */
  readonly candidateName?: string;
}

export const MAX_NAME_CHARS = 200;

export interface Filed {
  readonly trialId: string;
  readonly anonymized: Anonymized["found"];
}

/** Bledne dane wniesienia: lista problemow dla klienta (400). */
export class InvalidTrialError extends Error {
  override readonly name = "InvalidTrialError";
  constructor(readonly problems: readonly string[]) {
    super(`Niepoprawne dane rozprawy: ${problems.join("; ")}`);
  }
}

/** Sad nie przyjmie teraz sprawy: za duzo rozpraw naraz (429), wyczerpany budzet dnia albo zamykanie serwera (503). */
export class CourtBusyError extends Error {
  override readonly name = "CourtBusyError";
  constructor(
    message: string,
    readonly reason: "concurrency" | "dailyBudget" | "closing",
  ) {
    super(message);
  }
}

export interface ServiceOptions {
  readonly journal: Journal;
  readonly hub: TrialHub;
  /** Zrodlo modelu dla nowej rozprawy (Claude, nagranie albo proba generalna). */
  readonly llm: () => LlmClient;
  readonly trialBudgetNanoUsd: number;
  readonly dailyBudgetNanoUsd: number;
  readonly maxRunning: number;
  readonly config?: CourtConfig;
  readonly now?: () => Date;
  readonly newId?: () => string;
  /** Bledy w tle (np. zapis do bazy padl w trakcie rozprawy) — do logow. */
  readonly onError?: (error: unknown, trialId: string) => void;
}

interface Running {
  readonly controller: AbortController;
  readonly done: Promise<void>;
}

const startOfUtcDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

/**
 * Rozprawy w tle: wniesienie odpowiada od razu (202), a zdarzenia ida do dziennika po kolei
 * i dopiero potem do sluchaczy SSE. Zamkniecie polaczenia przez klienta NIE anuluje rozprawy —
 * jest oplacona i zapisana, klient moze wrocic (Last-Event-ID). Anuluje jawne cancel() albo forget().
 */
export class TrialService {
  private readonly running = new Map<string, Running>();
  /** Wniesienia miedzy sprawdzeniem limitow a startem — zajmuja miejsce, zeby dwa naraz nie przeszly obok limitu. */
  private filing = 0;
  private closing = false;

  constructor(private readonly options: ServiceOptions) {}

  async file(request: FileRequest): Promise<Filed> {
    if (this.closing) {
      throw new CourtBusyError("Serwer jest zamykany — sprobuj za chwile", "closing");
    }
    // Dlugosc przed anonimizacja: wyrazenia regularne na megabajtowym tekscie to zablokowany serwer.
    const tooLong = [
      ["cvText", request.cvText, MAX_CV_CHARS],
      ["jobOffer", request.jobOffer, MAX_JOB_OFFER_CHARS],
      ["candidateName", request.candidateName ?? "", MAX_NAME_CHARS],
    ] as const;
    const problems = tooLong.filter(([, text, max]) => text.length > max).map(([field, , max]) => `${field}: najwyzej ${String(max)} znakow`);
    if (problems.length > 0) {
      throw new InvalidTrialError(problems);
    }
    const cv = anonymize(request.cvText, request.candidateName);
    // Oferta tez bywa z kontaktem do rekrutera — model go nie potrzebuje.
    const offer = anonymize(request.jobOffer);
    const trialId = (this.options.newId ?? randomUUID)();
    const input = { trialId, cvText: cv.text, jobOffer: offer.text, debateRounds: request.debateRounds };
    const parsed = TrialEventSchema.safeParse({ type: "TrialFiled", ...input });
    if (!parsed.success) {
      throw new InvalidTrialError(describeIssues(parsed.error.issues));
    }
    this.reserveSlot();
    let filed: Promise<void>;
    try {
      await this.checkDailyBudget();
      await this.options.journal.create(trialId);
      filed = this.start(input);
    } finally {
      this.filing--;
    }
    // Odpowiedz dopiero, gdy wniesienie jest w dzienniku: GET zaraz po 202 widzi juz rozprawe.
    await filed;
    return { trialId, anonymized: cv.found };
  }

  isRunning(trialId: string): boolean {
    return this.running.has(trialId);
  }

  /** Obietnica konca rozprawy (zapisane wszystkie zdarzenia); od razu, gdy nie trwa. */
  settled(trialId: string): Promise<void> {
    return this.running.get(trialId)?.done ?? Promise.resolve();
  }

  /** Anuluje rozprawe; konczy sie ona zdarzeniem TrialAborted. false, gdy nie trwa. */
  cancel(trialId: string): boolean {
    const run = this.running.get(trialId);
    run?.controller.abort();
    return run !== undefined;
  }

  /** RODO: przerywa rozprawe, jesli trwa, i usuwa jej klucz. false, gdy rozprawy nie ma. */
  async forget(trialId: string): Promise<boolean> {
    const run = this.running.get(trialId);
    if (run !== undefined) {
      run.controller.abort();
      await run.done;
    }
    return this.options.journal.forget(trialId);
  }

  /** Zamkniecie serwera: anuluje trwajace rozprawy i czeka, az zapisza przerwanie. */
  async close(): Promise<void> {
    this.closing = true;
    const all = [...this.running.values()];
    all.forEach((r) => { r.controller.abort(); });
    await Promise.all(all.map((r) => r.done));
  }

  private reserveSlot(): void {
    const { maxRunning } = this.options;
    if (this.running.size + this.filing >= maxRunning) {
      throw new CourtBusyError(`Sad prowadzi juz ${String(maxRunning)} rozpraw — sprobuj za chwile`, "concurrency");
    }
    this.filing++;
  }

  private async checkDailyBudget(): Promise<void> {
    const { trialBudgetNanoUsd, dailyBudgetNanoUsd } = this.options;
    // Trwajace i wnoszone rozprawy rezerwuja pelny budzet: dzien nie przekroczy limitu nawet w najgorszym razie.
    const now = (this.options.now ?? (() => new Date()))();
    const spent = await this.options.journal.spentSince(startOfUtcDay(now));
    if (spent + (this.running.size + this.filing) * trialBudgetNanoUsd > dailyBudgetNanoUsd) {
      throw new CourtBusyError("Dzienny budzet sadu jest wyczerpany — wroc jutro", "dailyBudget");
    }
  }

  /** Uruchamia rozprawe w tle; zwraca obietnice zapisu wniesienia (TrialFiled). */
  private start(input: { trialId: string; cvText: string; jobOffer: string; debateRounds: number }): Promise<void> {
    const { journal, hub, onError } = this.options;
    const controller = new AbortController();
    let seq = 0;
    let writes = Promise.resolve();
    let failure: { readonly error: unknown } | undefined;
    // Koszt zdarzen, ktorych nie zapisano po awarii — nie trafi do budzetu dnia, wiec przynajmniej do logow.
    let lostNanoUsd = 0;
    const done = runTrial(input, {
      llm: new BudgetedLlmClient(this.options.llm(), this.options.trialBudgetNanoUsd),
      signal: controller.signal,
      ...(this.options.config === undefined ? {} : { config: this.options.config }),
      // Zapisy po kolei, w kolejnosci zdarzen. Gdy zapis padnie, rozprawa jest anulowana —
      // dalsze zdarzenia nie maja juz sensu, bo dziennik ma dziure.
      onEvent: (event, _state, calls) => {
        const next = ++seq;
        writes = writes.then(async () => {
          if (failure !== undefined) {
            lostNanoUsd += calls.reduce((sum, c) => sum + c.costNanoUsd, 0);
            return;
          }
          let envelope;
          try {
            envelope = await journal.append(input.trialId, next, event, calls);
          } catch (error) {
            failure = { error };
            lostNanoUsd += calls.reduce((sum, c) => sum + c.costNanoUsd, 0);
            controller.abort();
            onError?.(error, input.trialId);
            return;
          }
          // Poza try: blad sluchacza (zerwany strumien) to nie awaria zapisu i nie przerywa rozprawy.
          hub.publish(envelope);
        });
      },
    })
      .then(() => writes)
      // Stryker disable next-line all: runTrial nie odrzuca przy poprawnym wejsciu (sprawdzone w file) — to tylko ochrona procesu.
      .catch(/* v8 ignore next */ (error: unknown) => onError?.(error, input.trialId))
      .finally(() => {
        this.running.delete(input.trialId);
        if (lostNanoUsd > 0) onError?.(new Error(`Niezapisany koszt rozprawy po awarii zapisu: ${String(lostNanoUsd)} nano-USD`), input.trialId);
        // Strumienie czekajace na koniec dostaja go nawet wtedy, gdy werdyktu ani przerwania nie udalo sie zapisac.
        hub.stop(input.trialId);
      });
    this.running.set(input.trialId, { controller, done });
    // runTrial zglasza wniesienie synchronicznie, przed pierwszym await — jego zapis jest juz w kolejce.
    return writes.then(() => {
      if (failure !== undefined) throw failure.error;
    });
  }
}
