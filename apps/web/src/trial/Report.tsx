import type { Concern, CriticId, Rewrite } from "@trybunal/domain";
import { CRITIC_LABELS, SEVERITY_LABELS } from "../labels.js";
import type { Seat } from "./seats.js";
import { DiffText } from "./DiffText.js";

const SEVERITY_ORDER = { high: 0, medium: 1, low: 2 } as const;

type Attributed<T> = T & { readonly criticId: CriticId };

/** Wyrok na pismie: poprawki CV jako diff i zastrzezenia krytykow, od najpowazniejszych. */
export function Report({ seats }: { readonly seats: readonly Seat[] }) {
  const of = <T,>(pick: (seat: Seat) => readonly T[]): Attributed<T>[] => seats.flatMap((seat) => pick(seat).map((item) => ({ ...item, criticId: seat.criticId })));
  const rewrites = of<Rewrite>((s) => s.assessment?.rewrites ?? []);
  const concerns = of<Concern>((s) => s.assessment?.concerns ?? []).sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  const strengths = of<{ readonly text: string }>((s) => (s.assessment?.strengths ?? []).map((text) => ({ text })));

  return (
    <section className="report" aria-labelledby="report-title">
      <h2 id="report-title">Uzasadnienie na piśmie</h2>

      <h3>Poprawki CV</h3>
      {rewrites.length === 0 ? (
        <p className="report__empty">Krytycy nie zaproponowali poprawek.</p>
      ) : (
        <ul className="report__list">
          {rewrites.map((r, i) => (
            // Stryker disable next-line StringLiteral: klucz Reacta - lista nie zmienia sie w miejscu.
            <li key={`${r.criticId}-${String(i)}`} className="rewrite">
              <DiffText before={r.original} after={r.proposed} />
              <p className="report__meta">
                {CRITIC_LABELS[r.criticId].name}: {r.reason}
              </p>
            </li>
          ))}
        </ul>
      )}

      <h3>Zastrzeżenia</h3>
      {concerns.length === 0 ? (
        <p className="report__empty">Brak zastrzeżeń.</p>
      ) : (
        <ul className="report__list">
          {concerns.map((c, i) => (
            // Stryker disable next-line StringLiteral: klucz Reacta - lista nie zmienia sie w miejscu.
            <li key={`${c.criticId}-${String(i)}`} className={`concern concern--${c.severity}`}>
              <q>{c.quote}</q>
              <p>{c.issue}</p>
              <p className="report__meta">
                {CRITIC_LABELS[c.criticId].name} · {SEVERITY_LABELS[c.severity]}
              </p>
            </li>
          ))}
        </ul>
      )}

      {strengths.length > 0 && (
        <>
          <h3>Mocne strony</h3>
          <ul className="report__list report__list--plain">
            {strengths.map((s, i) => (
              // Stryker disable next-line StringLiteral: klucz Reacta - lista nie zmienia sie w miejscu.
              <li key={`${s.criticId}-${String(i)}`}>
                {s.text} <span className="report__meta">— {CRITIC_LABELS[s.criticId].name}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
