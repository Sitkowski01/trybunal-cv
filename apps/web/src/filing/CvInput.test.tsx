import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CvInput, type CvInputProps } from "./CvInput.js";

function setup(props: Partial<CvInputProps> = {}) {
  const all: CvInputProps = { mode: "text", text: "", onMode: vi.fn(), onText: vi.fn(), onFile: vi.fn(), ...props };
  render(<CvInput {...all} />);
  return { ...all, user: userEvent.setup({ delay: null }) };
}

describe("CvInput", () => {
  it("tryb tekstowy: pole tekstu z wartoscia, obie opcje w jednej grupie", async () => {
    const { user, onMode, onText } = setup({ text: "Java" });
    const [text, file] = screen.getAllByRole("radio");
    expect(text).toBeChecked();
    expect(file).not.toBeChecked();
    expect(text?.getAttribute("name")).toMatch(/.-mode$/u);
    expect(file?.getAttribute("name")).toBe(text?.getAttribute("name"));
    expect(screen.getByLabelText("Treść CV")).toHaveValue("Java");
    expect(screen.queryByLabelText(/^Plik PDF \(/u)).toBeNull();
    await user.type(screen.getByLabelText("Treść CV"), "!");
    expect(onText).toHaveBeenLastCalledWith("Java!");
    await user.click(screen.getByRole("radio", { name: "Plik PDF" }));
    expect(onMode).toHaveBeenCalledExactlyOnceWith("pdf");
  });

  it("tryb PDF: wybor pliku i jego odznaczenie", async () => {
    const { user, onFile, onMode } = setup({ mode: "pdf" });
    expect(screen.getByRole("radio", { name: "Plik PDF" })).toBeChecked();
    expect(screen.queryByLabelText("Treść CV")).toBeNull();
    const input = screen.getByLabelText("Plik PDF (maks. 2 MB)");
    expect(input).toHaveAttribute("accept", "application/pdf");
    const file = new File(["%PDF"], "cv.pdf", { type: "application/pdf" });
    await user.upload(input, file);
    expect(onFile).toHaveBeenLastCalledWith(file);
    await user.upload(input, []);
    expect(onFile).toHaveBeenLastCalledWith(null);
    await user.click(screen.getByRole("radio", { name: "Tekst" }));
    expect(onMode).toHaveBeenCalledExactlyOnceWith("text");
  });
});
