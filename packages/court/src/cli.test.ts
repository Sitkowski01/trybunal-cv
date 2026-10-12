import { join } from "node:path";
import { type CriticId, MAX_CV_CHARS } from "@trybunal/domain";
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

interface Memory {
  readonly apiKey?: string | null;
  readonly makeDir?: (path: string) => Promise<void>;
  readonly signal?: AbortSignal;
}

function memory(files: Record<string, string>, options: Memory = {}) {
  const written = new Map<string, string>();
  const dirs: string[] = [];
  const lines: string[] = [];
  const llm = new FakeLlmClient(happy);
  const io: CliIo = {
    readText: (path) => (path in files ? Promise.resolve(files[path] ?? "") : Promise.reject(new Error("ENOENT"))),
    writeText: (path, text) => {
      written.set(path, text);
      return Promise.resolve();
    },
    makeDir: options.makeDir ?? ((path) => (dirs.push(path), Promise.resolve())),
    log: (line) => lines.push(line),
    apiKey: options.apiKey === null ? undefined : (options.apiKey ?? "sk-test"),
    createLlm: () => llm,
    newId: () => "t-1",
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  };
  return { io, written, dirs, lines, llm };
}

const files = { "cv.md": "Jan. Java, Spring.", "oferta.md": "Junior Java" };
const args = ["--cv", "cv.md", "--offer", "oferta.md"];
const out = (name: string, dir = "out") => join(dir, "t-1", name);

describe("CLI — rozprawa", () => {
  it("prowadzi rozprawe, pokazuje przebieg i zapisuje najpierw nagranie, potem dziennik i koszty", async () => {
    const { io, written, dirs, lines } = memory(files);
    expect(await main(args, io)).toBe(0);
    expect(dirs).toEqual([join("out", "t-1")]);
    expect(lines[0]).toBe("[wniesienie] rozprawa t-1, rund debaty: 1");
    expect(lines.some((l) => l.startsWith("[werdykt] ZAPROSIC NA ROZMOWE (srednia 6.5) — Zapraszamy"))).toBe(true);
    expect(lines.slice(-2)).toEqual([expect.stringMatching(/^Koszt: \$\d+\.\d{4} za 12 wywolan/), `Wyniki: ${join("out", "t-1")}`]);
    expect([...written.keys()]).toEqual([out("cassette.json"), out("events.json"), out("calls.json")]);
    expect(JSON.parse(written.get(out("events.json")) ?? "[]")).toHaveLength(13);
  });

  it("odtwarza nagranie bez klucza: ten sam werdykt, bez nowego nagrania", async () => {
    const first = memory(files);
    await main([...args, "--out", "nagranie"], first.io);
    const cassette = first.written.get(out("cassette.json", "nagranie")) ?? "";
    const { io, written, lines } = memory({ ...files, "kaseta.json": cassette }, { apiKey: null });
    expect(await main([...args, "--replay", "kaseta.json"], io)).toBe(0);
    expect(lines.filter((l) => l.startsWith("[werdykt]"))).toEqual(first.lines.filter((l) => l.startsWith("[werdykt]")));
    expect(written.has(out("cassette.json"))).toBe(false);
  });

  it("za maly budzet przerywa rozprawe, konczy kodem 1 i i tak zapisuje pliki", async () => {
    const { io, lines, written } = memory(files);
    expect(await main([...args, "--budget-usd", "0.0001"], io)).toBe(1);
    expect(lines.some((l) => l.startsWith("[przerwano] Budzet $0.0001"))).toBe(true);
    expect(written.has(out("events.json"))).toBe(true);
  });

  it("Ctrl+C (sygnal) konczy rozprawe jako anulowana i zapisuje nagranie", async () => {
    const controller = new AbortController();
    controller.abort();
    const { io, lines, written } = memory(files, { signal: controller.signal });
    expect(await main(args, io)).toBe(1);
    expect(lines).toContain("[przerwano] Rozprawa anulowana (zebrane oceny: 0/5)");
    expect(written.has(out("cassette.json"))).toBe(true);
  });
});

describe("CLI — bledy wywolania (kod 2, zanim cokolwiek zaplacimy)", () => {
  it.each([
    ["brak --cv", ["--offer", "oferta.md"]],
    ["brak --offer", ["--cv", "cv.md"]],
    ["puste rundy", [...args, "--rounds", " "]],
    ["budzet zero", [...args, "--budget-usd", "0"]],
    ["budzet nie jest liczba", [...args, "--budget-usd", "duzo"]],
  ])("%s: sposob uzycia", async (_, argv) => {
    const { io, lines, llm } = memory(files);
    expect(await main(argv, io)).toBe(2);
    expect(lines).toEqual([USAGE]);
    expect(llm.calls).toEqual([]);
  });

  it("nieznana opcja: komunikat parsera i sposob uzycia", async () => {
    const { io, lines } = memory(files);
    expect(await main([...args, "--glosno"], io)).toBe(2);
    expect(lines[0]).toMatch(/--glosno[\s\S]*Uzycie: pnpm trial/);
  });

  it.each([
    ["4 rundy", [...args, "--rounds", "4"], files, /^Niepoprawne dane rozprawy: debateRounds: /],
    ["rundy nie sa liczba", [...args, "--rounds", "dwie"], files, /^Niepoprawne dane rozprawy: debateRounds: /],
    ["za dlugie CV", args, { ...files, "cv.md": "x".repeat(MAX_CV_CHARS + 1) }, /^Niepoprawne dane rozprawy: cvText: /],
    ["brak pliku CV", args, { "oferta.md": "o" }, /^Nie mozna odczytac pliku CV \(cv\.md\): ENOENT$/],
    ["brak pliku oferty", args, { "cv.md": "c" }, /^Nie mozna odczytac pliku oferty \(oferta\.md\): ENOENT$/],
  ] as const)("%s: czytelny komunikat", async (_, argv, given, message) => {
    const { io, lines, llm } = memory(given);
    expect(await main([...argv], io)).toBe(2);
    expect(lines).toEqual([expect.stringMatching(message)]);
    expect(llm.calls).toEqual([]);
  });

  it.each([
    ["brak pliku", {}, /^Nie mozna odczytac pliku nagrania \(k\.json\): ENOENT$/],
    ["zly JSON", { "k.json": "{" }, /^Nagranie nie jest poprawnym JSON-em: /],
    ["zly ksztalt", { "k.json": '[{"kind":"ok"}]' }, /^Niepoprawne nagranie k\.json: 0\.label: .+; 0\.model: .+; /],
    ["nie lista", { "k.json": "{}" }, /^Niepoprawne nagranie k\.json: \(calosc\): /],
  ])("nagranie — %s", async (_, extra, message) => {
    const { io, lines } = memory({ ...files, ...extra }, { apiKey: null });
    expect(await main([...args, "--replay", "k.json"], io)).toBe(2);
    expect(lines).toEqual([expect.stringMatching(message)]);
  });

  it("bez klucza i bez nagrania mowi, co zrobic", async () => {
    const { io, lines } = memory(files, { apiKey: null });
    expect(await main(args, io)).toBe(2);
    expect(lines).toEqual(["Brak ANTHROPIC_API_KEY (w srodowisku albo w pliku .env). Bez klucza mozna odtworzyc nagranie: --replay."]);
  });

  it("katalog wynikow, ktorego nie da sie utworzyc, wychodzi przed rozprawa", async () => {
    const { io, lines, llm } = memory(files, { makeDir: () => Promise.reject(new Error("EEXIST")) });
    expect(await main(args, io)).toBe(2);
    expect(lines).toEqual([`Nie mozna utworzyc katalogu ${join("out", "t-1")}: EEXIST`]);
    expect(llm.calls).toEqual([]);
  });

  it("blad, ktory nie jest bledem wywolania, wychodzi dalej", async () => {
    const { io } = memory(files);
    const broken: CliIo = { ...io, writeText: () => Promise.reject(new Error("dysk pelny")) };
    await expect(main(args, broken)).rejects.toThrow("dysk pelny");
  });
});
