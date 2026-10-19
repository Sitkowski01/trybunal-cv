import { DEMO_CASE } from "./case.js";

export const REPO_URL = "https://github.com/Sitkowski01/trybunal-cv-ai";

export interface DemoIntroProps {
  readonly onOpen: () => void;
}

/**
 * Strona startowa demo zamiast formularza: formularz przyjmowalby dowolne CV, a odtworzyl
 * zawsze to samo nagranie — to wprowadzaloby w blad. Tu widac, nad czym obradowal sad.
 */
export function DemoIntro({ onOpen }: DemoIntroProps) {
  return (
    <section className="demo" aria-labelledby="demo-title">
      <h2 id="demo-title">Demo: nagrana rozprawa</h2>
      <p>
        Ta strona nie ma serwera ani modelu. Odtwarza nagranie jednej rozprawy nad fikcyjnym CV — te same zdarzenia, które przyszły z API,
        w tym koszt wywołań modelu.
      </p>
      <p className="demo__case">{DEMO_CASE.summary}</p>
      <details>
        <summary>CV kandydatki</summary>
        <pre className="demo__doc">{DEMO_CASE.cv}</pre>
      </details>
      <details>
        <summary>Ogłoszenie o pracę</summary>
        <pre className="demo__doc">{DEMO_CASE.offer}</pre>
      </details>
      <div className="demo__actions">
        <button type="button" onClick={onOpen}>
          Otwórz rozprawę
        </button>
        <a href={REPO_URL}>Własne CV: uruchom projekt lokalnie</a>
      </div>
    </section>
  );
}
