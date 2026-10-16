import { describe, expect, it } from "vitest";
import { USAGE } from "./args.js";
import { main } from "./cli.js";
import { cases, memoryIo, RUN } from "./test/memory-io.js";

describe("evals — wejscie", () => {
  it("run: wynik polecenia jako kod wyjscia", async () => {
    const { io, files } = memoryIo();
    expect(await main(["run", ...RUN, "--variants", "v1", "--repeats", "1"], io)).toBe(0);
    expect(files.has("wyniki/r1/report.md")).toBe(true);
  });

  it.each([
    ["bez polecenia", [], USAGE],
    ["nieznane polecenie", ["test"], USAGE],
    ["nieznane polecenie z argumentem", ["test", "wyniki/r1"], USAGE],
    ["raport bez katalogu", ["report"], USAGE],
    ["raport z nadmiarowym argumentem", ["report", "a", "b"], USAGE],
    ["zla opcja run", ["run", "--out", "x", "--foo"], "Unknown option '--foo'"],
  ])("bledne wywolanie (%s): kod 2 i komunikat, nic nie zapisane", async (_, argv, message) => {
    const { io, logs, dirs } = memoryIo();
    expect(await main(argv, io)).toBe(2);
    expect(logs.at(-1)).toContain(message);
    expect(dirs).toEqual([]);
  });

  it("inny blad niz wywolania nie jest polykany", async () => {
    const { io } = memoryIo({ appendText: () => Promise.reject(new Error("dysk pelny")) });
    await expect(main(["run", ...RUN], io)).rejects.toThrow("dysk pelny");
  });
});

describe("evals report", () => {
  it("odtwarza raport z zapisanych wynikow bez modelu", async () => {
    const { io, files, logs } = memoryIo();
    await main(["run", ...RUN, "--repeats", "1", "--variants", "v1"], io);
    const before = files.get("wyniki/r1/report.md");
    files.delete("wyniki/r1/report.md");
    expect(await main(["report", "wyniki/r1"], { ...io, apiKey: undefined })).toBe(0);
    expect(files.get("wyniki/r1/report.md")).toBe(before);
    expect(logs.at(-1)).toBe("Raport: wyniki/r1/report.md");
  });

  it("oczekiwane werdykty z biezacego zbioru — poprawiona etykieta bez powtarzania rozpraw", async () => {
    const { io, files, logs } = memoryIo();
    await main(["run", ...RUN, "--repeats", "1", "--variants", "v1"], io);
    expect(files.get("wyniki/r1/report.md")).toContain("| Trafność werdyktu | 100% |");
    files.set("ds/cases.json", JSON.stringify([{ ...cases[0], expected: "reject" }, cases[1]]));
    expect(await main(["report", "wyniki/r1"], io)).toBe(0);
    expect(files.get("wyniki/r1/report.md")).toContain("| Trafność werdyktu | 50% |");
    files.delete("ds/cases.json");
    expect(await main(["report", "wyniki/r1"], io)).toBe(2);
    expect(logs.at(-1)).toBe("Nie mozna wczytac zbioru ds: ENOENT ds/cases.json");
  });

  it("bez zapisanych wynikow: kod 2", async () => {
    const { io, logs } = memoryIo();
    expect(await main(["report", "pusty"], io)).toBe(2);
    expect(logs.at(-1)).toBe("pusty: brak meta.json albo outcomes.jsonl");
  });
});
