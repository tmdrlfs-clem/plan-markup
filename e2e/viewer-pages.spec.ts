// Story 3.3: page pager and page keys on the committed multi-page fixture
// (fixtures/pdf/multi-page.pdf: page 1 has a title block with S-101 and no page
// label, pages 2 and 3 carry the labels FP-201 and "FP-202 - SPRINKLER LAYOUT",
// page 4 is plain). Pager buttons, keys with canvas focus, the input's silent
// revert, the single-page disabled state and the live-region text.
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Browser, type BrowserContextOptions, type Page } from "@playwright/test";
import { signIn } from "./helpers";

const ADMIN = "admin@plan-markup.test";
const PDF_DIR = path.join(__dirname, "..", "fixtures", "pdf");

test.describe.configure({ mode: "serial" });

let storageState: BrowserContextOptions["storageState"];

async function openDrawing(browser: Browser, file = "multi-page.pdf"): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, storageState });
  const page = await context.newPage();
  if (!storageState) {
    await page.goto("/sign-in");
    await signIn(page, ADMIN);
    await expect(page).toHaveURL("/workspace");
    storageState = await context.storageState();
  } else {
    await page.goto("/workspace");
  }
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("toolbar", { name: "Document" }).getByRole("button", { name: "Open…" }).click();
  await (await chooser).setFiles({ name: file, mimeType: "application/pdf", buffer: readFileSync(path.join(PDF_DIR, file)) });
  await expect(canvas(page)).toHaveAttribute("data-state", "ready");
  return page;
}

const canvas = (page: Page) => page.getByTestId("drawing-canvas");
const pager = (page: Page) => page.getByRole("group", { name: "Pages" });
const pageInput = (page: Page) => pager(page).getByRole("textbox", { name: "Page number" });
const arrow = (page: Page, name: string) => pager(page).getByRole("button", { name });
const live = (page: Page) => page.getByTestId("status-announcement");

/** The page shown, as the pager, the canvas label and the live region report it. */
async function expectPage(page: Page, n: number, label: string | null) {
  await expect(pageInput(page)).toHaveValue(String(n));
  const suffix = label ? `, ${label}` : "";
  await expect(live(page)).toHaveText(`Page ${n} of 4${suffix}`);
  await expect(canvas(page)).toHaveAttribute("aria-label", `Drawing canvas, page ${n} of 4${suffix}`);
  if (label) await expect(pager(page).getByTestId("sheet-label")).toHaveText(label);
  else await expect(pager(page).getByTestId("sheet-label")).toHaveCount(0);
  await expect(canvas(page)).toHaveAttribute("data-state", "ready");
}

const zoomOf = async (page: Page) => Number(((await canvas(page).getAttribute("data-view")) ?? "").split(" ")[0]);

test("pager buttons and page keys move between pages; each page keeps its view", async ({ browser }) => {
  const page = await openDrawing(browser);
  await expect(pager(page)).toContainText("/ 4");
  // Page 1 has no page label: the sheet number is detected from its title block.
  await expectPage(page, 1, "S-101");
  await expect(arrow(page, "First page")).toHaveAttribute("aria-disabled", "true");
  await expect(arrow(page, "Previous page")).toHaveAttribute("aria-disabled", "true");

  await arrow(page, "Next page").click();
  await expectPage(page, 2, "FP-201");
  await arrow(page, "Last page").click();
  await expectPage(page, 4, null);
  await expect(arrow(page, "Next page")).toHaveAttribute("aria-disabled", "true");
  await expect(arrow(page, "Last page")).toHaveAttribute("aria-disabled", "true");
  await arrow(page, "First page").click();
  await expectPage(page, 1, "S-101");

  // Keys need the canvas focus.
  await canvas(page).focus();
  await page.keyboard.press("PageDown");
  await expectPage(page, 2, "FP-201");
  await page.keyboard.press("Control+ArrowRight");
  await expectPage(page, 3, "FP-202"); // "FP-202 - SPRINKLER LAYOUT" shows its sheet number
  await page.keyboard.press("Control+ArrowLeft");
  await expectPage(page, 2, "FP-201");
  await page.keyboard.press("End");
  await expectPage(page, 4, null);
  await page.keyboard.press("PageDown"); // at the end: nothing
  await page.waitForTimeout(200);
  await expectPage(page, 4, null);
  await page.keyboard.press("Home");
  await expectPage(page, 1, "S-101");
  await page.keyboard.press("PageUp"); // at the start: nothing
  await page.waitForTimeout(200);
  await expectPage(page, 1, "S-101");

  // Per-page view: zoom page 1, visit page 2 (fit page), come back to the zoomed view.
  const fit1 = await zoomOf(page);
  await page.keyboard.press("+");
  await expect.poll(() => zoomOf(page)).toBeCloseTo(fit1 * Math.SQRT2, 6);
  const zoomed = await zoomOf(page);
  await page.keyboard.press("PageDown");
  await expectPage(page, 2, "FP-201");
  expect(await zoomOf(page)).not.toBeCloseTo(zoomed, 3);
  await page.keyboard.press("PageUp");
  await expectPage(page, 1, "S-101");
  expect(await zoomOf(page)).toBeCloseTo(zoomed, 6);

  // Rapid repeats: only the last page renders fully.
  await page.keyboard.press("PageDown");
  await page.keyboard.press("PageDown");
  await page.keyboard.press("PageDown");
  await expectPage(page, 4, null);
  await page.context().close();
});

test("the page input: Enter and blur commit, invalid text reverts silently, Escape returns to the canvas", async ({ browser }) => {
  const page = await openDrawing(browser);
  await expectPage(page, 1, "S-101");
  const input = pageInput(page);

  await input.fill("3");
  await input.press("Enter");
  await expectPage(page, 3, "FP-202");

  for (const bad of ["9", "0", "abc"]) {
    await input.fill(bad);
    await input.press("Enter");
    await expect(input).toHaveValue("3");
  }
  await expect(page.getByRole("alert").filter({ hasText: /\S/ })).toHaveCount(0); // (Next's route announcer is an empty alert)
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await input.fill("2");
  await input.blur();
  await expectPage(page, 2, "FP-201");

  await input.fill("4");
  await input.press("Escape");
  await expect(input).toHaveValue("2");
  await expect(canvas(page)).toBeFocused();

  // A page label typed exactly navigates too.
  await input.fill("FP-202");
  await input.press("Enter");
  await expectPage(page, 3, "FP-202");

  // Ctrl+arrows inside the field stay text navigation.
  await input.focus();
  await page.keyboard.press("Control+ArrowRight");
  await page.keyboard.press("End");
  await expect(input).toHaveValue("3");
  await expect(live(page)).toHaveText("Page 3 of 4, FP-202");
  await page.context().close();
});

test("a single-page drawing disables every arrow and the page keys do nothing", async ({ browser }) => {
  const page = await openDrawing(browser, "vector-a3.pdf");
  await expect(pager(page)).toContainText("/ 1");
  await expect(pageInput(page)).toHaveValue("1");
  for (const name of ["First page", "Previous page", "Next page", "Last page"]) {
    await expect(arrow(page, name)).toHaveAttribute("aria-disabled", "true");
  }
  await expect(live(page)).toHaveText("Page 1 of 1");
  await canvas(page).focus();
  await page.keyboard.press("PageDown");
  await page.keyboard.press("End");
  await page.waitForTimeout(200);
  await expect(pageInput(page)).toHaveValue("1");
  await page.context().close();
});
