// Story 4.3: calibrating pages on the committed fixtures (production build in CI).
//   scales.pdf (Story 4.2): page 1 A1 "SCALE 1:100 @ A1", page 2 A3 the same,
//   page 3 A1 viewports 1:50 / 1:100, page 4 A3 none, page 5 A1 "1 : 75 @ A1 1 : 200 @ A3".
//   snap.pdf (Story 4.1): page 1 A4 landscape, a rectangle (100, 100)-(300, 250).
// Covers: open from the status bar, the first-use tip once, use detected, success
// state and cursor in real units, undo / redo, by ratio with a sheet qualifier on
// a page range, the conflicting-scale warning, two points with snap (Esc, too
// close, typed distance in m and in ft-in), Document > Calibrate….
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./helpers";

const FIXTURES = path.join(__dirname, "..", "fixtures", "pdf");
const MM = 72 / 25.4;

const canvas = (page: Page) => page.getByTestId("drawing-canvas");
const scale = (page: Page) => page.getByTestId("status-bar").getByTestId("status-scale");
const readout = (page: Page) => page.getByTestId("status-bar").getByTestId("status-cursor-value");
const dialog = (page: Page) => page.getByRole("dialog", { name: "Calibrate" });

async function open(page: Page, name: string) {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("toolbar", { name: "Document" }).getByRole("button", { name: "Open…" }).click();
  await (await chooser).setFiles({ name, mimeType: "application/pdf", buffer: readFileSync(path.join(FIXTURES, name)) });
  await expect(canvas(page)).toHaveAttribute("data-state", "ready");
}

/** Screen position of user space point (x, y) on an unrotated page `height` points tall (box at the origin, view rotation 0). */
async function screenOf(page: Page, x: number, y: number, height: number) {
  const box = (await canvas(page).boundingBox())!;
  const [zoom, cx, cy] = ((await canvas(page).getAttribute("data-view")) ?? "").split(" ").map(Number);
  return { x: box.x + box.width / 2 + (x - cx) * zoom, y: box.y + box.height / 2 + (height - y - cy) * zoom };
}

/** Waits until the canvas stops moving or resizing and its view is stable. */
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

async function choose(page: Page, label: string, option: string) {
  await dialog(page).getByRole("combobox", { name: label }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

async function nextPage(page: Page, n: number, of: number) {
  await canvas(page).focus();
  await page.keyboard.press("PageDown");
  await expect(canvas(page)).toHaveAttribute("aria-label", new RegExp(`page ${n} of ${of}`));
}

test("calibrate: detected, ratio with a sheet on a range, conflict, undo / redo, first-use tip once", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const page = await context.newPage();
  await page.goto("/sign-in");
  await signIn(page, "admin@plan-markup.test");
  await expect(page).toHaveURL("/workspace");
  await open(page, "scales.pdf");
  await expect(scale(page)).toHaveAttribute("data-detection", "done", { timeout: 20_000 });

  // Open from the status bar: the tip shows the first time; use the detected scale.
  await scale(page).click();
  await expect(dialog(page)).toBeVisible();
  await expect(dialog(page).getByTestId("tip-calibrate")).toBeVisible();
  await dialog(page).getByRole("button", { name: "Use detected 1:100 @ A1" }).click();
  await expect(dialog(page)).toBeHidden();
  await expect(scale(page)).toHaveText("Scale 1:100");
  await expect(scale(page)).toHaveAttribute("data-tone", "success");
  await expect(scale(page).locator("svg.lucide-circle-check")).toHaveCount(1);

  // The cursor reads in millimetres (1:100: 100 pt of paper are 3528 mm).
  await stable(page);
  const p = await screenOf(page, 100, 100, 594 * MM);
  await page.mouse.move(p.x, p.y);
  await expect(readout(page)).toHaveText(/^X 352[78]  Y 352[78] mm$/);

  // Undo / redo: one step.
  await page.mouse.move(5, 500);
  await page.keyboard.press("Control+z");
  await expect(scale(page)).toHaveText("Scale 1:100 @ A1 detected — Verify");
  await page.keyboard.press("Control+y");
  await expect(scale(page)).toHaveText("Scale 1:100");
  await page.keyboard.press("Control+z");
  await page.keyboard.press("Control+Shift+z");
  await expect(scale(page)).toHaveText("Scale 1:100");
  await page.getByRole("menubar").getByRole("menuitem", { name: "Edit" }).click();
  await expect(page.getByRole("menuitem", { name: "Undo Calibrate page 1" })).toBeEnabled();
  await page.keyboard.press("Escape");

  // By ratio with a sheet qualifier, on pages 2-3 (A3 and A1): the tip does not show again.
  await page.getByRole("menubar").getByRole("menuitem", { name: "Document" }).click();
  await page.getByRole("menuitem", { name: "Calibrate…" }).click();
  await expect(dialog(page)).toBeVisible();
  await expect(dialog(page).getByTestId("tip-calibrate")).toHaveCount(0);
  await dialog(page).getByTestId("calibrate-ratio").fill("1:100 @ A1");
  await choose(page, "Apply to", "Pages…");
  await dialog(page).getByTestId("calibrate-range").fill("2-3");
  await expect(dialog(page).getByTestId("calibrate-mixed")).toContainText("the ratio applies to each page as a ratio");
  await dialog(page).getByTestId("calibrate-range").press("Enter");
  await expect(dialog(page)).toBeHidden();
  await nextPage(page, 2, 5);
  await expect(scale(page)).toHaveText("Scale 1:200");
  await nextPage(page, 3, 5);
  await expect(scale(page)).toHaveText("Scale 1:100");
  await nextPage(page, 4, 5);
  await expect(scale(page)).toHaveAttribute("data-detection", "done", { timeout: 20_000 });
  await expect(scale(page)).toHaveText("Scale not set");

  // The conflicting printed scales: the warning and both options.
  await nextPage(page, 5, 5);
  await expect(scale(page)).toHaveText("Scales disagree — Verify", { timeout: 20_000 });
  await scale(page).click();
  await expect(dialog(page).getByTestId("calibrate-conflict")).toContainText("Printed scales disagree: 1:75 @ A1 = 1:150 @ A3, but 1:200 @ A3 is printed");
  await expect(dialog(page).getByRole("button", { name: "Use 1:200 @ A3 (1:100 on this page)" })).toBeVisible();
  await dialog(page).getByRole("button", { name: "Use 1:75 @ A1 (1:75 on this page)" }).click();
  await expect(scale(page)).toHaveText("Scale 1:75");
  await context.close();
});

test("calibrate by two points: snap, Esc, too close, typed distance in m and in ft-in", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const page = await context.newPage();
  await page.goto("/sign-in");
  await signIn(page, "admin@plan-markup.test");
  await expect(page).toHaveURL("/workspace");
  await open(page, "snap.pdf");
  await expect(canvas(page)).toHaveAttribute("data-snap-index", /^\d+$/, { timeout: 20_000 });
  const A4_HEIGHT = 595;
  const bar = page.getByTestId("calibrate-pick-bar");

  await scale(page).click();
  await dialog(page).getByRole("tab", { name: "By two points" }).click();
  // Esc while picking brings the dialog back.
  await dialog(page).getByRole("button", { name: "Pick two points" }).click();
  await expect(bar).toContainText("Click the first point · Esc to cancel");
  await expect(dialog(page)).toBeHidden();
  await page.keyboard.press("Escape");
  await expect(dialog(page)).toBeVisible();
  await expect(bar).toBeHidden();

  // The same point twice: too close.
  await dialog(page).getByRole("button", { name: "Pick two points" }).click();
  await stable(page);
  let at = await screenOf(page, 102, 103, A4_HEIGHT);
  await page.mouse.move(at.x, at.y);
  await expect(canvas(page)).toHaveAttribute("data-snap", "endpoint 100.00 100.00");
  await page.mouse.click(at.x, at.y);
  await expect(bar).toContainText("Click the second point");
  await page.mouse.click(at.x, at.y);
  await expect(dialog(page).getByTestId("calibrate-pick-error")).toContainText("too close");

  // Two corners of the rectangle, snapped: 200 pt apart; at 1:100 that is 7.0556 m.
  await dialog(page).getByRole("button", { name: "Pick two points" }).click();
  await stable(page);
  at = await screenOf(page, 102, 103, A4_HEIGHT);
  await page.mouse.move(at.x, at.y);
  await expect(canvas(page)).toHaveAttribute("data-snap", "endpoint 100.00 100.00");
  await page.mouse.click(at.x, at.y);
  at = await screenOf(page, 298, 102, A4_HEIGHT);
  await page.mouse.move(at.x, at.y);
  await expect(canvas(page)).toHaveAttribute("data-snap", "endpoint 300.00 100.00");
  await page.mouse.click(at.x, at.y);
  await expect(dialog(page).getByTestId("calibrate-picked")).toContainText("(200.0 pt)");
  await choose(page, "Distance unit", "m");
  await choose(page, "Units", "Metres (m)");
  await choose(page, "Precision", "0.00");
  await dialog(page).getByTestId("calibrate-distance").fill("7.0556");
  await dialog(page).getByRole("button", { name: "Apply" }).click();
  await expect(scale(page)).toHaveText("Scale 1:100");
  // The cursor in metres: (100, 100) is 3.53 m from the corner each way.
  at = await screenOf(page, 100, 100, A4_HEIGHT);
  await page.mouse.move(at.x, at.y);
  await expect(readout(page)).toHaveText("X 3.53  Y 3.53 m");

  // Again in feet and inches: 23'-1 3/4" between the same corners.
  await page.mouse.move(5, 500);
  await scale(page).click();
  await dialog(page).getByRole("tab", { name: "By two points" }).click();
  await dialog(page).getByRole("button", { name: "Pick two points" }).click();
  await stable(page);
  for (const [x, y] of [
    [102, 103],
    [298, 102],
  ]) {
    at = await screenOf(page, x, y, A4_HEIGHT);
    await page.mouse.move(at.x, at.y);
    await expect(canvas(page)).toHaveAttribute("data-snap", /^endpoint /);
    await page.mouse.click(at.x, at.y);
  }
  await choose(page, "Distance unit", "ft-in");
  await choose(page, "Units", "Feet-inches (ft-in)");
  await choose(page, "Precision", '1/8"');
  await dialog(page).getByTestId("calibrate-distance").fill(`23'-1 3/4"`);
  await dialog(page).getByTestId("calibrate-distance").press("Enter");
  await expect(dialog(page)).toBeHidden();
  await expect(scale(page)).toHaveText("Scale 1:100");
  at = await screenOf(page, 100, 100, A4_HEIGHT);
  await page.mouse.move(at.x, at.y);
  await expect(readout(page)).toHaveText(`X 11'-6 7/8"  Y 11'-6 7/8"`);
  await context.close();
});
