import { useState } from "react";
import type { TrialApi } from "../api/client.js";
import type { EventSourceFactory } from "../api/stream.js";
import { formatUsd } from "../labels.js";
import { Bench } from "./Bench.js";
import { phaseOf } from "./court.js";
import { narrate } from "./narrate.js";
import { PhaseTimeline } from "./PhaseTimeline.js";
import { Proceedings } from "./Proceedings.js";
import { Report } from "./Report.js";
import { seats } from "./seats.js";
import { TrialActions } from "./TrialActions.js";
import { useCourt } from "./useCourt.js";
import { VerdictPanel } from "./VerdictPanel.js";

export interface TrialPageProps {
  readonly trialId: string;
  readonly api: TrialApi;
  readonly sources: EventSourceFactory;
  /** Co serwer ukryl przy wniesieniu (tylko zaraz po wniesieniu — po odswiezeniu strony nie wiemy). */
  readonly anonymized?: string | null;
  readonly onClose: () => void;
}

export function TrialPage({ trialId, api, sources, anonymized = null, onClose }: TrialPageProps) {
  const { court, trouble } = useCourt(api.eventsUrl(trialId), sources);
  const [forgotten, setForgotten] = useState(false);
  const trial = court.trial;

  if (forgotten) {
    return (
      <main className="page">
        <p className="notice">Rozprawa zapomniana: klucz usunięty, treści nie da się już odczytać.</p>
        <button type="button" onClick={onClose}>
          Nowa sprawa
        </button>
      </main>
    );
  }

  return (
    <main className="page trial">
      <div className="trial__bar">
        <PhaseTimeline court={court} />
        <p className="trial__cost" title="Koszt wywołań modelu w tej rozprawie">
          Koszt: {formatUsd(court.costNanoUsd)}
        </p>
      </div>
      <p className="trial__status" role="status" aria-live="polite">
        {narrate(court)}
      </p>
      {court.fault !== null && (
        <p className="notice notice--warn" role="alert">
          {court.fault}
        </p>
      )}
      {trouble !== null && (
        <p className="notice notice--warn" role="alert">
          {trouble}
        </p>
      )}
      {anonymized !== null && <p className="notice">Przed rozprawą ukryto dane osobowe: {anonymized}.</p>}

      <Bench court={court} />
      <Proceedings court={court} />
      {trial?.verdict != null && trial.justification !== null && <VerdictPanel verdict={trial.verdict} justification={trial.justification} />}
      {phaseOf(court) === "closed" && <Report seats={seats(court)} />}

      <TrialActions
        trialId={trialId}
        api={api}
        // Status "live" = jest wniesienie i nie bylo zdarzenia konczacego.
        running={court.status === "live"}
        settled={court.status !== "live" && court.status !== "connecting"}
        onForgotten={() => {
          setForgotten(true);
        }}
        onClose={onClose}
      />
    </main>
  );
}
