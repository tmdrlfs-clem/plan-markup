// Story 6.7: the Markups List (production build in CI).
//   snap.pdf (Story 4.1): page 1 A4 landscape, a rectangle (100, 100)-(300, 250).
// Covers, at 1:100 with two lengths on the rectangle's bottom and top edges:
// the bottom panel lists both (subject, page, author, value); a click on the
// canvas marks its row; a row click selects on the canvas (Delete removes it,
// undo brings it back); Ctrl+click adds; the keyboard moves and selects;
// double-click zooms to the markup; Alt+L hides and shows the list. Story 6.8:
// the quick filter (no match → Clear filters), a Type filter chip, the count
// and a header sort.
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./helpers";

const PDF = path.join(__dirname, "..", "fixtures", "pdf", "snap.pdf");
const A4_HEIGHT = 595;
const BOTH = "7056 mm | 7056 mm";

const canvas = (page: Page) => page.getByTestId("drawing-canvas");
const markups = (page: Page) => page.getByTestId("markups-canvas");
const scale = (page: Page) => page.getByTestId("status-bar").getByTestId("status-scale");
const calibrate = (page: Page) => page.getByRole("dialog", { name: "Calibrate" });
const rows = (page: Page) => page.getByTestId("markups-list-row");
const grid = (page: Page) => page.getByRole("grid", { name: "Markups" });

async function open(page: Page) {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("toolbar", { name: "Document" }).getByRole("button", { name: "Open…" }).click();
  await (await chooser).setFiles({ name: "snap.pdf", mimeType: "application/pdf", buffer: readFileSync(PDF) });
  await expect(canvas(page)).toHaveAttribute("data-state", "ready");
  await expect(canvas(page)).toHaveAttribute("data-snap-index", /^\d+$/, { timeout: 20_000 });
}

/** Screen position of user space point (x, y) on the unrotated A4 page (box at the origin, view rotation 0). */
async function screenOf(page: Page, x: number, y: number) {
  const box = (await canvas(page).boundingBox())!;
  const [zoom, cx, cy] = ((await canvas(page).getAttribute("data-view")) ?? "").split(" ").map(Number);
  return { x: box.x + box.width / 2 + (x - cx) * zoom, y: box.y + box.height / 2 + (A4_HEIGHT - y - cy) * zoom };
}

/** Waits until the canvas stops moving or resizing (panels and the HintBar shift it) and its view is stable. */
async function stable(page: Page) {
  let last = "";
  await expect
    .poll(async () => {
      const now = `${JSON.stringify(await canvas(page).boundingBox())} ${await canvas(page).getAttribute("data-view")}`;
      const same = now === last;
      last = now;
      return same;
    }, { intervals: [100, 100, 200, 200, 400] })
    .toBe(true);
}

async function clickCorner(page: Page, x: number, y: number) {
  const at = await screenOf(page, x, y);
  await page.mouse.move(at.x, at.y);
  await expect(canvas(page)).toHaveAttribute("data-snap", /^endpoint /);
  await page.mouse.click(at.x, at.y);
}

async function clickAt(page: Page, x: number, y: number, modifiers: ("Shift" | "Alt")[] = []) {
  const at = await screenOf(page, x, y);
  for (const m of modifiers) await page.keyboard.down(m);
  await page.mouse.click(at.x, at.y);
  for (const m of modifiers) await page.keyboard.up(m);
}

async function selected(page: Page): Promise<string[]> {
  return rows(page).evaluateAll((els) => els.map((el) => el.getAttribute("aria-selected") ?? ""));
}

test("the Markups List lists, selects with the canvas, zooms and moves by keyboard", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto("/sign-in");
  await signIn(page, "admin@plan-markup.test");
  await expect(page).toHaveURL("/workspace");
  await open(page);

  // The list is in the bottom panel (Alt+L shows it when hidden).
  if (await page.getByRole("button", { name: "Expand Markups" }).isVisible()) {
    await canvas(page).focus();
    await page.keyboard.press("Alt+l");
  }
  await expect(page.getByTestId("markups-list-empty")).toBeVisible();

  // 1:100; lengths on the bottom and top edges.
  await canvas(page).focus();
  await page.keyboard.press("Alt+u");
  await scale(page).click();
  await calibrate(page).getByTestId("calibrate-ratio").fill("1:100");
  await calibrate(page).getByRole("button", { name: "Apply" }).click();
  await expect(calibrate(page)).toBeHidden();
  await canvas(page).focus();
  await page.keyboard.press("Shift+Alt+L");
  await stable(page);
  await clickCorner(page, 100, 100);
  await clickCorner(page, 300, 100);
  await clickCorner(page, 100, 250);
  await clickCorner(page, 300, 250);
  await expect(markups(page)).toHaveAttribute("data-captions", BOTH);
  await canvas(page).focus();
  await page.keyboard.press("Escape");
  await stable(page);

  await expect(rows(page)).toHaveCount(2);
  await expect(rows(page).first()).toContainText("Length");
  await expect(rows(page).first()).toContainText("Page 1");
  await expect(rows(page).first()).toContainText("7056 mm");

  // The canvas selection marks its row.
  await clickAt(page, 200, 250);
  await expect.poll(() => selected(page)).toEqual(["false", "true"]);

  // A row click selects on the canvas: Delete removes that one; undo brings it back.
  await rows(page).first().click();
  await expect.poll(() => selected(page)).toEqual(["true", "false"]);
  await canvas(page).focus();
  await page.keyboard.press("Delete");
  await expect(rows(page)).toHaveCount(1);
  await page.keyboard.press("Control+z");
  await expect(rows(page)).toHaveCount(2);

  // Ctrl+click adds.
  await rows(page).first().click();
  await rows(page).nth(1).click({ modifiers: ["Control"] });
  await expect.poll(() => selected(page)).toEqual(["true", "true"]);

  // The keyboard: Ctrl+Home, then Down selects the next row.
  await grid(page).focus();
  await page.keyboard.press("Control+Home");
  await expect.poll(() => selected(page)).toEqual(["true", "false"]);
  await page.keyboard.press("ArrowDown");
  await expect.poll(() => selected(page)).toEqual(["false", "true"]);

  // Double-click zooms to the markup.
  const before = await canvas(page).getAttribute("data-view");
  await rows(page).first().dblclick();
  await expect.poll(() => canvas(page).getAttribute("data-view")).not.toBe(before);
  await expect.poll(() => selected(page)).toEqual(["true", "false"]);

  // Alt+L hides the list and shows it again.
  await canvas(page).focus();
  await page.keyboard.press("Alt+l");
  await expect(grid(page)).toBeHidden();
  await page.keyboard.press("Alt+l");
  await expect(grid(page)).toBeVisible();

  // Story 6.8: the quick filter, column filters as chips, the count, and sorting.
  const count = page.getByTestId("markups-list-count");
  await expect(count).toHaveText("2 markups");
  const quick = page.getByRole("searchbox", { name: "Quick filter" });
  await quick.fill("zzz");
  await expect(page.getByTestId("markups-list-no-match")).toBeVisible();
  await expect(count).toHaveText("Showing 0 of 2");
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(rows(page)).toHaveCount(2);
  await quick.fill("7056");
  await expect(count).toHaveText("Showing 2 of 2");
  await page.getByRole("button", { name: "Remove quick filter" }).click();
  await page.getByRole("toolbar", { name: "Markups list filters" }).getByRole("button", { name: "Filter" }).click();
  await page.getByRole("menuitem", { name: "Type" }).click();
  await page.getByRole("menuitemcheckbox", { name: "Length" }).click();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("markups-list-chip")).toHaveText("Type: Length");
  await expect(count).toHaveText("Showing 2 of 2");
  await page.getByRole("button", { name: "Remove Type filter" }).click();
  await expect(page.getByTestId("markups-list-chip")).toHaveCount(0);
  const header = page.getByRole("columnheader", { name: "Measurement" });
  await header.getByRole("button").click();
  await expect(header).toHaveAttribute("aria-sort", "ascending");
});
