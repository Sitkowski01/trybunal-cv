import { CRITIC_LABELS } from "../labels.js";
import type { Court } from "./court.js";

/** Protokol rozprawy: mowa oskarzenia i wypowiedzi w kolejnych rundach debaty. */
export function Proceedings({ court }: { readonly court: Court }) {
  const trial = court.trial;
  if (trial?.prosecution == null) return null;
  // Domena pilnuje kolejnosci: runda po rundzie, krytycy w kolejnosci miejsc przy stole.
  const rounds = [...new Set(trial.statements.map((s) => s.round))];

  return (
    <section className="proceedings" aria-labelledby="proceedings-title">
      <h2 id="proceedings-title">Protokół</h2>
      <figure className="speech">
        <blockquote>{trial.prosecution}</blockquote>
        <figcaption>{CRITIC_LABELS.prosecutor.name} — mowa oskarżenia</figcaption>
      </figure>
      {rounds.map((round) => (
        <div key={round} className="round">
          <h3>Debata — runda {round}</h3>
          <ul>
            {trial.statements
              .filter((s) => s.round === round)
              .map((s) => (
                <li key={s.criticId}>
                  <strong>{CRITIC_LABELS[s.criticId].name}:</strong> {s.statement}
                  {s.revisedScore !== null && <span className="round__revised"> (nowa ocena: {s.revisedScore})</span>}
                </li>
              ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
