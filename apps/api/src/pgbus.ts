import type pg from "pg";
import { z } from "zod";
import type { TrialBus } from "./bus.js";
import type { TrialHub } from "./hub.js";
import type { EventEnvelope, Journal } from "./journal.js";

/** Kanal NOTIFY wspolny dla wszystkich instancji API jednej bazy. */
export const CHANNEL = "trybunal_trials";

/**
 * Komunikat w kanale: sam numer zdarzenia, bez tresci — tresc jest zaszyfrowana w dzienniku,
 * a NOTIFY ma limit 8 KB i trafia do logow bazy. Odbiorca doczytuje zdarzenie z dziennika.
 */
const NoticeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("event"), trialId: z.string().min(1), seq: z.number().int().min(1) }),
  z.object({ kind: z.literal("stop"), trialId: z.string().min(1) }),
  z.object({ kind: z.literal("cancel"), trialId: z.string().min(1) }),
]);
type Notice = z.infer<typeof NoticeSchema>;

export interface PostgresBusOptions {
  readonly pool: pg.Pool;
  readonly journal: Journal;
  /** Strumienie SSE tej instancji. */
  readonly hub: TrialHub;
  /** Bledy w tle (zerwane polaczenie, zly komunikat) — do logow; magistrala dziala dalej. */
  readonly onError?: (error: unknown) => void;
}

/**
 * Kilka instancji API na jednej bazie: kazda instancja wysyla NOTIFY i slucha LISTEN na tym samym
 * kanale — rowniez wlasnych komunikatow, wiec do strumieni SSE zdarzenie trafia zawsze ta sama droga.
 * Wysylanie i odbior ida po kolei (lancuch obietnic): strumien SSE pomija zdarzenia o numerze nie
 * wiekszym niz ostatni wyslany, wiec zamiana kolejnosci zgubilaby zdarzenie.
 */
export class PostgresBus implements TrialBus {
  private sending: Promise<void> = Promise.resolve();
  private receiving: Promise<void> = Promise.resolve();
  private cancel: (trialId: string) => void = () => undefined;
  private listener: pg.PoolClient | null = null;

  constructor(private readonly options: PostgresBusOptions) {}

  /** Osobne polaczenie na LISTEN — z puli wracaloby do innych zapytan i gubilo powiadomienia. */
  async start(): Promise<void> {
    const client = await this.options.pool.connect();
    client.on("notification", (message) => {
      this.receiving = this.receiving.then(() => this.receive(message.payload)).catch((error: unknown) => this.options.onError?.(error));
    });
    await client.query(`LISTEN ${CHANNEL}`);
    this.listener = client;
  }

  async close(): Promise<void> {
    const client = this.listener;
    this.listener = null;
    if (client === null) return;
    await client.query(`UNLISTEN ${CHANNEL}`);
    client.release();
    await this.sending;
  }

  published(envelope: EventEnvelope): void {
    this.send({ kind: "event", trialId: envelope.trialId, seq: envelope.seq });
  }

  stopped(trialId: string): void {
    this.send({ kind: "stop", trialId });
  }

  cancelRequested(trialId: string): void {
    this.send({ kind: "cancel", trialId });
  }

  onCancel(handler: (trialId: string) => void): void {
    this.cancel = handler;
  }

  private send(notice: Notice): void {
    this.sending = this.sending
      .then(async () => {
        await this.options.pool.query("SELECT pg_notify($1, $2)", [CHANNEL, JSON.stringify(notice)]);
      })
      .catch((error: unknown) => this.options.onError?.(error));
  }

  private async receive(payload: string | undefined): Promise<void> {
    const notice = NoticeSchema.parse(JSON.parse(payload ?? ""));
    const { hub, journal } = this.options;
    switch (notice.kind) {
      case "event": {
        // Nikt na tej instancji nie slucha tej rozprawy — nie ma po co odszyfrowywac.
        if (hub.listenerCount(notice.trialId) === 0) return;
        for (const envelope of await journal.read(notice.trialId, notice.seq - 1)) {
          if (envelope.seq === notice.seq) hub.publish(envelope);
        }
        return;
      }
      case "stop":
        hub.stop(notice.trialId);
        return;
      case "cancel":
        this.cancel(notice.trialId);
        return;
    }
  }
}
