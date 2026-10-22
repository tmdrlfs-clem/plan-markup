// Story 3.4: the Thumbnails panel on the committed multi-page fixture
// (fixtures/pdf/multi-page.pdf: page 1 has a title block with S-101 and no page
// label, pages 2 and 3 carry FP-201 and "FP-202 - SPRINKLER LAYOUT", page 4 is
// plain). Alt+T, the empty state, all four thumbnails with their labels, the
// current-page highlight following the pager, click and keyboard navigation.
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./helpers";

const PDF = path.join(__dirname, "..", "fixtures", "pdf", "multi-page.pdf");

const canvas = (page: Page) => page.getByTestId("drawing-canvas");
const panel = (page: Page) => page.getByRole("complementary", { name: "Thumbnails" });
const list = (page: Page) => panel(page).getByRole("listbox", { name: "Page thumbnails" });
const thumb = (page: Page, name: string) => list(page).getByRole("option", { name, exact: true });
const pageInput = (page: Page) => page.getByRole("group", { name: "Pages" }).getByRole("textbox", { name: "Page number" });

/** The option the list's active descendant points at. */
async function activeName(page: Page): Promise<string | null> {
  const id = await list(page).getAttribute("aria-activedescendant");
  return id ? page.locator(`[id="${id}"]`).getAttribute("aria-label") : null;
}

test("Thumbnails panel: empty state, labelled thumbnails, current-page highlight, click and keys navigate", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await context.newPage();
  await page.goto("/sign-in");
  await signIn(page, "admin@plan-markup.test");
  await expect(page).toHaveURL("/workspace");

  // Alt+T with no drawing: the registry's empty text, no list.
  await page.keyboard.press("Alt+KeyT");
  await expect(panel(page)).toContainText("No drawing open");
  await expect(list(page)).toHaveCount(0);

  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("toolbar", { name: "Document" }).getByRole("button", { name: "Open…" }).click();
  await (await chooser).setFiles({ name: "multi-page.pdf", mimeType: "application/pdf", buffer: readFileSync(PDF) });
  await expect(canvas(page)).toHaveAttribute("data-state", "ready");

  // Four thumbnails render, named with the page number and sheet label (page 1's is detected from its text).
  const names = ["Page 1, S-101", "Page 2, FP-201", "Page 3, FP-202", "Page 4"];
  await expect(list(page).getByRole("option")).toHaveCount(4);
  for (const name of names) await expect(thumb(page, name)).toHaveAttribute("data-state", "ready", { timeout: 15_000 });
  await expect(thumb(page, "Page 1, S-101")).toHaveAttribute("aria-current", "page");
  await expect(thumb(page, "Page 3, FP-202")).toContainText("FP-202");

  // The highlight follows the pager.
  await page.getByRole("group", { name: "Pages" }).getByRole("button", { name: "Next page" }).click();
  await expect(thumb(page, "Page 2, FP-201")).toHaveAttribute("aria-current", "page");
  await expect(thumb(page, "Page 1, S-101")).not.toHaveAttribute("aria-current", "page");

  // A click navigates.
  await thumb(page, "Page 4").click();
  await expect(pageInput(page)).toHaveValue("4");
  await expect(thumb(page, "Page 4")).toHaveAttribute("aria-current", "page");
  await expect(canvas(page)).toHaveAttribute("data-state", "ready");

  // Keys move the focus within the list (one tab stop); Enter / Space navigate.
  await expect(list(page)).toBeFocused();
  await page.keyboard.press("Home");
  expect(await activeName(page)).toBe("Page 1, S-101");
  await expect(pageInput(page)).toHaveValue("4"); // moving the focus does not navigate
  await page.keyboard.press("Enter");
  await expect(pageInput(page)).toHaveValue("1");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  expect(await activeName(page)).toBe("Page 3, FP-202");
  await page.keyboard.press("Space");
  await expect(pageInput(page)).toHaveValue("3");
  // The page keys are the list's here, not the canvas's.
  await page.keyboard.press("End");
  expect(await activeName(page)).toBe("Page 4");
  await page.keyboard.press("PageUp");
  await expect(pageInput(page)).toHaveValue("3");
  await context.close();
});
