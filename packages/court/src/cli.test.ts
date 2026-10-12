import { join } from "node:path";
import type { CriticId } from "@trybunal/domain";
import { FakeLlmClient, type FakeScript } from "@trybunal/llm";
import { describe, expect, it } from "vitest";
import { type CliIo, main, USAGE } from "./cli.js";

const happy: FakeScript = (req) => {
  if (req.label.startsWith("assessment:")) {
    const score: Record<CriticId, number> = { ats: 7, hr: 6, techLead: 6, hiringManager: 7, prosecutor: 3 };
    return { score: score[req.label.split(":")[1] as CriticId], summary: "ok", strengths: [], concerns: [], rewrites: [] };
  }
  if (req.label === "prosecution") return { speech: "Odrzucic" };
  if (req.label.startsWith("statement:")) return { statement: "Podtrzymuje", revisedScore: null };
  return { justification: "Zapraszamy" };
};

function memory(files: Record<string, string>, apiKey: string | null = "sk-test") {
  const written = new Map<string, string>();
  const lines: string[] = [];
  const io: CliIo = {
    readText: (path) => (path in files ? Promise.resolve(files[path] ?? "") : Promise.reject(new Error(`ENOENT ${path}`))),
    writeText: (path, text) => {
      written.set(path, text);
      return Promise.resolve();
    },
    log: (line) => lines.push(line),
    apiKey: apiKey ?? undefined,
    createLlm: () => new FakeLlmClient(happy),
  };
  return { io, written, lines };
}

const files = { "cv.md": "Jan. Java, Spring.", "oferta.md": "Junior Java" };
const args = ["--cv", "cv.md", "--offer", "oferta.md"];

describe("CLI", () => {
  it("prowadzi rozprawe, pokazuje przebieg i zapisuje dziennik, koszty i nagranie", async () => {
    const { io, written, lines } = memory(files);
    expect(await main(args, io)).toBe(0);
    expect(lines[0]).toMatch(/^\[wniesienie\] rozprawa .+, rund debaty: 1$/);
    expect(lines.some((l) => l.startsWith("[werdykt] ZAPROSIC NA ROZMOWE (srednia 6.5) — Zapraszamy"))).toBe(true);
    expect(lines.at(-1)).toMatch(/^Koszt: \$\d+\.\d{4} za 12 wywolan \(nieudanych: 0\)$/);
    expect([...written.keys()]).toEqual([join("out", "events.json"), join("out", "calls.json"), join("out", "cassette.json")]);
    expect(JSON.parse(written.get(join("out", "events.json")) ?? "[]")).toHaveLength(13);
  });

  it("odtwarza nagranie bez klucza: ten sam werdykt, bez nowego nagrania", async () => {
    const first = memory(files);
    await main([...args, "--out", "nagranie"], first.io);
    const cassette = first.written.get(join("nagranie", "cassette.json")) ?? "";
    const { io, written, lines } = memory({ ...files, "kaseta.json": cassette }, null);
    expect(await main([...args, "--replay", "kaseta.json"], io)).toBe(0);
    expect(lines.filter((l) => l.startsWith("[werdykt]"))).toEqual(first.lines.filter((l) => l.startsWith("[werdykt]")));
    expect(written.has(join("out", "cassette.json"))).toBe(false);
  });

  it("za maly budzet przerywa rozprawe i konczy kodem 1", async () => {
    const { io, lines } = memory(files);
    expect(await main([...args, "--budget-usd", "0.0001"], io)).toBe(1);
    expect(lines.some((l) => l.startsWith("[przerwano] Budzet $0.0001"))).toBe(true);
  });

  it("bez klucza i bez nagrania mowi, co zrobic", async () => {
    const { io, lines } = memory(files, null);
    expect(await main(args, io)).toBe(2);
    expect(lines).toEqual(["Brak ANTHROPIC_API_KEY (w srodowisku albo w pliku .env). Bez klucza mozna odtworzyc nagranie: --replay."]);
  });

  it.each([
    ["brak --cv", ["--offer", "oferta.md"]],
    ["brak --offer", ["--cv", "cv.md"]],
    ["rundy nie sa liczba", [...args, "--rounds", "dwie"]],
    ["budzet zero", [...args, "--budget-usd", "0"]],
    ["budzet nie jest liczba", [...args, "--budget-usd", "duzo"]],
  ])("bledne wywolanie (%s) pokazuje sposob uzycia", async (_, argv) => {
    const { io, lines } = memory(files);
    expect(await main(argv, io)).toBe(2);
    expect(lines).toEqual([USAGE]);
  });

  it("nieznana opcja: komunikat parsera i sposob uzycia", async () => {
    const { io, lines } = memory(files);
    expect(await main([...args, "--glosno"], io)).toBe(2);
    expect(lines[0]).toMatch(/--glosno[\s\S]*Uzycie: pnpm trial/);
  });
});
