import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Filed, FilingInput } from "../api/client.js";
import { FilingForm } from "./FilingForm.js";

const filed: Filed = { trialId: "t-1", anonymized: {} };
const pdf = (size = 10) => new File([new Uint8Array(size)], "cv.pdf", { type: "application/pdf" });

function setup(onFile = vi.fn<(input: FilingInput) => Promise<Filed>>(() => Promise.resolve(filed))) {
  const onFiled = vi.fn();
  render(<FilingForm onFile={onFile} onFiled={onFiled} />);
  return { onFile, onFiled, user: userEvent.setup({ delay: null }) };
}

describe("FilingForm", () => {
  it("wnosi CV jako tekst z ogloszeniem, imieniem i rundami debaty", async () => {
    const { onFile, onFiled, user } = setup();
    await user.type(screen.getByLabelText("Treść CV"), "Java, Spring");
    await user.type(screen.getByLabelText("Treść ogłoszenia o pracę"), "Junior Java");
    await user.type(screen.getByLabelText(/^Imię i nazwisko/u), "Anna Nowak");
    await user.selectOptions(screen.getByLabelText("Rundy debaty"), "bez debaty");
    await user.click(screen.getByRole("button", { name: "Wnieś sprawę" }));
    expect(onFile).toHaveBeenCalledExactlyOnceWith({ cv: { kind: "text", text: "Java, Spring" }, jobOffer: "Junior Java", debateRounds: 0, candidateName: "Anna Nowak" });
    expect(onFiled).toHaveBeenCalledWith(filed);
    expect(screen.getByRole("button", { name: "Wnoszę sprawę…" })).toBeDisabled();
  });

  it("stan poczatkowy: bez bledow i bez opisu bledow w formularzu", () => {
    setup();
    expect(screen.getByRole("radio", { name: "Tekst" })).toBeChecked();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button", { name: "Wnieś sprawę" }).closest("form")).not.toHaveAttribute("aria-describedby");
  });

  it("rundy debaty: od 0 do 3, domyslnie 1", () => {
    setup();
    const select = screen.getByLabelText<HTMLSelectElement>("Rundy debaty");
    expect([...select.options].map((o) => [o.value, o.text])).toEqual([["0", "bez debaty"], ["1", "1"], ["2", "2"], ["3", "3"]]);
    expect(select.value).toBe("1");
  });

  it("CV jako PDF: plik zamiast tekstu", async () => {
    const { onFile, user } = setup();
    await user.click(screen.getByRole("radio", { name: "Plik PDF" }));
    expect(screen.queryByLabelText("Treść CV")).toBeNull();
    const file = pdf();
    await user.upload(screen.getByLabelText("Plik PDF (maks. 2 MB)"), file);
    await user.type(screen.getByLabelText("Treść ogłoszenia o pracę"), "Junior");
    await user.click(screen.getByRole("button", { name: "Wnieś sprawę" }));
    expect(onFile.mock.calls[0]?.[0].cv).toEqual({ kind: "pdf", file });
    await user.click(screen.getByRole("radio", { name: "Tekst" }));
    expect(screen.getByLabelText("Treść CV")).toBeInTheDocument();
  });

  it("PDF -> tekst -> PDF: wczesniej wybrany plik nie poleci po cichu", async () => {
    const { onFile, user } = setup();
    await user.click(screen.getByRole("radio", { name: "Plik PDF" }));
    await user.upload(screen.getByLabelText("Plik PDF (maks. 2 MB)"), pdf());
    await user.click(screen.getByRole("radio", { name: "Tekst" }));
    await user.click(screen.getByRole("radio", { name: "Plik PDF" }));
    await user.type(screen.getByLabelText("Treść ogłoszenia o pracę"), "Junior");
    await user.click(screen.getByRole("button", { name: "Wnieś sprawę" }));
    expect(onFile).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("Wybierz plik PDF z CV.");
  });

  it("odznaczenie pliku wraca do braku pliku", async () => {
    const { onFile, user } = setup();
    await user.click(screen.getByRole("radio", { name: "Plik PDF" }));
    const input = screen.getByLabelText("Plik PDF (maks. 2 MB)");
    await user.upload(input, pdf());
    await user.upload(input, []);
    await user.type(screen.getByLabelText("Treść ogłoszenia o pracę"), "Junior");
    await user.click(screen.getByRole("button", { name: "Wnieś sprawę" }));
    expect(onFile).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("Wybierz plik PDF z CV.");
  });

  it("bledy formularza blokuja wyslanie i sa powiazane z formularzem", async () => {
    const { onFile, user } = setup();
    await user.click(screen.getByRole("button", { name: "Wnieś sprawę" }));
    expect(onFile).not.toHaveBeenCalled();
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Wklej treść CV.Wklej treść ogłoszenia.");
    expect(alert.closest("form")?.getAttribute("aria-describedby")).toBe(alert.id);
  });
});
