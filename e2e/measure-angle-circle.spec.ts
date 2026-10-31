// Story 4.9: Angle, Radius and Diameter on the committed fixture (production build in CI).
//   snap.pdf (Story 4.1): page 1 A4 landscape, a rectangle (100, 100)-(300, 250).
// Covers: Angle at a corner on the uncalibrated page (no scale prompt) = 90.0°,
// live, Backspace; Radius (the scale prompt) and Diameter through three
// corners at 1:100 (the circle's diameter is the 250 pt diagonal: R 4410 mm,
// Ø 8819 mm); three points in a line refused; Esc; undo / redo.
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./helpers";

const PDF = path.join(__dirname, "..", "fixtures", "pdf", "snap.pdf");
const A4_HEIGHT = 595;

const canvas = (page: Page) => page.getByTestId("drawing-canvas");
const markups = (page: Page) => page.getByTestId("markups-canvas");
const scale = (page: Page) => page.getByTestId("status-bar").getByTestId("status-scale");
const calibrate = (page: Page) => page.getByRole("dialog", { name: "Calibrate" });
const prompt = (page: Page) => page.getByRole("region", { name: "Scale not set" });
const tool = (page: Page, name: string) => page.getByRole("toolbar", { name: "Drawing tools" }).getByRole("radio", { name, exact: true });

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

/** Waits until the canvas stops moving or resizing (the HintBar shifts it) and its view is stable. */
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

async function moveTo(page: Page, x: number, y: number) {
  const at = await screenOf(page, x, y);
  await page.mouse.move(at.x, at.y);
  return at;
}

async function snapCorner(page: Page, x: number, y: number) {
  const at = await moveTo(page, x, y);
  await expect(canvas(page)).toHaveAttribute("data-snap", /^endpoint /);
  return at;
}

async function clickCorner(page: Page, x: number, y: number) {
  const at = await snapCorner(page, x, y);
  await page.mouse.click(at.x, at.y);
}

async function expectUndo(page: Page, label: string) {
  await page.getByRole("menubar").getByRole("menuitem", { name: "Edit" }).click();
  await expect(page.getByRole("menuitem", { name: label })).toBeEnabled();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menuitem", { name: label })).toBeHidden();
}

test("angle, radius and diameter: a right angle without a scale, the circle through three corners at 1:100, a line refused, undo", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const page = await context.newPage();
  await page.goto("/sign-in");
  await signIn(page, "admin@plan-markup.test");
  await expect(page).toHaveURL("/workspace");
  await open(page);

  // Angle on the uncalibrated page: no scale prompt; the live angle; Backspace; the third click adds it.
  await tool(page, "Angle").click();
  await expect(page.getByText(/Angle: click the start of the first leg/)).toBeVisible();
  await stable(page);
  await expect(prompt(page)).toBeHidden();
  await clickCorner(page, 102, 103);
  await clickCorner(page, 298, 102);
  await snapCorner(page, 298, 248);
  await expect(canvas(page)).toHaveAttribute("data-measure", "90.0°");
  await page.keyboard.press("Backspace");
  await expect(canvas(page)).not.toHaveAttribute("data-measure", /.+/);
  await clickCorner(page, 298, 102);
  await clickCorner(page, 298, 248);
  await expect(markups(page)).toHaveAttribute("data-captions", "90.0°");
  await expect(tool(page, "Angle")).toBeChecked();
  await expectUndo(page, "Undo Add angle");

  // Radius: the scale prompt; calibrated 1:100; three corners.
  await tool(page, "Radius").click();
  await expect(prompt(page)).toBeVisible();
  await scale(page).click();
  await calibrate(page).getByTestId("calibrate-ratio").fill("1:100");
  await calibrate(page).getByRole("button", { name: "Apply" }).click();
  await expect(calibrate(page)).toBeHidden();
  await expect(prompt(page)).toBeHidden();
  await expect(tool(page, "Radius")).toBeChecked();
  await stable(page);
  await clickCorner(page, 102, 103);
  await clickCorner(page, 298, 102);
  await snapCorner(page, 298, 248);
  await expect(canvas(page)).toHaveAttribute("data-measure", "R 4410 mm");
  await page.mouse.click((await screenOf(page, 300, 250)).x, (await screenOf(page, 300, 250)).y);
  await expect(markups(page)).toHaveAttribute("data-captions", "90.0° | R 4410 mm");
  await expectUndo(page, "Undo Add radius");

  // Diameter through the same corners.
  await tool(page, "Diameter").click();
  await stable(page);
  for (const [x, y] of [[102, 103], [298, 102], [298, 248]] as const) await clickCorner(page, x, y);
  await expect(markups(page)).toHaveAttribute("data-captions", "90.0° | R 4410 mm | Ø 8819 mm");
  await page.keyboard.press("Control+z");
  await expect(markups(page)).toHaveAttribute("data-captions", "90.0° | R 4410 mm");
  await page.keyboard.press("Control+y");
  await expect(markups(page)).toHaveAttribute("data-captions", "90.0° | R 4410 mm | Ø 8819 mm");

  // Three points along the bottom edge make no circle: the click adds nothing; Esc cancels, Esc again: Select.
  await clickCorner(page, 102, 103);
  const mid = await moveTo(page, 200, 100);
  await expect(canvas(page)).toHaveAttribute("data-snap", /^midpoint /);
  await page.mouse.click(mid.x, mid.y);
  await snapCorner(page, 298, 102);
  await expect(canvas(page)).toHaveAttribute("data-measure", "Points in a line");
  await page.mouse.click((await screenOf(page, 300, 100)).x, (await screenOf(page, 300, 100)).y);
  await expect(markups(page)).toHaveAttribute("data-markup-count", "3");
  await page.keyboard.press("Escape");
  await expect(canvas(page)).not.toHaveAttribute("data-measure", /.+/);
  await page.keyboard.press("Escape");
  await expect(tool(page, "Select")).toBeChecked();
  await expect(markups(page)).toHaveAttribute("data-markup-count", "3");
  await context.close();
});
