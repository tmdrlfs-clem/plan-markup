// Story 4.4: verifying a calibration on the committed fixture (production build in CI).
//   snap.pdf (Story 4.1): page 1 A4 landscape, a rectangle (100, 100)-(300, 250).
// Covers: Verify calibration… disabled before calibrating, Verify from the menu
// and from the Calibrate dialog, a match on known corners, Esc while picking, a
// mismatch with its signed difference and percentage, a known value in ft-in,
// Recalibrate… prefilling Calibrate and applying as one undo step.
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./helpers";

const FIXTURES = path.join(__dirname, "..", "fixtures", "pdf");
const A4_HEIGHT = 595;

const canvas = (page: Page) => page.getByTestId("drawing-canvas");
const scale = (page: Page) => page.getByTestId("status-bar").getByTestId("status-scale");
const calibrate = (page: Page) => page.getByRole("dialog", { name: "Calibrate" });
const verify = (page: Page) => page.getByRole("dialog", { name: "Verify calibration" });
const bar = (page: Page) => page.getByTestId("calibrate-pick-bar");

async function open(page: Page, name: string) {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("toolbar", { name: "Document" }).getByRole("button", { name: "Open…" }).click();
  await (await chooser).setFiles({ name, mimeType: "application/pdf", buffer: readFileSync(path.join(FIXTURES, name)) });
  await expect(canvas(page)).toHaveAttribute("data-state", "ready");
}

/** Screen position of user space point (x, y) on the unrotated A4 page (box at the origin, view rotation 0). */
async function screenOf(page: Page, x: number, y: number) {
  const box = (await canvas(page).boundingBox())!;
  const [zoom, cx, cy] = ((await canvas(page).getAttribute("data-view")) ?? "").split(" ").map(Number);
  return { x: box.x + box.width / 2 + (x - cx) * zoom, y: box.y + box.height / 2 + (A4_HEIGHT - y - cy) * zoom };
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

async function menu(page: Page, name: string) {
  await page.getByRole("menubar").getByRole("menuitem", { name: "Document" }).click();
  return page.getByRole("menuitem", { name });
}

/** Picks two points near (x, y) pairs, each snapped to an endpoint of the rectangle. */
async function pickTwo(page: Page, points: [number, number][]) {
  await stable(page);
  for (const [x, y] of points) {
    const at = await screenOf(page, x, y);
    await page.mouse.move(at.x, at.y);
    await expect(canvas(page)).toHaveAttribute("data-snap", /^endpoint /);
    await page.mouse.click(at.x, at.y);
  }
}

test("verify a calibration: match, Esc, mismatch, ft-in, Recalibrate as one undo step", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const page = await context.newPage();
  await page.goto("/sign-in");
  await signIn(page, "admin@plan-markup.test");
  await expect(page).toHaveURL("/workspace");
  await open(page, "snap.pdf");
  await expect(canvas(page)).toHaveAttribute("data-snap-index", /^\d+$/, { timeout: 20_000 });

  // Not calibrated yet: Verify is disabled.
  await expect(await menu(page, "Verify calibration…")).toBeDisabled();
  await page.keyboard.press("Escape");

  // Calibrate 1:100 by ratio.
  await (await menu(page, "Calibrate…")).click();
  await calibrate(page).getByTestId("calibrate-ratio").fill("1:100");
  await calibrate(page).getByTestId("calibrate-ratio").press("Enter");
  await expect(scale(page)).toHaveText("Scale 1:100");

  // Verify from the menu: the bottom edge (200 pt = 7056 mm at 1:100), known 7056: Matches.
  await (await menu(page, "Verify calibration…")).click();
  await expect(verify(page)).toHaveAccessibleDescription(/Scale 1:100$/);
  await verify(page).getByTestId("verify-known").fill("7056");
  // Esc while picking brings the dialog back.
  await verify(page).getByRole("button", { name: "Pick two points" }).click();
  await expect(bar(page)).toContainText("Click the first point · Esc to cancel");
  await page.keyboard.press("Escape");
  await expect(verify(page)).toBeVisible();
  await verify(page).getByRole("button", { name: "Pick two points" }).click();
  await pickTwo(page, [
    [102, 103],
    [298, 102],
  ]);
  await expect(verify(page).getByTestId("verify-row-measured")).toHaveText("7056 mm");
  await expect(verify(page).getByTestId("verify-verdict")).toHaveAttribute("data-verdict", "matches");
  await expect(verify(page).getByTestId("verify-verdict")).toContainText("Matches");
  await expect(verify(page).getByTestId("verify-verdict").locator("svg.lucide-circle-check")).toHaveCount(1);

  // A known value in ft-in on the same line: 23'-2" is 7061 mm, off by -5 mm.
  await verify(page).getByRole("combobox", { name: "Known unit" }).click();
  await page.getByRole("option", { name: "ft-in", exact: true }).click();
  await verify(page).getByTestId("verify-known").fill(`23'-2"`);
  await expect(verify(page).getByTestId("verify-row-known")).toHaveText("7061 mm");
  await expect(verify(page).getByTestId("verify-verdict")).toHaveText("Off by -5 mm (-0.08 %): recalibrate if the known distance is right");

  // Keep: nothing changes, the dialog closes.
  await verify(page).getByRole("button", { name: "Keep" }).click();
  await expect(verify(page)).toBeHidden();
  await expect(scale(page)).toHaveText("Scale 1:100");

  // Verify from the Calibrate dialog: the left edge (150 pt = 5292 mm), known 5400 mm: off by -108 mm.
  await scale(page).click();
  await expect(calibrate(page).getByTestId("calibrate-current")).toContainText("This page: Scale 1:100");
  await calibrate(page).getByRole("button", { name: "Verify…" }).click();
  await expect(calibrate(page)).toBeHidden();
  await verify(page).getByRole("button", { name: "Pick two points" }).click();
  await pickTwo(page, [
    [102, 103],
    [102, 248],
  ]);
  await verify(page).getByTestId("verify-known").fill("5400");
  await expect(verify(page).getByTestId("verify-row-difference")).toHaveText("-108 mm (-2.01 %)");
  await expect(verify(page).getByTestId("verify-verdict")).toHaveAttribute("data-verdict", "off");
  await expect(verify(page).getByTestId("verify-verdict").locator("svg.lucide-triangle-alert")).toHaveCount(1);

  // Recalibrate… (the primary when off, Enter): Calibrate opens on two points with the pick and distance.
  await verify(page).getByTestId("verify-known").press("Enter");
  await expect(verify(page)).toBeHidden();
  await expect(calibrate(page).getByRole("tab", { name: "By two points" })).toHaveAttribute("aria-selected", "true");
  await expect(calibrate(page).getByTestId("calibrate-picked")).toContainText("(150.0 pt)");
  await expect(calibrate(page).getByTestId("calibrate-distance")).toHaveValue("5400");
  await calibrate(page).getByRole("button", { name: "Apply" }).click();
  await expect(scale(page)).toHaveText("Calibrated");

  // One undo step back to 1:100.
  await page.mouse.move(5, 500);
  await page.keyboard.press("Control+z");
  await expect(scale(page)).toHaveText("Scale 1:100");
  await context.close();
});
