import { expect, test } from "@playwright/test";

// Demo bez serwera: statyczne pliki, nagranie rozprawy w paczce. Zadne zapytanie nie wychodzi do API.

test("demo: strona startowa, odtworzenie nagrania do werdyktu, bez zadnego zapytania do API", async ({ page }) => {
  const apiCalls: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/")) apiCalls.push(request.url());
  });
  // Tempo 20: rozprawa w kilka sekund zamiast minuty.
  await page.goto("?tempo=20");
  await expect(page.getByText("Demo — odtwarzanie nagranej rozprawy")).toBeVisible();
  await expect(page.getByRole("button", { name: "Wnieś sprawę" })).toHaveCount(0);
  await page.getByText("CV kandydatki").click();
  await expect(page.getByText("Anna Nowak").first()).toBeVisible();

  await page.getByRole("button", { name: "Otwórz rozprawę" }).click();
  await expect(page).toHaveURL(/rozprawa=nagranie/u);
  await expect(page.getByRole("status")).toHaveText("Werdykt ogłoszony.", { timeout: 15_000 });
  await expect(page.getByRole("heading", { name: /Zaprosić|Odrzucić/u })).toBeVisible();
  await expect(page.locator(".trial__cost")).not.toHaveText("Koszt: $0.0000");
  // Nagranie ma dane po anonimizacji: imie i nazwisko kandydatki nie trafilo do sadu.
  await expect(page.locator("main")).not.toContainText("Anna Nowak");
  expect(apiCalls).toEqual([]);
});

test("demo: odswiezenie odtwarza rozprawe od poczatku; przerwanie konczy ja jak na serwerze", async ({ page }) => {
  await page.goto("?rozprawa=nagranie");
  await expect(page.getByRole("status")).toContainText(/Krytycy czytają akta|Łączenie/u);
  await page.getByRole("button", { name: "Przerwij rozprawę" }).click();
  await expect(page.getByText("Rozprawa anulowana").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Przerwij rozprawę" })).toHaveCount(0);

  await page.reload();
  await expect(page.getByRole("button", { name: "Przerwij rozprawę" })).toBeVisible();
  await page.getByRole("button", { name: "Nowa sprawa" }).click();
  await expect(page.getByRole("heading", { name: "Demo: nagrana rozprawa" })).toBeVisible();
});

test("demo: nieznana rozprawa w adresie — komunikat zamiast pustej sali", async ({ page }) => {
  await page.goto("?rozprawa=cudza");
  await expect(page.getByRole("alert")).toContainText("Nie mozna polaczyc sie z rozprawa");
});
