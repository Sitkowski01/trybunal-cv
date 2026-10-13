import { ATS_GATE, INVITE_THRESHOLD, type Verdict } from "@trybunal/domain";
import { CRITIC_LABELS, formatScore } from "../labels.js";

const names = (ids: readonly (keyof typeof CRITIC_LABELS)[]) => ids.map((id) => CRITIC_LABELS[id].name).join(", ");

/**
 * Werdykt i jego powody. Decyzje liczy regula z ocen (domena), wiec obok wyniku pokazujemy
 * progi — kandydat widzi, dlaczego, a nie tylko co.
 */
export function VerdictPanel({ verdict, justification }: { readonly verdict: Verdict; readonly justification: string }) {
  const invited = verdict.decision === "invite";
  return (
    <section className={`verdict verdict--${verdict.decision}`} aria-labelledby="verdict-title">
      <h2 id="verdict-title" className="verdict__stamp">
        {invited ? "Zaprosić" : "Odrzucić"}
      </h2>
      <dl className="verdict__facts">
        <div>
          <dt>Średnia przysięgłych</dt>
          <dd>
            {formatScore(verdict.juryAverage)} <small>(próg {INVITE_THRESHOLD})</small>
          </dd>
        </div>
        <div>
          <dt>Filtr ATS</dt>
          <dd>{verdict.atsGateFailed ? `odrzucone (ocena poniżej ${String(ATS_GATE)})` : "przeszło"}</dd>
        </div>
        <div>
          <dt>Rozrzut ocen</dt>
          <dd>
            {verdict.spread} {verdict.disputed && <strong className="verdict__disputed">— CV niejednoznaczne</strong>}
          </dd>
        </div>
        <div>
          <dt>Najsurowiej / najłagodniej</dt>
          <dd>
            {names(verdict.harshest)} / {names(verdict.mildest)}
          </dd>
        </div>
      </dl>
      {verdict.mindChanges.length > 0 && (
        <p className="verdict__changes">
          Zmiana zdania w debacie:{" "}
          {verdict.mindChanges.map((c) => `${CRITIC_LABELS[c.criticId].name} ${String(c.from)}→${String(c.to)}`).join(", ")}
        </p>
      )}
      <blockquote className="verdict__justification">{justification}</blockquote>
    </section>
  );
}
