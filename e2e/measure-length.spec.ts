// Story 4.5: Length measurements on the committed fixture (production build in CI).
//   snap.pdf (Story 4.1): page 1 A4 landscape, a rectangle (100, 100)-(300, 250).
// Covers: Length from Shift+Alt+L and from the ToolRail, "Scale not set" before
// calibrating, the live value while drawing, captions in mm and in ft-in after
// a recalibration (values are derived, never stored), Shift 45° steps, Esc
// (cancel, then Select), Ctrl+Z removing the placed point, undo / redo as
// "Add length", a click painted within 50 ms (NFR3), and a reload restoring the
// measurements and their undo steps (UX-DR36).
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
const tool = (page: Page, name: string) => page.getByRole("toolbar", { name: "Drawing tools" }).getByRole("radio", { name });

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

/** Clicks near (x, y) once the cursor has snapped to the rectangle's corner there. */
async function clickCorner(page: Page, x: number, y: number) {
  const at = await moveTo(page, x, y);
  await expect(canvas(page)).toHaveAttribute("data-snap", /^endpoint /);
  await page.mouse.click(at.x, at.y);
}

async function calibrateRatio(page: Page, ratio: string, units?: string) {
  await scale(page).click();
  await calibrate(page).getByTestId("calibrate-ratio").fill(ratio);
  if (units) {
    await calibrate(page).getByRole("combobox", { name: "Units" }).click();
    await page.getByRole("option", { name: units, exact: true }).click();
  }
  await calibrate(page).getByRole("button", { name: "Apply" }).click();
  await expect(calibrate(page)).toBeHidden();
}

async function expectUndo(page: Page, label: string) {
  await page.getByRole("menubar").getByRole("menuitem", { name: "Edit" }).click();
  await expect(page.getByRole("menuitem", { name: label })).toBeEnabled();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menuitem", { name: label })).toBeHidden();
}

test("length: Scale not set, live value, mm and ft-in captions, Shift, Esc, Ctrl+Z, undo / redo, 50 ms paint, reload", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const page = await context.newPage();
  await page.goto("/sign-in");
  await signIn(page, "admin@plan-markup.test");
  await expect(page).toHaveURL("/workspace");
  await open(page);

  // Shift+Alt+L arms Length (Revu's shortcut); the HintBar says how it works.
  await canvas(page).focus();
  await page.keyboard.press("Shift+Alt+L");
  await expect(tool(page, "Length")).toBeChecked();
  await expect(page.getByText(/Length: click the start and the end point/)).toBeVisible();
  await stable(page);

  // Not calibrated: the live value and the caption read "Scale not set".
  await clickCorner(page, 102, 103);
  await moveTo(page, 298, 102);
  await expect(canvas(page)).toHaveAttribute("data-measure", "Scale not set");
  await clickCorner(page, 298, 102);
  await expect(markups(page)).toHaveAttribute("data-captions", "Scale not set");
  await expect(canvas(page)).not.toHaveAttribute("data-measure", /.+/);
  // The tool stays armed (Revu).
  await expect(tool(page, "Length")).toBeChecked();

  // Calibrated 1:100 afterwards: the same measurement shows its value (200 pt = 7056 mm).
  await calibrateRatio(page, "1:100");
  await expect(scale(page)).toHaveText("Scale 1:100");
  await expect(markups(page)).toHaveAttribute("data-captions", "7056 mm");
  await expect(tool(page, "Length")).toBeChecked();

  // Shift: from the corner a nearly horizontal move is horizontal (80 pt = 2822 mm); live value first.
  // The click is timed from its pointer event to layer 2's paint (NFR3: within 50 ms).
  await stable(page);
  await clickCorner(page, 102, 103);
  await page.keyboard.down("Shift");
  await moveTo(page, 180, 108);
  await expect(canvas(page)).toHaveAttribute("data-measure", "2822 mm");
  await canvas(page).evaluate((el) => {
    el.addEventListener("pointerdown", (e) => el.setAttribute("data-e2e-down", String(e.timeStamp)), { capture: true, once: true });
  });
  await page.mouse.down();
  await page.mouse.up();
  await page.keyboard.up("Shift");
  await expect(markups(page)).toHaveAttribute("data-captions", "7056 mm | 2822 mm");
  const down = Number(await canvas(page).getAttribute("data-e2e-down"));
  const painted = Number(await markups(page).getAttribute("data-painted-at"));
  process.stdout.write(`${JSON.stringify({ paintMs: painted - down })}\n`);
  expect(painted - down).toBeGreaterThanOrEqual(0);
  expect(painted - down).toBeLessThan(50);

  // Ctrl+Z / Ctrl+Y: "Add length" is one step each way.
  await page.keyboard.press("Control+z");
  await expect(markups(page)).toHaveAttribute("data-captions", "7056 mm");
  await page.keyboard.press("Control+y");
  await expect(markups(page)).toHaveAttribute("data-captions", "7056 mm | 2822 mm");

  // Ctrl+Z while drawing removes the placed point only.
  await clickCorner(page, 102, 248);
  await moveTo(page, 200, 200);
  await expect(canvas(page)).toHaveAttribute("data-measure", /mm$/);
  await page.keyboard.press("Control+z");
  await moveTo(page, 210, 200);
  await expect(canvas(page)).not.toHaveAttribute("data-measure", /.+/);
  await expect(markups(page)).toHaveAttribute("data-captions", "7056 mm | 2822 mm");

  // Esc while drawing cancels; Esc again returns to Select.
  await clickCorner(page, 102, 248);
  await moveTo(page, 200, 200);
  await expect(canvas(page)).toHaveAttribute("data-measure", /mm$/);
  await page.keyboard.press("Escape");
  await expect(canvas(page)).not.toHaveAttribute("data-measure", /.+/);
  await expect(tool(page, "Length")).toBeChecked();
  await page.keyboard.press("Escape");
  await expect(tool(page, "Select")).toBeChecked();
  await expect(markups(page)).toHaveAttribute("data-markup-count", "2");

  // Recalibrated in feet-inches: the captions follow (7056 mm = 23'-2", 2822 mm = 9'-3").
  await calibrateRatio(page, "1:100", "Feet-inches (ft-in)");
  await expect(markups(page)).toHaveAttribute("data-captions", /^23'-[0-9 /]+" \| 9'-[0-9 /]+"$/);
  const captions = (await markups(page).getAttribute("data-captions")) ?? "";
  await expectUndo(page, "Undo Calibrate page 1");

  // From the ToolRail too.
  await tool(page, "Length").click();
  await expect(tool(page, "Length")).toBeChecked();
  await tool(page, "Select").click();

  // A reload keeps the session (this browser tab): the same file brings back the
  // measurements, the calibration and the undo steps.
  await page.reload();
  await expect(page).toHaveURL("/workspace");
  await open(page);
  await expect(markups(page)).toHaveAttribute("data-captions", captions);
  await expectUndo(page, "Undo Calibrate page 1");
  await page.keyboard.press("Control+z");
  await expect(markups(page)).toHaveAttribute("data-captions", "7056 mm | 2822 mm");
  await page.keyboard.press("Control+z");
  await expect(markups(page)).toHaveAttribute("data-captions", "7056 mm");
  await expectUndo(page, "Undo Calibrate page 1");
  await context.close();
});
