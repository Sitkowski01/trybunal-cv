import { MAX_CV_CHARS, MAX_PDF_BYTES } from "@trybunal/domain";
import { useId } from "react";
import type { CvMode } from "./validate.js";

export interface CvInputProps {
  readonly mode: CvMode;
  readonly text: string;
  readonly onMode: (mode: CvMode) => void;
  readonly onText: (text: string) => void;
  readonly onFile: (file: File | null) => void;
}

/** CV jako wklejony tekst albo plik PDF (przelacznik). Stan trzyma formularz. */
export function CvInput({ mode: current, text, onMode, onText, onFile }: CvInputProps) {
  const id = useId();
  return (
    <fieldset className="filing__cv">
      <legend>CV kandydata</legend>
      <div className="segmented" role="radiogroup" aria-label="Postać CV">
        {(["text", "pdf"] as const).map((mode) => (
          <label key={mode}>
            <input
              type="radio"
              name={`${id}-mode`}
              value={mode}
              checked={current === mode}
              onChange={() => {
                onMode(mode);
              }}
            />
            {mode === "text" ? "Tekst" : "Plik PDF"}
          </label>
        ))}
      </div>
      {current === "text" ? (
        <label className="field">
          <span>Treść CV</span>
          <textarea
            value={text}
            rows={14}
            maxLength={MAX_CV_CHARS}
            onChange={(e) => {
              onText(e.target.value);
            }}
          />
        </label>
      ) : (
        <label className="field">
          <span>Plik PDF (maks. {MAX_PDF_BYTES / 1024 / 1024} MB)</span>
          <input
            type="file"
            accept="application/pdf"
            onChange={(e) => {
              onFile(e.target.files?.[0] ?? null);
            }}
          />
        </label>
      )}
    </fieldset>
  );
}
