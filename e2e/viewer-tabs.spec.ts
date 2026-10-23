// Story 3.5: several drawings in document tabs, on committed fixtures
// (fixtures/pdf/multi-page.pdf: 4 pages, page 1 detected as S-101;
// fixtures/pdf/vector-a3.pdf: one page). Two tabs, switching by click and by
// keys, page and zoom kept per tab, a duplicate open activating the existing
// tab, the tooltip, and closing back to the EmptyWorkspace.
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./helpers";

const PDF_DIR = path.join(__dirname, "..", "fixtures", "pdf");

const canvas = (page: Page) => page.getByTestId("drawing-canvas");
const strip = (page: Page) => page.getByRole("tablist", { name: "Open drawings" });
const tabs = (page: Page) => strip(page).getByRole("tab");
const pageInput = (page: Page) => page.getByRole("group", { name: "Pages" }).getByRole("textbox", { name: "Page number" });
const zoomOf = async (page: Page) => Number(((await canvas(page).getAttribute("data-view")) ?? "").split(" ")[0]);

async function open(page: Page, file: string) {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("toolbar", { name: "Document" }).getByRole("button", { name: "Open…" }).click();
  await (await chooser).setFiles({ name: file, mimeType: "application/pdf", buffer: readFileSync(path.join(PDF_DIR, file)) });
}

/** The active tab is `name` and its drawing is drawn. */
async function expectActive(page: Page, name: string | RegExp) {
  await expect(strip(page).getByRole("tab", { selected: true })).toHaveText(name);
  await expect(canvas(page)).toHaveAttribute("data-state", "ready");
}

test("two drawings in tabs: switch by click and keys, each keeps its page and zoom; duplicates and closing", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await context.newPage();
  await page.goto("/sign-in");
  await signIn(page, "admin@plan-markup.test");
  await expect(page).toHaveURL("/workspace");

  // First drawing: one tab, named by its detected sheet number.
  await open(page, "multi-page.pdf");
  await expectActive(page, "S-101");
  await expect(tabs(page)).toHaveCount(1);
  // Its state: page 2, zoomed in.
  await canvas(page).focus();
  await page.keyboard.press("PageDown");
  await expect(pageInput(page)).toHaveValue("2");
  await expectActive(page, "FP-201");
  const fit = await zoomOf(page);
  await page.keyboard.press("+");
  await expect.poll(() => zoomOf(page)).toBeCloseTo(fit * Math.SQRT2, 6);
  const zoomedA = await zoomOf(page);

  // Second drawing: a new tab, active, with its own state.
  await open(page, "vector-a3.pdf");
  await expectActive(page, "vector-a3.pdf");
  await expect(tabs(page)).toHaveCount(2);
  await expect(page.getByRole("contentinfo")).toContainText("vector-a3.pdf");
  await expect(pageInput(page)).toHaveValue("1");
  const zoomB = await zoomOf(page);
  expect(zoomB).not.toBeCloseTo(zoomedA, 3);

  // The tooltip names the full file.
  await tabs(page).nth(1).hover();
  await expect(page.getByRole("tooltip")).toContainText("vector-a3.pdf");

  // A click switches back: page 2 at the zoom it was left at.
  await tabs(page).nth(0).click();
  await expectActive(page, "FP-201");
  await expect(pageInput(page)).toHaveValue("2");
  expect(await zoomOf(page)).toBeCloseTo(zoomedA, 6);
  await expect(page.getByRole("contentinfo")).toContainText("multi-page.pdf");

  // Keys with the canvas focused: Ctrl+PageDown / Ctrl+PageUp (and Alt+… where the browser keeps Ctrl).
  await canvas(page).focus();
  await page.keyboard.press("Control+PageDown");
  await expectActive(page, "vector-a3.pdf");
  expect(await zoomOf(page)).toBeCloseTo(zoomB, 6);
  await page.keyboard.press("Alt+PageUp");
  await expectActive(page, "FP-201");
  await expect(pageInput(page)).toHaveValue("2");
  // In the strip, the arrow keys move between tabs.
  await tabs(page).nth(0).focus();
  await page.keyboard.press("ArrowRight");
  await expectActive(page, "vector-a3.pdf");

  // Opening a file that is already open shows its tab instead of a duplicate.
  await open(page, "multi-page.pdf");
  await expectActive(page, "FP-201");
  await expect(tabs(page)).toHaveCount(2);

  // Closing: the close button, then Ctrl+F4 with the canvas focused; the last one returns to the EmptyWorkspace.
  await strip(page).getByRole("button", { name: "Close multi-page.pdf" }).click();
  await expect(tabs(page)).toHaveCount(1);
  await expectActive(page, "vector-a3.pdf");
  await canvas(page).focus();
  await page.keyboard.press("Control+F4");
  await expect(strip(page)).toHaveCount(0);
  await expect(page.getByTestId("drop-zone")).toBeVisible();
  await expect(page.getByRole("contentinfo")).toContainText("No drawing open");
  await context.close();
});
