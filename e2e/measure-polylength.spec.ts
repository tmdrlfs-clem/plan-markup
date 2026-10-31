// Story 4.6: Polylength measurements and moving captions on the committed fixture (production build in CI).
//   snap.pdf (Story 4.1): page 1 A4 landscape, a rectangle (100, 100)-(300, 250).
// Covers: Polylength from Shift+Alt+Q and from the ToolRail, the live total,
// finishing with Enter and with a double-click, Backspace and Ctrl+Z removing
// the last vertex, Esc (cancel, then Select), undo / redo of "Add polylength",
// a caption moved with Shift + drag (live, then "Move caption") and its undo,
// and a reload keeping a moved caption.
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { armMeasureTool, signIn } from "./helpers";

const PDF = path.join(__dirname, "..", "fixtures", "pdf", "snap.pdf");
const A4_HEIGHT = 595;

const canvas = (page: Page) => page.getByTestId("drawing-canvas");
const markups = (page: Page) => page.getByTestId("markups-canvas");
const scale = (page: Page) => page.getByTestId("status-bar").getByTestId("status-scale");
const calibrate = (page: Page) => page.getByRole("dialog", { name: "Calibrate" });
const tool = (page: Page, name: string) => page.getByRole("toolbar", { name: "Drawing tools" }).getByRole("radio", { name, exact: true });

async function open(page: Page) {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("toolbar", { name: "Document" }).getByRole("button", { name: "Open…" }).click();
  await (await chooser).setFiles({ name: "snap.pdf", mimeType: "application/pdf", buffer: readFileSync(PDF) });
  await expect(canvas(page)).toHaveAttribute("data-state", "ready");
  await expect(canvas(page)).toHaveAttribute("data-snap-index", /^\d+$/, { timeout: 20_000 });
}

/** The view's CSS px per point. */
async function zoomOf(page: Page) {
  return Number(((await canvas(page).getAttribute("data-view")) ?? "").split(" ")[0]);
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

/** Moves near (x, y) until the cursor has snapped to the rectangle's corner there. */
async function snapCorner(page: Page, x: number, y: number) {
  const at = await moveTo(page, x, y);
  await expect(canvas(page)).toHaveAttribute("data-snap", /^endpoint /);
  return at;
}

async function clickCorner(page: Page, x: number, y: number) {
  const at = await snapCorner(page, x, y);
  await page.mouse.click(at.x, at.y);
}

async function calibrateRatio(page: Page, ratio: string) {
  await scale(page).click();
  await calibrate(page).getByTestId("calibrate-ratio").fill(ratio);
  await calibrate(page).getByRole("button", { name: "Apply" }).click();
  await expect(calibrate(page)).toBeHidden();
}

async function expectUndo(page: Page, label: string) {
  await page.getByRole("menubar").getByRole("menuitem", { name: "Edit" }).click();
  await expect(page.getByRole("menuitem", { name: label })).toBeEnabled();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menuitem", { name: label })).toBeHidden();
}

/** Revu-red pixels on layer 2 within a screen rectangle (CSS px). */
async function redPixels(page: Page, rect: { x: number; y: number; width: number; height: number }) {
  const box = (await markups(page).boundingBox())!;
  return markups(page).evaluate(
    (el, { rect, box }) => {
      const c = el as HTMLCanvasElement;
      const k = c.width / box.width;
      const x = Math.round((rect.x - box.x) * k);
      const y = Math.round((rect.y - box.y) * k);
      const data = c.getContext("2d")!.getImageData(x, y, Math.max(1, Math.round(rect.width * k)), Math.max(1, Math.round(rect.height * k))).data;
      let n = 0;
      for (let i = 0; i < data.length; i += 4) if (data[i] > 180 && data[i + 1] < 90 && data[i + 2] < 90 && data[i + 3] > 128) n++;
      return n;
    },
    { rect, box },
  );
}

test("polylength: live total, Enter / double-click, Backspace, Ctrl+Z, Esc, undo / redo, caption move and its undo, reload", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const page = await context.newPage();
  await page.goto("/sign-in");
  await signIn(page, "admin@plan-markup.test");
  await expect(page).toHaveURL("/workspace");
  await open(page);
  await calibrateRatio(page, "1:100");
  await expect(scale(page)).toHaveText("Scale 1:100");

  // Shift+Alt+Q arms Polylength (Revu's shortcut); the HintBar says how it works.
  await canvas(page).focus();
  await page.keyboard.press("Shift+Alt+Q");
  await expect(tool(page, "Polylength")).toBeChecked();
  await expect(page.getByText(/Polylength: click each vertex/)).toBeVisible();
  await stable(page);

  // At 1:100 a point is 35.28 mm: the bottom edge 200 pt = 7056 mm, the right edge 150 pt = 5292 mm.
  await clickCorner(page, 102, 103);
  await clickCorner(page, 298, 102);
  await snapCorner(page, 298, 248);
  // The live total: the placed segment plus the rubber band.
  await expect(canvas(page)).toHaveAttribute("data-measure", "12347 mm");
  // Backspace removes the last vertex: from the first corner straight to the pointer (250 pt).
  await page.keyboard.press("Backspace");
  await moveTo(page, 296, 247);
  await snapCorner(page, 298, 248);
  await expect(canvas(page)).toHaveAttribute("data-measure", "8819 mm");
  await clickCorner(page, 298, 102);
  // Ctrl+Z while drawing removes the last vertex too.
  await page.keyboard.press("Control+z");
  await moveTo(page, 296, 247);
  await snapCorner(page, 298, 248);
  await expect(canvas(page)).toHaveAttribute("data-measure", "8819 mm");
  await clickCorner(page, 298, 102);
  await clickCorner(page, 298, 248);
  // Enter finishes it: one markup, its total as the caption; the tool stays armed.
  await page.keyboard.press("Enter");
  await expect(markups(page)).toHaveAttribute("data-captions", "12347 mm");
  await expect(canvas(page)).not.toHaveAttribute("data-measure", /.+/);
  await expect(tool(page, "Polylength")).toBeChecked();
  await expectUndo(page, "Undo Add polylength");

  // Ctrl+Z / Ctrl+Y: "Add polylength" is one step each way.
  await page.keyboard.press("Control+z");
  await expect(markups(page)).not.toHaveAttribute("data-captions", /.+/);
  await page.keyboard.press("Control+y");
  await expect(markups(page)).toHaveAttribute("data-captions", "12347 mm");

  // From the ToolRail; a double-click finishes (its second click adds no vertex): the top edge.
  await tool(page, "Select").click();
  await armMeasureTool(page, "Polylength");
  await expect(tool(page, "Polylength")).toBeChecked();
  await stable(page);
  await clickCorner(page, 102, 248);
  const end = await snapCorner(page, 298, 248);
  await page.mouse.dblclick(end.x, end.y);
  await expect(markups(page)).toHaveAttribute("data-captions", "12347 mm | 7056 mm");

  // Esc while drawing cancels; Esc again returns to Select.
  await clickCorner(page, 102, 103);
  await moveTo(page, 200, 180);
  await expect(canvas(page)).toHaveAttribute("data-measure", /mm$/);
  await page.keyboard.press("Escape");
  await expect(canvas(page)).not.toHaveAttribute("data-measure", /.+/);
  await expect(tool(page, "Polylength")).toBeChecked();
  await page.keyboard.press("Escape");
  await expect(tool(page, "Select")).toBeChecked();
  await expect(markups(page)).toHaveAttribute("data-markup-count", "2");

  // The first polylength's caption sits above its longest segment (the bottom edge), centred.
  await stable(page);
  const zoom = await zoomOf(page);
  const mid = await screenOf(page, 200, 100);
  const text = 10 * zoom; // 10 pt captions
  const captionBox = (dy: number) => ({ x: mid.x - 4 * text, y: mid.y - 1.25 * text + dy, width: 8 * text, height: text });
  expect(await redPixels(page, captionBox(0))).toBeGreaterThan(0);
  const MOVE = -Math.round(3 * text);
  expect(await redPixels(page, captionBox(MOVE))).toBe(0);

  // Select + Shift + drag on it moves the caption only, live; Esc during the drag puts it back.
  const grab = { x: mid.x, y: mid.y - 0.7 * text };
  await page.keyboard.down("Shift");
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  await page.mouse.move(grab.x, grab.y + MOVE / 2);
  await page.mouse.move(grab.x, grab.y + MOVE);
  await expect.poll(() => redPixels(page, captionBox(MOVE))).toBeGreaterThan(0);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect.poll(() => redPixels(page, captionBox(MOVE))).toBe(0);
  expect(await redPixels(page, captionBox(0))).toBeGreaterThan(0);
  await expectUndo(page, "Undo Add polylength");

  // Again, released: "Move caption"; the measurement and its value stay.
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  await page.mouse.move(grab.x, grab.y + MOVE / 2);
  await page.mouse.move(grab.x, grab.y + MOVE);
  await page.mouse.up();
  await page.keyboard.up("Shift");
  await expect.poll(() => redPixels(page, captionBox(MOVE))).toBeGreaterThan(0);
  expect(await redPixels(page, captionBox(0))).toBe(0);
  await expect(markups(page)).toHaveAttribute("data-captions", "12347 mm | 7056 mm");
  await expectUndo(page, "Undo Move caption");

  // Its undo puts the caption back; redo moves it again.
  await page.keyboard.press("Control+z");
  await expect.poll(() => redPixels(page, captionBox(0))).toBeGreaterThan(0);
  expect(await redPixels(page, captionBox(MOVE))).toBe(0);
  await page.keyboard.press("Control+y");
  await expect.poll(() => redPixels(page, captionBox(MOVE))).toBeGreaterThan(0);

  // A reload keeps the session: the moved caption is where it was put, its undo step too.
  await page.reload();
  await expect(page).toHaveURL("/workspace");
  await open(page);
  await expect(markups(page)).toHaveAttribute("data-captions", "12347 mm | 7056 mm");
  await stable(page);
  const after = await screenOf(page, 200, 100);
  const text2 = 10 * (await zoomOf(page));
  const moved = { x: after.x - 4 * text2, y: after.y - 1.25 * text2 - Math.round(3 * text2), width: 8 * text2, height: text2 };
  await expect.poll(() => redPixels(page, moved)).toBeGreaterThan(0);
  await expectUndo(page, "Undo Move caption");
  await context.close();
});
