import { type Envelope, parseEnvelope } from "../trial/envelope.js";
import { parseSse } from "./sse.js";

/**
 * Nagranie rozprawy do demo bez serwera: zapisany strumien SSE jednej zakonczonej rozprawy.
 * Sprawdzane przy wczytaniu tym samym schematem co strumien na zywo, wiec zepsute albo
 * niepelne nagranie wychodzi od razu (test w CI), a nie w polowie odtwarzania.
 */
export interface RecordedEvent {
  readonly envelope: Envelope;
  /** Tresc pola data dokladnie tak, jak przyszla z serwera — odtwarzanie wysyla ja bez zmian. */
  readonly data: string;
}

export interface Recording {
  readonly events: readonly RecordedEvent[];
}

export class BadRecordingError extends Error {
  override readonly name = "BadRecordingError";
}

const TERMINAL = new Set(["VerdictAnnounced", "TrialAborted"]);

export function readRecording(sse: string): Recording {
  const frames = parseSse(sse);
  const end = frames.findIndex((frame) => frame.type === "end");
  if (end < 0) throw new BadRecordingError("Nagranie bez zdarzenia end — strumien nie zostal zapisany do konca");
  const events = frames.slice(0, end).map((frame, index): RecordedEvent => {
    const envelope = parseEnvelope(frame.data);
    if (frame.type !== envelope.event.type) {
      throw new BadRecordingError(`Zdarzenie ${String(index + 1)}: typ SSE ${frame.type}, a w danych ${envelope.event.type}`);
    }
    return { envelope, data: frame.data };
  });

  if (events[0]?.envelope.event.type !== "TrialFiled") throw new BadRecordingError("Nagranie musi zaczynac sie od wniesienia sprawy");
  // Wniesienie juz sprawdzone, wiec ostatnie zdarzenie istnieje.
  if (!TERMINAL.has(String(events.at(-1)?.envelope.event.type))) {
    throw new BadRecordingError("Nagranie musi konczyc sie werdyktem albo przerwaniem rozprawy");
  }
  events.forEach((event, index) => {
    if (event.envelope.seq !== index + 1) throw new BadRecordingError(`Zdarzenie ${String(index + 1)} ma numer ${String(event.envelope.seq)}`);
  });
  return { events };
}
