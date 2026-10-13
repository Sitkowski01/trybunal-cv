import { z } from "zod";

/** CV wklejone jako tekst albo plik PDF — serwer wyciaga z PDF tekst sam. */
export type CvSource = { readonly kind: "text"; readonly text: string } | { readonly kind: "pdf"; readonly file: Blob };

export interface FilingInput {
  readonly cv: CvSource;
  readonly jobOffer: string;
  readonly debateRounds: number;
  /** Imie i nazwisko do ukrycia przed rozprawa (anonimizacja po stronie serwera). */
  readonly candidateName?: string;
}

const FiledSchema = z.object({
  trialId: z.string().min(1),
  /** Ile danych osobowych kazdego rodzaju ukryto, np. { email: 1, phone: 1 }. */
  anonymized: z.record(z.string(), z.number().int().min(0)),
});

export type Filed = z.infer<typeof FiledSchema>;

const ErrorBodySchema = z.object({ error: z.string(), problems: z.array(z.string()).optional() });

/** Odpowiedz serwera inna niz sukces: kod, komunikat i lista problemow walidacji (400). */
export class ApiError extends Error {
  override readonly name = "ApiError";
  constructor(
    readonly status: number,
    message: string,
    readonly problems: readonly string[] = [],
  ) {
    super(message);
  }
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

/** Komunikat dla czlowieka, nawet gdy serwer (albo proxy) zwrocil cos innego niz JSON z bledem. */
async function failure(response: Response): Promise<ApiError> {
  const body = ErrorBodySchema.safeParse(await response.json().catch(() => null));
  if (body.success) return new ApiError(response.status, body.data.error, body.data.problems);
  return new ApiError(response.status, `Serwer odpowiedzial kodem ${String(response.status)}`);
}

export interface TrialApi {
  readonly file: (input: FilingInput) => Promise<Filed>;
  readonly cancel: (trialId: string) => Promise<void>;
  readonly forget: (trialId: string) => Promise<void>;
  readonly eventsUrl: (trialId: string) => string;
}

/** Klient API rozpraw; fetch wstrzykiwany, zeby testy nie potrzebowaly serwera. */
export function createApi(fetchFn: Fetch, base = "/api"): TrialApi {
  const call = async (path: string, init: RequestInit) => {
    let response: Response;
    try {
      response = await fetchFn(`${base}${path}`, init);
    } catch {
      throw new ApiError(0, "Brak polaczenia z serwerem");
    }
    if (!response.ok) throw await failure(response);
    return response;
  };
  const trialPath = (trialId: string) => `/trials/${encodeURIComponent(trialId)}`;

  return {
    file: async (input) => {
      const response = await call("/trials", { method: "POST", body: formOf(input) });
      const filed = FiledSchema.safeParse(await response.json().catch(() => null));
      if (!filed.success) throw new ApiError(response.status, "Serwer przyjal sprawe, ale odpowiedz jest nieczytelna");
      return filed.data;
    },
    cancel: async (trialId) => {
      await call(`${trialPath(trialId)}/cancel`, { method: "POST" });
    },
    forget: async (trialId) => {
      await call(trialPath(trialId), { method: "DELETE" });
    },
    eventsUrl: (trialId) => `${base}${trialPath(trialId)}/events`,
  };
}

/** Zawsze formularz (multipart): ten sam ksztalt dla tekstu i PDF, serwer przyjmuje oba. */
export function formOf(input: FilingInput): FormData {
  const form = new FormData();
  if (input.cv.kind === "pdf") form.append("cv", input.cv.file, "cv.pdf");
  else form.append("cvText", input.cv.text);
  form.append("jobOffer", input.jobOffer);
  form.append("debateRounds", String(input.debateRounds));
  if (input.candidateName !== undefined && input.candidateName.trim() !== "") form.append("candidateName", input.candidateName.trim());
  return form;
}
