import { createHash } from "node:crypto";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import { MAX_DEBATE_ROUNDS, MAX_PDF_BYTES, replay } from "@trybunal/domain";
import Fastify, { type FastifyInstance, type FastifyReply } from "fastify";
import { z } from "zod";
import type { TrialHub } from "./hub.js";
import { type Journal, TrialForgottenError, TrialNotFoundError } from "./journal.js";
import { pdfToText, UnreadablePdfError } from "./pdf.js";
import { CourtBusyError, type FileRequest, InvalidTrialError, type TrialService } from "./service.js";
import { describeIssues } from "./issues.js";
import { openStream } from "./sse.js";

export interface AppOptions {
  readonly service: TrialService;
  readonly journal: Journal;
  readonly hub: TrialHub;
  /** Wniesienia z jednego IP w oknie czasu — kazda rozprawa kosztuje. */
  readonly rateLimit: { readonly max: number; readonly timeWindowMs: number };
  readonly heartbeatMs?: number;
  /** Dokad pisac logi (JSON, pino); bez strumienia logi sa wylaczone. */
  readonly logStream?: { write(line: string): void };
  /** Za proxy (Docker, nginx): adres klienta z X-Forwarded-For, inaczej wszyscy dziela jeden limit. */
  readonly trustProxy?: boolean;
}

const FileBody = z.object({
  cvText: z.string(),
  jobOffer: z.string(),
  debateRounds: z.coerce.number().int().min(0).max(MAX_DEBATE_ROUNDS).default(1),
  candidateName: z.string().optional(),
});

const TrialParams = z.object({ id: z.string().min(1).max(100) });
// Gorna granica jak kolumna integer w Postgresie — wieksza liczba to blad bazy (500), a nie 400.
const AfterSeq = z.coerce.number().int().min(0).max(2_147_483_647);

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new InvalidTrialError(describeIssues(result.error.issues));
  return result.data;
}

export async function buildApp(options: AppOptions): Promise<FastifyInstance> {
  const { service, journal, hub } = options;
  const app = Fastify({
    trustProxy: options.trustProxy ?? false,
    // Id rozprawy to jedyny klucz do jej odczytu i usuniecia — nie moze lezec w logach.
    logger: options.logStream !== undefined && {
      stream: options.logStream,
      serializers: { req: (req: { method: string; url: string }) => ({ method: req.method, url: redactIds(req.url) }) },
    },
  });
  // Lekki limit dla wszystkich tras (strumienie SSE kosztuja gniazdo i odczyt z bazy), ostry dla wniesien.
  await app.register(rateLimit, { max: 120, timeWindow: 60_000 });
  await app.register(multipart, { limits: { fileSize: MAX_PDF_BYTES, files: 1, fields: 10 } });

  app.setErrorHandler((error, _request, reply) => sendError(reply, error));

  app.get("/health", () => ({ ok: true }));

  app.post(
    "/trials",
    { config: { rateLimit: { max: options.rateLimit.max, timeWindow: options.rateLimit.timeWindowMs } } },
    async (request, reply) => {
      const body = parse(FileBody, request.isMultipart() ? await readMultipart(request.parts()) : request.body);
      const fileRequest: FileRequest = {
        cvText: body.cvText,
        jobOffer: body.jobOffer,
        debateRounds: body.debateRounds,
        ...(body.candidateName === undefined ? {} : { candidateName: body.candidateName }),
      };
      const filed = await service.file(fileRequest);
      return reply.code(202).send({ ...filed, eventsUrl: `/trials/${filed.trialId}/events` });
    },
  );

  app.get("/trials/:id", async (request) => {
    const { id } = parse(TrialParams, request.params);
    const envelopes = await journal.read(id);
    if (envelopes.length === 0) {
      // Rozprawa zalozona, ale wniesienie nie zapisalo sie (awaria bazy przy wnoszeniu).
      throw new TrialNotFoundError("Rozprawa nie ma zapisanych zdarzen");
    }
    // Bez tekstu CV i oferty: kandydat je zna, a odpowiedz moze trafic do logow czy pamieci przegladarki.
    const s = replay(envelopes.map((e) => e.event));
    return {
      trialId: s.trialId,
      phase: s.phase,
      running: await service.isActive(id),
      // Numery od 1 bez dziur (pilnuje dziennik), wiec ostatni numer = liczba zdarzen.
      lastSeq: envelopes.length,
      debateRounds: s.debateRounds,
      assessments: s.assessments,
      prosecution: s.prosecution,
      statements: s.statements,
      verdict: s.verdict,
      justification: s.justification,
      abortReason: s.abortReason,
    };
  });

  app.get("/trials/:id/events", async (request, reply) => {
    const { id } = parse(TrialParams, request.params);
    const query = request.query as { after?: unknown };
    // EventSource wznawia z naglowkiem Last-Event-ID; pierwsze polaczenie moze podac ?after=.
    const after = parse(AfterSeq, request.headers["last-event-id"] ?? query.after ?? 0);
    const stream = await openStream(id, after, { journal, hub, isRunning: (t) => service.isActive(t), heartbeatMs: options.heartbeatMs ?? 15_000 });
    reply.hijack();
    stream(request.raw, reply.raw);
  });

  app.post("/trials/:id/cancel", async (request, reply) => {
    const { id } = parse(TrialParams, request.params);
    if (await service.cancel(id)) return reply.code(202).send({ cancelled: true });
    await journal.assertReadable(id);
    return reply.code(409).send({ error: "Rozprawa juz sie zakonczyla" });
  });

  app.delete("/trials/:id", async (request, reply) => {
    const { id } = parse(TrialParams, request.params);
    return (await service.forget(id)) ? reply.code(204).send() : reply.code(404).send({ error: "Nie ma takiej rozprawy" });
  });

  return app;
}

/** Pola formularza; CV jako plik PDF ("cv") albo tekst ("cvText"). */
async function readMultipart(parts: AsyncIterableIterator<import("@fastify/multipart").Multipart>): Promise<Record<string, unknown>> {
  const fields: Record<string, unknown> = {};
  for await (const part of parts) {
    if (part.type === "file") {
      if (part.fieldname !== "cv") throw new InvalidTrialError([`${part.fieldname}: nieoczekiwany plik, CV wysylamy w polu "cv"`]);
      const bytes = await part.toBuffer();
      if ("cvText" in fields) throw new InvalidTrialError(["cv: CV jako plik albo tekst, nie oba naraz"]);
      fields.cvText = await pdfToText(new Uint8Array(bytes));
    } else {
      if (part.fieldname === "cvText" && "cvText" in fields) throw new InvalidTrialError(["cv: CV jako plik albo tekst, nie oba naraz"]);
      fields[part.fieldname] = part.value;
    }
  }
  return fields;
}

export const redactIds = (url: string) => url.replace(/\/trials\/[^/?]+/u, "/trials/:id");

/** Do logow zamiast id: wiaze wpisy jednej rozprawy, ale nie otwiera jej ani nie pozwala usunac. */
export const trialTag = (trialId: string) => createHash("sha256").update(trialId).digest("hex").slice(0, 12);

function sendError(reply: FastifyReply, error: unknown) {
  if (error instanceof InvalidTrialError) {
    return reply.code(400).send({ error: "Niepoprawne dane", problems: error.problems });
  }
  if (error instanceof UnreadablePdfError) return reply.code(422).send({ error: error.message });
  if (error instanceof TrialNotFoundError) return reply.code(404).send({ error: error.message });
  if (error instanceof TrialForgottenError) return reply.code(410).send({ error: error.message });
  if (error instanceof CourtBusyError) {
    return error.reason === "concurrency"
      ? reply.code(429).header("retry-after", "30").send({ error: error.message })
      : reply.code(503).send({ error: error.message });
  }
  const status = (error as { statusCode?: unknown }).statusCode;
  // Bledy Fastify z kodem 4xx (za duzy plik, limit zapytan, zly JSON) przechodza z wlasnym komunikatem.
  if (typeof status === "number" && status >= 400 && status < 500) {
    return reply.code(status).send({ error: (error as Error).message });
  }
  reply.log.error(error);
  return reply.code(500).send({ error: "Blad serwera" });
}
