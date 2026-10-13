import { PHASES } from "../labels.js";
import { type Court, phaseOf } from "./court.js";

/**
 * Przebieg rozprawy: etapy za nami, biezacy i przed nami. Debata pokazuje runde, a przerwana
 * rozprawa — etap, na ktorym stanela.
 */
export function PhaseTimeline({ court }: { readonly court: Court }) {
  const reached = court.abortedIn ?? phaseOf(court);
  const current = PHASES.findIndex((p) => p.phase === reached);
  const debateRounds = court.trial?.debateRounds ?? 0;
  const phases = debateRounds === 0 ? PHASES.filter((p) => p.phase !== "debate") : PHASES;
  const stopped = court.abortedIn !== null;
  return (
    <ol className="timeline" aria-label="Przebieg rozprawy">
      {phases.map(({ phase, label }) => {
        const index = PHASES.findIndex((p) => p.phase === phase);
        const state = index > current ? "todo" : index < current ? "done" : stopped ? "stopped" : "now";
        const round = phase === "debate" && index === current ? ` ${String(court.trial?.round ?? 0)}/${String(debateRounds)}` : "";
        return (
          <li key={phase} className={`timeline__step timeline__step--${state}`} {...(state === "now" ? { "aria-current": "step" as const } : {})}>
            {label}
            {round}
            {state === "stopped" && <span className="visually-hidden"> (tu przerwano)</span>}
          </li>
        );
      })}
    </ol>
  );
}
