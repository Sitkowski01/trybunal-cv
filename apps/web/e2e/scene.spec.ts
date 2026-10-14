import { expect, type Page, test } from "@playwright/test";
import { SCENE } from "./servers.js";

// Sala 3D w prawdziwej przegladarce z WebGL: modele sie wczytuja, rezyser prowadzi kamere
// za mowca, dymek pokazuje wypowiedz, a na koncu jest tabliczka werdyktu. Bledy na stronie = porazka.

async function fileExample(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Wczytaj przykład" }).click();
  await page.getByLabel("Rundy debaty").selectOption("1");
  await page.getByRole("button", { name: "Wnieś sprawę" }).click();
}

const collectErrors = (page: Page) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return errors;
};

// Wolna proba generalna (1,5 s na odpowiedz, jak prawdziwy model): kamera zdazy dojechac do mowcy.
test.use({ baseURL: `http://127.0.0.1:${String(SCENE.web)}` });
// Szeregowo: dwie sceny naraz na WebGL bez karty graficznej odbieraja sobie procesor.
test.describe.configure({ timeout: 120_000, mode: "serial" });

// Zapisujemy w przegladarce kazda zmiane ujecia i mowcy, a na koncu sprawdzamy cala historie —
// sprawdzanie stanu w trakcie mogloby przegapic krotkie ujecie, gdy strona sklada kilka zdarzen naraz.
const recordDirection = () => {
  const history: string[] = [];
  Object.assign(window, { sceneHistory: history });
  new MutationObserver(() => {
    const scene = document.querySelector(".scene");
    if (scene === null) return;
    const bubble = scene.querySelector(".scene__bubble")?.textContent ?? "";
    const entry = `${scene.getAttribute("data-shot") ?? ""}:${scene.getAttribute("data-speaker") ?? ""}:${bubble === "" ? "-" : "dymek"}`;
    if (history.at(-1) !== entry) history.push(entry);
  }).observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
};

const historyOf = (page: Page) => page.evaluate(() => (window as unknown as { sceneHistory: string[] }).sceneHistory);

test("sala 3D w ruchu: plotno rysuje, dymek nad mowca, na koncu sedzia i werdykt", async ({ page }) => {
  const errors = collectErrors(page);
  await page.addInitScript(recordDirection);
  await fileExample(page);
  const scene = page.locator(".scene");
  await expect(scene.locator("canvas")).toBeVisible({ timeout: 90_000 });
  await expect(scene).toHaveAttribute("data-verdict", "invite", { timeout: 90_000 });
  await expect(scene.locator(".scene__verdict")).toHaveText("ZAPROSIĆ");
  // Pierwsze wczytanie modeli na programowym WebGL potrafi na chwile zatrzymac strone i React sklada kilka
  // zdarzen naraz — dlatego tu tylko: byl dymek w debacie i koniec u sedziego.
  const history = await historyOf(page);
  expect(history.some((entry) => /^(jury|prosecutor):\w+:dymek$/u.test(entry))).toBe(true);
  expect(history.at(-1)).toBe("judge::-");
  // Plotno naprawde cos narysowalo: zrzut nie jest jednolitym kolorem.
  const shot = await scene.locator("canvas").screenshot();
  expect(new Set(shot.subarray(shot.length / 2, shot.length / 2 + 4000)).size).toBeGreaterThan(10);
  expect(errors).toEqual([]);
});

test("bez ruchu (prefers-reduced-motion): kazdy mowca po kolei, potem werdykt; sale da sie schowac", async ({ page }) => {
  const errors = collectErrors(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(recordDirection);
  await fileExample(page);
  const scene = page.locator(".scene");
  await expect(scene).toHaveAttribute("data-verdict", "invite", { timeout: 90_000 });
  const history = await historyOf(page);
  for (const juror of ["ats", "hr", "techLead", "hiringManager"]) expect(history).toContain(`jury:${juror}:dymek`);
  expect(history).toContain("prosecutor:prosecutor:dymek");
  expect(history.at(-1)).toBe("judge::-");

  await page.getByRole("button", { name: "Ukryj salę 3D" }).click();
  await expect(scene).toHaveCount(0);
  await page.getByRole("button", { name: "Pokaż salę 3D" }).click();
  await expect(page.locator(".scene")).toHaveAttribute("data-verdict", "invite");
  expect(errors).toEqual([]);
});
