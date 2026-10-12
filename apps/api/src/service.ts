import { randomUUID } from "node:crypto";
import { type CourtConfig, runTrial } from "@trybunal/court";
import { TrialEventSchema } from "@trybunal/domain";
import { BudgetedLlmClient, type LlmClient } from "@trybunal/llm";
import type { TrialHub } from "./hub.js";
import type { Journal } from "./journal.js";
import { type Anonymized, anonymize } from "./pii.js";

export interface FileRequest {
  readonly cvText: string;
  readonly jobOffer: string;
  readonly debateRounds: number;
  /** Imie i nazwisko kandydata do usuniecia z CV — nie da sie go pewnie wykryc w tekscie. */
  readonly candidateName?: string;
}

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

/** Sad nie przyjmie teraz sprawy: za duzo rozpraw naraz albo wyczerpany budzet dnia (429/503). */
export class CourtBusyError extends Error {
  override readonly name = "CourtBusyError";
  constructor(
    message: string,
    readonly reason: "concurrency" | "dailyBudget",
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

  constructor(private readonly options: ServiceOptions) {}

  async file(request: FileRequest): Promise<Filed> {
    const cv = anonymize(request.cvText, request.candidateName);
    // Oferta tez bywa z kontaktem do rekrutera — model go nie potrzebuje.
    const offer = anonymize(request.jobOffer);
    const trialId = (this.options.newId ?? randomUUID)();
    const input = { trialId, cvText: cv.text, jobOffer: offer.text, debateRounds: request.debateRounds };
    const parsed = TrialEventSchema.safeParse({ type: "TrialFiled", ...input });
    if (!parsed.success) {
      throw new InvalidTrialError(parsed.error.issues.map((i) => `${i.path.map(String).join(".")}: ${i.message}`));
    }
    this.reserveSlot();
    try {
      await this.checkDailyBudget();
      await this.options.journal.create(trialId);
      this.start(input);
    } finally {
      this.filing--;
    }
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

  private start(input: { trialId: string; cvText: string; jobOffer: string; debateRounds: number }): void {
    const { journal, hub, onError } = this.options;
    const controller = new AbortController();
    let seq = 0;
    let writes = Promise.resolve();
    let failed = false;
    const done = runTrial(input, {
      llm: new BudgetedLlmClient(this.options.llm(), this.options.trialBudgetNanoUsd),
      signal: controller.signal,
      ...(this.options.config === undefined ? {} : { config: this.options.config }),
      // Zapisy po kolei, w kolejnosci zdarzen. Gdy zapis padnie, rozprawa jest anulowana —
      // dalsze zdarzenia nie maja juz sensu, bo dziennik ma dziure.
      onEvent: (event, _state, calls) => {
        const next = ++seq;
        writes = writes.then(async () => {
          if (failed) return;
          try {
            hub.publish(await journal.append(input.trialId, next, event, calls));
          } catch (error) {
            failed = true;
            controller.abort();
            onError?.(error, input.trialId);
          }
        });
      },
      onObserverError: (error) => onError?.(error, input.trialId),
    })
      .then(() => writes)
      .catch((error: unknown) => onError?.(error, input.trialId))
      .finally(() => this.running.delete(input.trialId));
    this.running.set(input.trialId, { controller, done });
  }
}
