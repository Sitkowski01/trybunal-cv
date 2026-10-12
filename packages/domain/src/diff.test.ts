import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type DiffPart, MAX_DIFF_TOKENS, wordDiff } from "./diff.js";

const join = (parts: DiffPart[], skip: DiffPart["kind"]) =>
  parts
    .filter((p) => p.kind !== skip)
    .map((p) => p.text)
    .join("");

describe("wordDiff", () => {
  it("poprawka zamienia obowiazek na wynik z liczba", () => {
    expect(wordDiff("Odpowiadalem za API gieldy", "Zbudowalem API gieldy na 1000 zlecen/s")).toEqual([
      { kind: "removed", text: "Odpowiadalem za" },
      { kind: "added", text: "Zbudowalem" },
      { kind: "same", text: " API gieldy" },
      { kind: "added", text: " na 1000 zlecen/s" },
    ]);
  });

  it("identyczne teksty to jedna czesc bez zmian", () => {
    expect(wordDiff("Ekspert React", "Ekspert React")).toEqual([{ kind: "same", text: "Ekspert React" }]);
  });

  it("puste teksty nie daja zadnych czesci", () => {
    expect(wordDiff("", "")).toEqual([]);
  });

  it("z pustego wszystko jest dodane, do pustego wszystko usuniete", () => {
    expect(wordDiff("", "Nowy punkt")).toEqual([{ kind: "added", text: "Nowy punkt" }]);
    expect(wordDiff("Stary punkt", "")).toEqual([{ kind: "removed", text: "Stary punkt" }]);
  });

  it("zmienione slowo w srodku: usuniete przed dodanym", () => {
    expect(wordDiff("Znam Jave dobrze", "Znam Kotlina dobrze")).toEqual([
      { kind: "same", text: "Znam " },
      { kind: "removed", text: "Jave" },
      { kind: "added", text: "Kotlina" },
      { kind: "same", text: " dobrze" },
    ]);
  });

  it("slowo dopisane na poczatku: reszta bez zmian", () => {
    expect(wordDiff("Java Spring", "Kotlin Java Spring")).toEqual([
      { kind: "added", text: "Kotlin " },
      { kind: "same", text: "Java Spring" },
    ]);
  });

  it("koniec poprawki przed koncem oryginalu: reszta usunieta w jednej czesci", () => {
    expect(wordDiff("Java i Java", "Java")).toEqual([
      { kind: "same", text: "Java" },
      { kind: "removed", text: " i Java" },
    ]);
  });

  it("ciag bialych znakow to jeden token", () => {
    expect(wordDiff("Java  Spring", "Java Spring")).toEqual([
      { kind: "same", text: "Java" },
      { kind: "removed", text: "  " },
      { kind: "added", text: " " },
      { kind: "same", text: "Spring" },
    ]);
  });

  it("powyzej limitu tokenow nie liczy LCS: calosc usunieta, calosc dodana", () => {
    const long = "slowo ".repeat(MAX_DIFF_TOKENS);
    expect(wordDiff(long, "krotko")).toEqual([
      { kind: "removed", text: long },
      { kind: "added", text: "krotko" },
    ]);
    expect(wordDiff("krotko", long)).toEqual([
      { kind: "removed", text: "krotko" },
      { kind: "added", text: long },
    ]);
    expect(wordDiff("", long)).toEqual([{ kind: "added", text: long }]);
  });

  it("powyzej limitu nawet drobna zmiana to wymiana calosci (LCS pokazalby jedno slowo)", () => {
    const long = "slowo ".repeat(MAX_DIFF_TOKENS);
    expect(wordDiff(long, `${long}x`)).toEqual([
      { kind: "removed", text: long },
      { kind: "added", text: `${long}x` },
    ]);
  });

  // Druga strona to jedno slowo: tablica LCS ma 2001 x 2 pola zamiast 4 mln — pod instrumentacja
  // Strykera pelna tablica 2000 x 2000 przekraczala limit czasu testu.
  it("na granicy limitu dalej liczy roznice, tuz za nia juz nie", () => {
    const atLimit = "slowo ".repeat(MAX_DIFF_TOKENS / 2);
    expect(wordDiff(atLimit, "slowo")[0]).toEqual({ kind: "same", text: "slowo" });
    const overLimit = `${atLimit}x`;
    expect(wordDiff(overLimit, "slowo")).toEqual([
      { kind: "removed", text: overLimit },
      { kind: "added", text: "slowo" },
    ]);
    // To samo, gdy dlugi jest tekst po poprawce.
    expect(wordDiff("slowo", atLimit)[0]).toEqual({ kind: "same", text: "slowo" });
    expect(wordDiff("slowo", overLimit)).toEqual([
      { kind: "removed", text: "slowo" },
      { kind: "added", text: overLimit },
    ]);
  });

  it("zachowuje najdluzsza wspolna czesc, nie pierwsze dopasowanie", () => {
    const parts = wordDiff("a b c d", "b c d a");
    expect(join(parts.filter((p) => p.kind === "same"), "added")).toBe("b c d");
  });
});

describe("wordDiff — wlasnosci", () => {
  const words = fc.array(fc.constantFrom("API", "React", "zespol", "5", "osob", " ", "  ", "\n"), {
    maxLength: 12,
  });
  const text = words.map((w) => w.join(""));

  it("czesci bez dodanych odtwarzaja tekst przed, bez usunietych tekst po", () => {
    fc.assert(
      fc.property(text, text, (before, after) => {
        const parts = wordDiff(before, after);
        return join(parts, "added") === before && join(parts, "removed") === after;
      }),
    );
  });

  it("sasiednie czesci zawsze roznia sie rodzajem i nie sa puste", () => {
    fc.assert(
      fc.property(text, text, (before, after) => {
        const parts = wordDiff(before, after);
        return parts.every((p, i) => p.text !== "" && (i === 0 || parts[i - 1]?.kind !== p.kind));
      }),
    );
  });

  it("czesc wspolna ma dlugosc LCS z naiwnej rekurencji (diff jest optymalny)", () => {
    const tokens = (s: string) => s.split(/(\s+)/).filter((x) => x !== "");
    const naiveLcs = (a: string[], b: string[]): number => {
      const [x, ...restA] = a;
      const [y, ...restB] = b;
      if (x === undefined || y === undefined) return 0;
      if (x === y) return 1 + naiveLcs(restA, restB);
      return Math.max(naiveLcs(restA, b), naiveLcs(a, restB));
    };
    const short = fc.array(fc.constantFrom("a", "b", "c", " "), { maxLength: 7 }).map((w) => w.join(""));
    fc.assert(
      fc.property(short, short, (before, after) => {
        const sameTokens = wordDiff(before, after)
          .filter((p) => p.kind === "same")
          .flatMap((p) => tokens(p.text)).length;
        return sameTokens === naiveLcs(tokens(before), tokens(after));
      }),
    );
  });

  it("tekst porownany sam ze soba nie ma zmian", () => {
    fc.assert(fc.property(text, (t) => wordDiff(t, t).every((p) => p.kind === "same")));
  });
});
