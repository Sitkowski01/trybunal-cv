import { MAX_DEBATE_ROUNDS, MAX_JOB_OFFER_CHARS } from "@trybunal/domain";
import { type SubmitEvent, useId, useState } from "react";
import { ApiError, type Filed, type FilingInput } from "../api/client.js";
import { CvInput } from "./CvInput.js";
import { EXAMPLE } from "./example.js";
import { type CvMode, validate } from "./validate.js";

export interface FilingFormProps {
  readonly onFile: (input: FilingInput) => Promise<Filed>;
  readonly onFiled: (filed: Filed) => void;
}

export function FilingForm({ onFile, onFiled }: FilingFormProps) {
  const id = useId();
  const [cvMode, setCvMode] = useState<CvMode>("text");
  const [cvText, setCvText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [jobOffer, setJobOffer] = useState("");
  const [candidateName, setCandidateName] = useState("");
  const [debateRounds, setDebateRounds] = useState(1);
  const [problems, setProblems] = useState<readonly string[]>([]);
  const [sending, setSending] = useState(false);

  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    const found = validate({ cvMode, cvText, file, jobOffer });
    setProblems(found);
    if (found.length > 0 || sending) return;
    // Plik jest tylko w trybie PDF: zmiana trybu go czysci.
    const cv = file !== null ? { kind: "pdf" as const, file } : { kind: "text" as const, text: cvText };
    setSending(true);
    onFile({ cv, jobOffer, debateRounds, candidateName }).then(onFiled, (error: unknown) => {
      setSending(false);
      setProblems(error instanceof ApiError ? [error.message, ...error.problems] : ["Nieoczekiwany błąd przy wnoszeniu sprawy."]);
    });
  };

  const loadExample = () => {
    setCvMode("text");
    setCvText(EXAMPLE.cv);
    setJobOffer(EXAMPLE.offer);
    setCandidateName(EXAMPLE.candidateName);
    setProblems([]);
  };

  return (
    <form className="filing" onSubmit={submit} noValidate aria-describedby={problems.length > 0 ? `${id}-problems` : undefined}>
      <CvInput
        mode={cvMode}
        text={cvText}
        onMode={(mode) => {
          setCvMode(mode);
          // Pole pliku po powrocie jest puste — wybrany wczesniej plik nie moze poleciec po cichu.
          setFile(null);
        }}
        onText={setCvText}
        onFile={setFile}
      />

      <fieldset className="filing__offer">
        <legend>Ogłoszenie</legend>
        <label className="field">
          <span>Treść ogłoszenia o pracę</span>
          <textarea
            value={jobOffer}
            rows={8}
            maxLength={MAX_JOB_OFFER_CHARS}
            onChange={(e) => {
              setJobOffer(e.target.value);
            }}
          />
        </label>
        <label className="field">
          <span>Imię i nazwisko (opcjonalnie — ukryjemy je przed sądem)</span>
          <input
            type="text"
            value={candidateName}
            autoComplete="off"
            onChange={(e) => {
              setCandidateName(e.target.value);
            }}
          />
        </label>
        <label className="field">
          <span>Rundy debaty</span>
          <select
            value={debateRounds}
            onChange={(e) => {
              setDebateRounds(Number(e.target.value));
            }}
          >
            {Array.from({ length: MAX_DEBATE_ROUNDS + 1 }, (_, n) => (
              <option key={n} value={n}>
                {n === 0 ? "bez debaty" : String(n)}
              </option>
            ))}
          </select>
        </label>
      </fieldset>

      {problems.length > 0 && (
        <ul id={`${id}-problems`} className="notice notice--warn filing__problems" role="alert">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}

      <div className="filing__actions">
        <button type="button" className="button--ghost" onClick={loadExample}>
          Wczytaj przykład
        </button>
        <button type="submit" disabled={sending}>
          {sending ? "Wnoszę sprawę…" : "Wnieś sprawę"}
        </button>
      </div>
    </form>
  );
}
