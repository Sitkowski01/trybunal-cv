import { describe, expect, it, vi } from "vitest";
import { ApiError, createApi, type FilingInput, formOf } from "./client.js";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const input: FilingInput = { cv: { kind: "text", text: "Java, Spring" }, jobOffer: "Junior Java", debateRounds: 2 };

function api(response: Response | Error) {
  const fetchFn = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(() => (response instanceof Error ? Promise.reject(response) : Promise.resolve(response)));
  return { fetchFn, api: createApi(fetchFn) };
}

describe("formOf", () => {
  it("CV jako tekst, liczba rund jako tekst, bez pustego imienia", () => {
    const form = formOf({ ...input, candidateName: "   " });
    expect([...form.entries()]).toEqual([
      ["cvText", "Java, Spring"],
      ["jobOffer", "Junior Java"],
      ["debateRounds", "2"],
    ]);
  });

  it("CV jako plik w polu cv; imie przyciete", () => {
    const form = formOf({ ...input, cv: { kind: "pdf", file: new Blob(["%PDF"], { type: "application/pdf" }) }, candidateName: " Anna Nowak " });
    expect(form.get("cvText")).toBeNull();
    expect(form.get("cv")).toBeInstanceOf(File);
    expect((form.get("cv") as File).name).toBe("cv.pdf");
    expect(form.get("candidateName")).toBe("Anna Nowak");
  });
});

describe("createApi", () => {
  it("wniesienie: POST formularza na /api/trials, odpowiedz sprawdzona schematem", async () => {
    const { api: client, fetchFn } = api(json(202, { trialId: "t-1", anonymized: { email: 1 }, eventsUrl: "/trials/t-1/events" }));
    expect(await client.file(input)).toEqual({ trialId: "t-1", anonymized: { email: 1 } });
    const [url, init] = fetchFn.mock.calls[0] ?? [];
    expect(url).toBe("/api/trials");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBeInstanceOf(FormData);
  });

  it("400: komunikat i lista problemow z serwera", async () => {
    const { api: client } = api(json(400, { error: "Niepoprawne dane", problems: ["jobOffer: za krotkie"] }));
    const error = await client.file(input).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toHaveProperty("name", "ApiError");
    expect(error).toMatchObject({ status: 400, message: "Niepoprawne dane", problems: ["jobOffer: za krotkie"] });
  });

  it("blad bez listy problemow i odpowiedz nie-JSON (np. z proxy)", async () => {
    await expect(api(json(429, { error: "Za duzo" })).api.file(input)).rejects.toMatchObject({ status: 429, message: "Za duzo", problems: [] });
    const html = new Response("<html>502</html>", { status: 502 });
    await expect(api(html).api.file(input)).rejects.toMatchObject({ status: 502, message: "Serwer odpowiedzial kodem 502" });
  });

  it("brak polaczenia: status 0", async () => {
    await expect(api(new TypeError("Failed to fetch")).api.file(input)).rejects.toMatchObject({ status: 0, message: "Brak polaczenia z serwerem" });
  });

  it("sukces z nieczytelna odpowiedzia to blad, a nie pusta rozprawa", async () => {
    await expect(api(json(202, { trialId: "" })).api.file(input)).rejects.toMatchObject({ status: 202, message: "Serwer przyjal sprawe, ale odpowiedz jest nieczytelna" });
    await expect(api(new Response("ok", { status: 202 })).api.file(input)).rejects.toThrow("nieczytelna");
  });

  it("anulowanie i zapomnienie: metoda i adres z zakodowanym id", async () => {
    const { api: client, fetchFn } = api(new Response(null, { status: 204 }));
    await client.cancel("t/1");
    await client.forget("t/1");
    expect(fetchFn.mock.calls.map(([url, init]) => [url, init?.method])).toEqual([
      ["/api/trials/t%2F1/cancel", "POST"],
      ["/api/trials/t%2F1", "DELETE"],
    ]);
  });

  it("anulowanie zakonczonej rozprawy: 409 jako ApiError", async () => {
    await expect(api(json(409, { error: "Rozprawa juz sie zakonczyla" })).api.cancel("t-1")).rejects.toMatchObject({ status: 409 });
  });

  it("adres strumienia i inny prefiks API", () => {
    expect(createApi(vi.fn()).eventsUrl("t 1")).toBe("/api/trials/t%201/events");
    expect(createApi(vi.fn(), "http://localhost:3000").eventsUrl("t-1")).toBe("http://localhost:3000/trials/t-1/events");
  });
});
