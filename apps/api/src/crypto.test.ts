import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { DecryptionError, newKey, open, parseMasterKey, seal } from "./crypto.js";

const text = (s: string) => Buffer.from(s, "utf8");

describe("seal/open", () => {
  it("odszyfrowuje to, co zaszyfrowal, dla dowolnych danych (wlasciwosc)", () => {
    const key = newKey();
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 500 }), fc.string(), (bytes, context) => {
        expect(open(key, seal(key, Buffer.from(bytes), context), context)).toEqual(Buffer.from(bytes));
      }),
    );
  });

  it("szyfrogram nie zawiera tresci, a ta sama tresc szyfruje sie za kazdym razem inaczej", () => {
    const key = newKey();
    const a = seal(key, text("Anna Nowak, Java"), "t:1");
    expect(a.includes(text("Anna"))).toBe(false);
    expect(a.equals(seal(key, text("Anna Nowak, Java"), "t:1"))).toBe(false);
    expect(a).toHaveLength(12 + 16 + 16);
  });

  it("inny klucz, inny kontekst albo zmieniony bajt -> DecryptionError", () => {
    const key = newKey();
    const sealed = seal(key, text("CV"), "t:1");
    expect(() => open(newKey(), sealed, "t:1")).toThrow(DecryptionError);
    expect(() => open(key, sealed, "t:2")).toThrow(DecryptionError);
    for (const index of [0, 12, sealed.length - 1]) {
      const tampered = Buffer.from(sealed);
      tampered[index] = (tampered[index] ?? 0) ^ 1;
      expect(() => open(key, tampered, "t:1")).toThrow("Nie mozna odszyfrowac: zly klucz albo zmieniona tresc");
    }
  });

  it("za krotki szyfrogram (bez iv i tagu) -> DecryptionError", () => {
    expect(() => open(newKey(), Buffer.alloc(27), "t")).toThrow(new DecryptionError("Szyfrogram za krotki"));
    // Pusta tresc: dokladnie iv + tag, to jeszcze poprawny szyfrogram.
    const key = newKey();
    expect(open(key, seal(key, Buffer.alloc(0), "t"), "t")).toHaveLength(0);
  });
});

describe("parseMasterKey", () => {
  it("przyjmuje 32 bajty w base64", () => {
    const key = newKey();
    expect(parseMasterKey(key.toString("base64"))).toEqual(key);
  });

  it.each([16, 31, 33])("odrzuca %i bajtow", (length) => {
    expect(() => parseMasterKey(Buffer.alloc(length).toString("base64"))).toThrow(
      `Klucz glowny musi miec 32 bajty w base64, ma ${String(length)}`,
    );
  });
});
