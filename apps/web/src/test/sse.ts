import type { Envelope } from "../trial/envelope.js";

/** Koperty jako tekst strumienia SSE, w formacie serwera (apps/api/src/sse.ts). */
export const toSse = (list: readonly Envelope[], end: string | null = '{"reason":"finished"}') =>
  list.map((e) => `id: ${String(e.seq)}\nevent: ${e.event.type}\ndata: ${JSON.stringify(e)}\n\n`).join("") +
  (end === null ? "" : `event: end\ndata: ${end}\n\n`);
