import { lazy, Suspense, useState } from "react";
import type { TrialApi } from "../api/client.js";
import type { EventSourceFactory } from "../api/stream.js";
import { formatUsd } from "../labels.js";
import { direct } from "../scene/direct.js";
import { SceneBoundary } from "../scene/SceneBoundary.js";
import type { SceneSupport } from "../scene/support.js";
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

// three.js wazy wiecej niz reszta aplikacji — sala 3D doczytuje sie dopiero, gdy jest pokazywana.
const CourtScene = lazy(() => import("../scene/CourtScene.js"));

export interface TrialPageProps {
  readonly trialId: string;
  readonly api: TrialApi;
  readonly sources: EventSourceFactory;
  /** Co serwer ukryl przy wniesieniu (tylko zaraz po wniesieniu — po odswiezeniu strony nie wiemy). */
  readonly anonymized?: string | null;
  readonly onClose: () => void;
  /** null: przegladarka bez WebGL 2 — zostaje widok 2D. */
  readonly scene?: SceneSupport | null;
}

export function TrialPage({ trialId, api, sources, anonymized = null, onClose, scene = null }: TrialPageProps) {
  const { court, trouble } = useCourt(api.eventsUrl(trialId), sources);
  const [forgotten, setForgotten] = useState(false);
  const [showScene, setShowScene] = useState(true);
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

      {scene !== null && (
        <section className="stage" aria-label="Sala rozpraw">
          <button
            type="button"
            className="stage__toggle"
            aria-pressed={showScene}
            onClick={() => {
              setShowScene((shown) => !shown);
            }}
          >
            {showScene ? "Ukryj salę 3D" : "Pokaż salę 3D"}
          </button>
          {showScene && (
            <SceneBoundary>
              <Suspense fallback={<p className="stage__loading">Wczytywanie sali…</p>}>
                <CourtScene direction={direct(court)} reducedMotion={scene.reducedMotion} lowPower={scene.lowPower} />
              </Suspense>
            </SceneBoundary>
          )}
        </section>
      )}
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
