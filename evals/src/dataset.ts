import { createHash } from "node:crypto";
import { posix } from "node:path";
import { z } from "zod";

/**
 * Zbior ewaluacyjny: fikcyjne CV i oferty z werdyktem, ktorego oczekuje rozsadny rekruter.
 * Werdykt jest czescia przypadku, a nie wynikiem modelu — dzieki temu da sie zmierzyc trafnosc
 * i porownac wersje promptow na tych samych danych.
 */
export const TAGS = ["mocne", "slabe", "ats", "injection", "luka", "przebranzowienie", "zawyzone", "nadkwalifikacje", "liczby", "graniczny"] as const;
export type Tag = (typeof TAGS)[number];

export const DecisionSchema = z.enum(["invite", "reject"]);
export type Decision = z.infer<typeof DecisionSchema>;

/** Sciezka wzgledna wewnatrz katalogu zbioru — bez wychodzenia poza niego. */
const RelativePath = z
  .string()
  .regex(/^[a-z0-9-]+\/[a-z0-9-]+\.md$/, "Sciezka w postaci katalog/plik.md");

export const EvalCaseSchema = z.strictObject({
  // Krotkie: id trafia do identyfikatora rozprawy razem z wersja promptow.
  id: z.string().max(40).regex(/^[a-z0-9-]+$/, "Id z malych liter, cyfr i myslnikow"),
  cv: RelativePath,
  offer: RelativePath,
  expected: DecisionSchema,
  tags: z.array(z.enum(TAGS)).min(1).max(3),
  note: z.string().trim().min(1),
});

export const ManifestSchema = z
  .array(EvalCaseSchema)
  .min(1)
  .superRefine((cases, ctx) => {
    const seen = new Set<string>();
    for (const [index, c] of cases.entries()) {
      if (seen.has(c.id)) ctx.addIssue({ code: "custom", path: [index, "id"], message: `Powtorzone id: ${c.id}` });
      seen.add(c.id);
    }
  });

export type EvalCaseEntry = z.infer<typeof EvalCaseSchema>;

export interface EvalCase extends EvalCaseEntry {
  readonly cvText: string;
  readonly offerText: string;
}

/** Wczytuje manifest i pliki przypadkow. Czytanie wstrzykniete, zeby test nie potrzebowal dysku. */
export async function loadDataset(dir: string, readText: (path: string) => Promise<string>): Promise<EvalCase[]> {
  const manifest = ManifestSchema.parse(JSON.parse(await readText(posix.join(dir, "cases.json"))));
  return Promise.all(
    manifest.map(async (entry) => ({
      ...entry,
      cvText: await readText(posix.join(dir, entry.cv)),
      offerText: await readText(posix.join(dir, entry.offer)),
    })),
  );
}

/**
 * Odcisk wejscia rozpraw: tresc CV i ofert kazdego przypadku (bez etykiet — poprawka oczekiwanego
 * werdyktu czy tagu nie wymaga powtorki rozpraw). Zapisany w meta.json; wznowienie na zmienionym
 * zbiorze mieszaloby wyniki dwoch roznych zbiorow.
 */
export function datasetHash(cases: readonly EvalCase[]): string {
  const input = [...cases].sort((a, b) => a.id.localeCompare(b.id)).map((c) => [c.id, c.cvText, c.offerText]);
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}
