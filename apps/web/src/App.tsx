import { useEffect, useState } from "react";
import type { TrialApi } from "./api/client.js";
import type { EventSourceFactory } from "./api/stream.js";
import { FilingForm } from "./filing/FilingForm.js";
import { describeAnonymized } from "./labels.js";
import { TrialPage } from "./trial/TrialPage.js";

/**
 * Dwa widoki: wniesienie sprawy i sala rozpraw. Id rozprawy w adresie (?rozprawa=), wiec
 * odswiezenie strony albo link wracaja do tej samej rozprawy — strumien odtworzy ja od poczatku.
 */
const PARAM = "rozprawa";

const trialFromUrl = () => new URLSearchParams(window.location.search).get(PARAM);

export interface AppProps {
  readonly api: TrialApi;
  readonly sources: EventSourceFactory;
}

export function App({ api, sources }: AppProps) {
  const [trialId, setTrialId] = useState(trialFromUrl);
  const [anonymized, setAnonymized] = useState<string | null>(null);

  useEffect(() => {
    const onPop = () => {
      setTrialId(trialFromUrl());
      setAnonymized(null);
    };
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
    };
  }, []);

  const navigate = (id: string | null) => {
    const url = new URL(window.location.href);
    if (id === null) url.searchParams.delete(PARAM);
    else url.searchParams.set(PARAM, id);
    // Stryker disable next-line StringLiteral: tytul w pushState przegladarki ignoruja.
    window.history.pushState(null, "", url);
    setTrialId(id);
  };

  return (
    <>
      <header className="masthead">
        <h1>Trybunał CV</h1>
        <p>Pięciu krytyków AI ocenia CV pod ogłoszenie, spiera się w debacie, a sędzia ogłasza werdykt.</p>
      </header>
      {trialId === null ? (
        <main className="page">
          <FilingForm
            onFile={api.file}
            onFiled={(filed) => {
              setAnonymized(describeAnonymized(filed.anonymized));
              navigate(filed.trialId);
            }}
          />
        </main>
      ) : (
        <TrialPage
          key={trialId}
          trialId={trialId}
          api={api}
          sources={sources}
          anonymized={anonymized}
          onClose={() => {
            navigate(null);
          }}
        />
      )}
    </>
  );
}
