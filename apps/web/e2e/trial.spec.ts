import { expect, type Page, test } from "@playwright/test";
import { PDFDocument, StandardFonts } from "pdf-lib";

// Cala sciezka: przegladarka -> formularz -> POST /trials -> rozprawa w tle -> SSE -> widok.
// API w trybie proby generalnej: odpowiedzi stale (Tech Lead zmienia zdanie, Hiring Manager
// poprawia pierwsza linie CV), wiec werdykt jest znany z gory.

const status = (page: Page) => page.getByRole("status");

async function fileExample(page: Page, rounds = "1") {
  await page.goto("/");
  await page.getByRole("button", { name: "Wczytaj przykład" }).click();
  await page.getByLabel("Rundy debaty").selectOption(rounds);
  await page.getByRole("button", { name: "Wnieś sprawę" }).click();
  await expect(page).toHaveURL(/\?rozprawa=[\w-]+$/u);
}

test("pelna rozprawa nad przykladowym CV: fazy na zywo, werdykt, poprawka jako diff", async ({ page }) => {
  await fileExample(page);
  await expect(page.getByText("Przed rozprawą ukryto dane osobowe: imię i nazwisko ×1.")).toBeVisible();
  // Przegladarka bez WebGL (projekt "app"): sali 3D nie ma, cala rozprawa jest w widoku 2D.
  await expect(page.getByRole("region", { name: "Sala rozpraw" })).toHaveCount(0);
  // Na zywo: krytycy czytaja akta, potem debata z mowca.
  await expect(status(page)).toContainText(/Krytycy czytają akta|Prokurator/u);
  await expect(status(page)).toContainText("Debata, runda 1 z 1 — mówi");
  await expect(page.locator('[data-critic="ats"]')).toContainText("7/10");

  await expect(status(page)).toHaveText("Werdykt ogłoszony.", { timeout: 15_000 });
  await expect(page.getByRole("heading", { name: "Zaprosić" })).toBeVisible();
  await expect(page.getByText("Zmiana zdania w debacie: Tech Lead 5→6")).toBeVisible();
  await expect(page.getByText("Ocena 6 na 10, zmieniona z 5")).toBeAttached();

  const report = page.getByRole("region", { name: "Uzasadnienie na piśmie" });
  await expect(report.locator(".diff ins")).toHaveText(" (wynik: czas odpowiedzi API krótszy o 40%)");
  await expect(report.getByText("Brak projektu, który to potwierdza.")).toBeVisible();
  // Imie i nazwisko z formularza nie dotarlo do sadu ani do cytatow.
  await expect(page.getByText("[KANDYDAT]").first()).toBeVisible();
  await expect(page.locator("main")).not.toContainText("Anna Nowak");
});

test("CV jako PDF: serwer wyciaga tekst, rozprawa bez debaty", async ({ page }) => {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.addPage().drawText("Backend developer: Java, Spring Boot, PostgreSQL", { x: 50, y: 700, size: 14, font });
  await page.goto("/");
  await page.getByRole("radio", { name: "Plik PDF" }).check();
  await page.getByLabel("Plik PDF (maks. 2 MB)").setInputFiles({ name: "cv.pdf", mimeType: "application/pdf", buffer: Buffer.from(await pdf.save()) });
  await page.getByLabel("Treść ogłoszenia o pracę").fill("Junior Java Developer");
  await page.getByLabel("Rundy debaty").selectOption("bez debaty");
  await page.getByRole("button", { name: "Wnieś sprawę" }).click();

  await expect(status(page)).toHaveText("Werdykt ogłoszony.", { timeout: 15_000 });
  await expect(page.getByRole("list", { name: "Przebieg rozprawy" })).not.toContainText("Debata");
  await expect(page.locator(".diff")).toContainText("Backend developer: Java, Spring Boot, PostgreSQL");
});

test("odswiezenie strony w trakcie: rozprawa odtworzona ze strumienia i dokonczona", async ({ page }) => {
  await fileExample(page, "2");
  await expect(page.locator('[data-critic="hr"]')).toContainText("6/10");
  await page.reload();
  await expect(page.locator('[data-critic="hr"]')).toContainText("6/10");
  await expect(status(page)).toHaveText("Werdykt ogłoszony.", { timeout: 20_000 });
  await expect(page.getByRole("heading", { name: "Debata — runda 2" })).toBeVisible();
});

test("przerwanie rozprawy przyciskiem", async ({ page }) => {
  await fileExample(page, "3");
  await page.getByRole("button", { name: "Przerwij rozprawę" }).click();
  await expect(status(page)).toContainText("Rozprawa przerwana:");
  // Os faz pokazuje, dokad rozprawa doszla, a nie wraca do poczatku.
  await expect(page.getByRole("list", { name: "Przebieg rozprawy" })).toContainText("(tu przerwano)");
  await expect(page.getByRole("button", { name: "Przerwij rozprawę" })).toBeHidden();
  await expect(page.getByRole("heading", { name: /Zaprosić|Odrzucić/u })).toBeHidden();
});

test("zapomnienie rozprawy: dane usuniete, link juz nie dziala", async ({ page }) => {
  await fileExample(page, "bez debaty");
  await expect(status(page)).toHaveText("Werdykt ogłoszony.", { timeout: 15_000 });
  const url = page.url();
  await page.getByRole("button", { name: "Zapomnij rozprawę (usuń dane)" }).click();
  await expect(page.getByText(/^Rozprawa zapomniana/u)).toBeVisible();
  await page.goto(url);
  // Przegladarka probuje jeszcze 3 razy (1 + 2 + 4 s), zanim uzna polaczenie za utracone.
  await expect(page.getByRole("alert")).toContainText("Nie można połączyć się z rozprawą", { timeout: 15_000 });
  await expect(status(page)).toHaveText("Utracono połączenie z rozprawą.");
});

test("walidacja: puste pola blokuja wniesienie bez zapytania do serwera", async ({ page }) => {
  let posted = false;
  page.on("request", (request) => {
    if (request.method() === "POST") posted = true;
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Wnieś sprawę" }).click();
  await expect(page.getByRole("alert")).toContainText("Wklej treść CV.");
  expect(posted).toBe(false);
});

test("nowa sprawa i przycisk wstecz przegladarki", async ({ page }) => {
  await fileExample(page, "bez debaty");
  await page.getByRole("button", { name: "Nowa sprawa" }).click();
  await expect(page).toHaveURL(/\/$/u);
  await expect(page.getByRole("button", { name: "Wnieś sprawę" })).toBeVisible();
  await page.goBack();
  await expect(status(page)).toHaveText("Werdykt ogłoszony.", { timeout: 15_000 });
});
