import { useState } from "react";
import { ApiError, type TrialApi } from "../api/client.js";

export interface TrialActionsProps {
  readonly trialId: string;
  readonly api: Pick<TrialApi, "cancel" | "forget">;
  /** Rozprawa trwa — mozna ja przerwac. */
  readonly running: boolean;
  /** Rozprawa sie skonczyla (werdykt, przerwanie, urwany strumien) — mozna ja zapomniec. */
  readonly settled: boolean;
  readonly onForgotten: () => void;
  readonly onClose: () => void;
}

/** Przyciski pod sala: przerwanie, zapomnienie rozprawy (RODO) i nowa sprawa. */
export function TrialActions({ trialId, api, running, settled, onForgotten, onClose }: TrialActionsProps) {
  const [actionError, setActionError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);

  const act = (action: () => Promise<void>, after?: () => void, failed?: () => void) => {
    setActionError(null);
    action().then(after, (error: unknown) => {
      failed?.();
      setActionError(error instanceof ApiError ? error.message : "Nieoczekiwany błąd");
    });
  };

  return (
    <>
      <div className="trial__actions">
        {running && (
          <button
            type="button"
            className="button--danger"
            disabled={cancelling}
            onClick={() => {
              // Do zdarzenia przerwania przycisk jest nieaktywny — drugie klikniecie dostaloby 409.
              setCancelling(true);
              act(
                () => api.cancel(trialId),
                undefined,
                () => {
                  setCancelling(false);
                },
              );
            }}
          >
            {cancelling ? "Przerywam…" : "Przerwij rozprawę"}
          </button>
        )}
        {settled && (
          <button
            type="button"
            onClick={() => {
              act(() => api.forget(trialId), onForgotten);
            }}
          >
            Zapomnij rozprawę (usuń dane)
          </button>
        )}
        <button type="button" className="button--ghost" onClick={onClose}>
          Nowa sprawa
        </button>
      </div>
      {actionError !== null && (
        <p className="notice notice--warn" role="alert">
          {actionError}
        </p>
      )}
    </>
  );
}
