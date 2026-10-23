// Story 3.6: search text in the drawing, on the committed fixture
// fixtures/pdf/search.pdf (3 pages: page 1 has "CH +2700" twice, "SPRINKLER
// VALVE" split inside the word across two runs, "LEVEL" + "17" as two runs and
// D1 / D10; page 2 is image-only; page 3, shown rotated, has "CH +2700" and
// "SPRINKLER VALVE"). Ctrl+F, typing, counts, next / previous with wrap, page
// switches, highlights on the canvas, options, the no-text notes, Esc, F3 and
// the search kept per tab.
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./helpers";

const PDF_DIR = path.join(__dirname, "..", "fixtures", "pdf");

const canvas = (page: Page) => page.getByTestId("drawing-canvas");
const panel = (page: Page) => page.getByTestId("search-panel");
const field = (page: Page) => panel(page).getByRole("textbox", { name: "Find" });
const status = (page: Page) => panel(page).getByTestId("search-status");
const pageInput = (page: Page) => page.getByRole("group", { name: "Pages" }).getByRole("textbox", { name: "Page number" });

async function open(page: Page, file: string) {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("toolbar", { name: "Document" }).getByRole("button", { name: "Open…" }).click();
  await (await chooser).setFiles({ name: file, mimeType: "application/pdf", buffer: readFileSync(path.join(PDF_DIR, file)) });
  await expect(canvas(page)).toHaveAttribute("data-state", /^(ready|image-only)$/);
}

test("search: Ctrl+F, counts, next / previous across pages with wrap, highlights, options, no-text notes, Esc, F3, per tab", async ({
  browser,
}) => {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await context.newPage();
  await page.goto("/sign-in");
  await signIn(page, "admin@plan-markup.test");
  await expect(page).toHaveURL("/workspace");
  await open(page, "search.pdf");

  // Ctrl+F with the canvas focused opens Search with the field focused.
  await canvas(page).focus();
  await page.keyboard.press("Control+f");
  await expect(panel(page)).toBeVisible();
  await expect(field(page)).toBeFocused();
  // The scan page is summarised (the texts are read when the panel opens).
  await expect(panel(page).getByTestId("search-no-text")).toHaveText("1 page has no searchable text");

  // Typing searches every page, case-insensitively.
  await page.keyboard.type("ch +2700");
  await expect(status(page)).toHaveText("3 results on 2 pages");
  await expect(panel(page).getByTestId("search-hit")).toHaveCount(3);
  // All hits of the shown page are highlighted on the canvas.
  await expect(canvas(page)).toHaveAttribute("data-highlights", "2");

  // Enter: next, from the shown page; the current hit is emphasised.
  await page.keyboard.press("Enter");
  await expect(canvas(page)).toHaveAttribute("data-highlights", "2 current");
  await expect(panel(page).getByTestId("search-hit").nth(0)).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Enter");
  await expect(panel(page).getByTestId("search-hit").nth(1)).toHaveAttribute("aria-selected", "true");
  // The third is on page 3: the page switches.
  await page.keyboard.press("Enter");
  await expect(pageInput(page)).toHaveValue("3");
  await expect(canvas(page)).toHaveAttribute("data-highlights", "1 current");
  // Past the last: wraps to the first, quietly.
  await page.keyboard.press("Enter");
  await expect(status(page)).toContainText("Search wrapped");
  await expect(pageInput(page)).toHaveValue("1");
  // Shift+Enter: previous, wrapping back to page 3.
  await page.keyboard.press("Shift+Enter");
  await expect(pageInput(page)).toHaveValue("3");

  // A phrase split inside a word across two runs, and two runs a space apart.
  await field(page).fill("sprinkler valve");
  await expect(status(page)).toHaveText("2 results on 2 pages");
  await field(page).fill("level 17");
  await expect(status(page)).toHaveText("2 results on 1 page");
  // Whole word: D1 but not D10; Match case.
  await field(page).fill("d1");
  await expect(status(page)).toHaveText("2 results on 1 page");
  await panel(page).getByRole("button", { name: "Whole word" }).click();
  await expect(status(page)).toHaveText("1 result on 1 page");
  await panel(page).getByRole("button", { name: "Match case" }).click();
  await expect(status(page)).toHaveText("No results");
  await field(page).fill("D1");
  await expect(status(page)).toHaveText("1 result on 1 page");

  // A click on a result goes there and hands the focus to the canvas.
  await panel(page).getByTestId("search-hit").first().click();
  await expect(pageInput(page)).toHaveValue("1");
  await expect(canvas(page)).toBeFocused();
  await expect(canvas(page)).toHaveAttribute("data-highlights", "1 current");
  // F3 with the canvas focused: next (wraps on a single result).
  await page.keyboard.press("F3");
  await expect(status(page)).toContainText("Search wrapped");

  // Esc in the field: highlights off, back to the canvas.
  await field(page).focus();
  await page.keyboard.press("Escape");
  await expect(canvas(page)).toBeFocused();
  await expect(canvas(page)).not.toHaveAttribute("data-highlights");

  // Another tab: its own search (a scan: no searchable text); back: the query is still there.
  await open(page, "image-only.pdf");
  await expect(panel(page).getByTestId("search-no-text-page")).toHaveText("No searchable text on this page");
  await expect(field(page)).toHaveValue("");
  await page.getByRole("tablist", { name: "Open drawings" }).getByRole("tab", { name: "search.pdf" }).click();
  await expect(field(page)).toHaveValue("D1");

  // Closing the panel clears the highlights.
  await field(page).press("Enter");
  await expect(canvas(page)).toHaveAttribute("data-highlights", /current/);
  await page.locator("[data-panel-id='search']").click();
  await expect(panel(page)).toHaveCount(0);
  await expect(canvas(page)).not.toHaveAttribute("data-highlights");
  await context.close();
});
