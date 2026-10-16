import { describe, expect, it } from "vitest";
import { parseSse } from "./sse.js";

describe("parseSse", () => {
  it("dzieli strumien na zdarzenia: id, typ i dane; heartbeat (komentarz) pomija", () => {
    const text = 'id: 1\nevent: TrialFiled\ndata: {"a":1}\n\n: ping\n\nevent: end\ndata: {"reason":"finished"}\n\n';
    expect(parseSse(text)).toEqual([
      { id: "1", type: "TrialFiled", data: '{"a":1}' },
      { id: null, type: "end", data: '{"reason":"finished"}' },
    ]);
  });

  it("kilka linii data laczy znakiem nowej linii; bez typu zdarzenie to message", () => {
    expect(parseSse("data: a\ndata: b\n\n")).toEqual([{ id: null, type: "message", data: "a\nb" }]);
  });

  it("konce linii CRLF i CR jak LF", () => {
    expect(parseSse("event: x\r\ndata: 1\r\n\r\nevent: y\rdata: 2\r\r")).toEqual([
      { id: null, type: "x", data: "1" },
      { id: null, type: "y", data: "2" },
    ]);
  });

  it("odcina tylko jedna spacje po dwukropku; bez spacji wartosc tez dziala", () => {
    expect(parseSse("data:bez\n\ndata:  dwie\n\n").map((f) => f.data)).toEqual(["bez", " dwie"]);
  });

  it("pole bez dwukropka ma pusta wartosc; nieznane pola pomija", () => {
    expect(parseSse("retry: 100\nfoo: bar\ndata\n\n")).toEqual([{ id: null, type: "message", data: "" }]);
  });

  it("dwukropek w wartosci zostaje (JSON)", () => {
    expect(parseSse('data: {"k":"v:w"}\n\n')[0]?.data).toBe('{"k":"v:w"}');
  });

  it("zdarzenie bez data pomija, a id i typ nie przechodza na nastepne", () => {
    expect(parseSse("id: 5\nevent: pusty\n\ndata: x\n\n")).toEqual([{ id: null, type: "message", data: "x" }]);
  });

  it("niedokonczone ostatnie zdarzenie (bez pustej linii) odrzuca jak przegladarka", () => {
    expect(parseSse("data: a\n\ndata: urwane")).toEqual([{ id: null, type: "message", data: "a" }]);
    expect(parseSse("")).toEqual([]);
  });
});
