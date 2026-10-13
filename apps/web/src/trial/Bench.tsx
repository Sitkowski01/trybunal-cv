import { CRITIC_LABELS, ACTIVITY_LABELS } from "../labels.js";
import { activity } from "./activity.js";
import type { Court } from "./court.js";
import { type Seat, seats } from "./seats.js";

/** Lawa trybunalu: pieciu krytykow, ich ocena (z ewentualna zmiana zdania) i co robia teraz. */
export function Bench({ court }: { readonly court: Court }) {
  return (
    <ol className="bench" aria-label="Skład trybunału">
      {seats(court).map((seat) => (
        <CriticCard key={seat.criticId} seat={seat} court={court} />
      ))}
    </ol>
  );
}

function CriticCard({ seat, court }: { readonly seat: Seat; readonly court: Court }) {
  const label = CRITIC_LABELS[seat.criticId];
  const now = activity(court, seat);
  const initial = seat.assessment?.score ?? null;
  // Ocena (score) jest od chwili zlozenia oceny (initial), wiec wystarczy porownac obie.
  const changed = initial !== null && seat.score !== initial;
  const lastWord = seat.statements.at(-1);
  return (
    <li className={`critic critic--${now}${seat.criticId === "prosecutor" ? " critic--prosecutor" : ""}`} data-critic={seat.criticId}>
      <header className="critic__head">
        <span className="critic__emblem" aria-hidden="true">
          {label.emblem}
        </span>
        <div>
          <h3 className="critic__name">{label.name}</h3>
          <p className="critic__role">{label.role}</p>
        </div>
      </header>
      <div className="critic__score">
        <span className="visually-hidden">{scoreLabel(initial, seat.score)}</span>
        {seat.score === null ? (
          <span className="critic__pending" aria-hidden="true">
            –
          </span>
        ) : (
          <>
            {changed && (
              <span className="critic__was" aria-hidden="true">
                {initial}→
              </span>
            )}
            <span className="critic__value" aria-hidden="true">
              {seat.score}
            </span>
            <span className="critic__scale" aria-hidden="true">
              /10
            </span>
          </>
        )}
      </div>
      <p className="critic__activity">{ACTIVITY_LABELS[now]}</p>
      {seat.assessment !== null && <p className="critic__summary">{seat.assessment.summary}</p>}
      {lastWord !== undefined && (
        <blockquote className="critic__statement">
          <span className="visually-hidden">Runda {lastWord.round}: </span>
          {lastWord.statement}
        </blockquote>
      )}
    </li>
  );
}

function scoreLabel(initial: number | null, score: number | null): string {
  if (score === null) return "Brak oceny";
  if (initial !== score) return `Ocena ${String(score)} na 10, zmieniona z ${String(initial)}`;
  return `Ocena ${String(score)} na 10`;
}
