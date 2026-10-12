/**
 * Roznica miedzy punktem CV a poprawka krytyka, slowo po slowie. Najdluzszy wspolny podciag
 * slow (LCS) zostaje bez zmian, reszta to slowa usuniete i dodane. Biale znaki sa osobnymi
 * tokenami, wiec sklejenie czesci odtwarza oba teksty co do znaku.
 */
export interface DiffPart {
  readonly kind: "same" | "removed" | "added";
  readonly text: string;
}

const tokenize = (s: string) => s.split(/(\s+)/).filter((t) => t !== "");

/**
 * Tablica LCS ma (n+1)*(m+1) pol. Punkt CV (do 500 znakow) to ulamek megabajta, ale cale CV
 * przed i po (ok. 20 tys. tokenow) to juz 1,6 GB. Powyzej limitu: calosc usunieta, calosc dodana.
 */
export const MAX_DIFF_TOKENS = 2000;

export function wordDiff(before: string, after: string): DiffPart[] {
  const a = tokenize(before);
  const b = tokenize(after);
  if (a.length > MAX_DIFF_TOKENS || b.length > MAX_DIFF_TOKENS) {
    const whole: DiffPart[] = [
      { kind: "removed", text: before },
      { kind: "added", text: after },
    ];
    return whole.filter((p) => p.text !== "");
  }
  const width = b.length + 1;
  // lcs[i * width + j] = dlugosc LCS dla a[i..] i b[j..]; jedna tablica zamiast tablicy tablic.
  const lcs = new Uint32Array((a.length + 1) * width);
  const at = (i: number, j: number) => lcs[i * width + j] ?? 0;
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i * width + j] = a[i] === b[j] ? at(i + 1, j + 1) + 1 : Math.max(at(i + 1, j), at(i, j + 1));
    }
  }

  const parts: DiffPart[] = [];
  const push = (kind: DiffPart["kind"], text: string) => {
    const last = parts.at(-1);
    if (last?.kind === kind) {
      parts[parts.length - 1] = { kind, text: last.text + text };
    } else {
      parts.push({ kind, text });
    }
  };

  let i = 0;
  let j = 0;
  for (;;) {
    const x = a[i];
    const y = b[j];
    if (x === undefined && y === undefined) {
      return parts;
    }
    if (x !== undefined && x === y) {
      push("same", x);
      i++;
      j++;
    } else if (x !== undefined && (y === undefined || at(i + 1, j) >= at(i, j + 1))) {
      push("removed", x);
      i++;
    } else {
      push("added", y ?? "");
      j++;
    }
  }
}
