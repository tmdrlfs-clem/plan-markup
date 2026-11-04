// Story 5.10: the Properties panel and the format painter on the committed
// fixture fixtures/pdf/snap.pdf (page 1 A4 landscape, a rectangle (100, 100)-(300, 250)).
// Covers: Alt+P opens Properties for the selected rectangle; Line width and
// Colour apply at once (the stroke on the canvas turns blue and thick), each
// one undo step; Copy format then a click on a second rectangle gives it the
// same style, one undo step ("Apply format").
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./helpers";

const PDF = path.join(__dirname, "..", "fixtures", "pdf", "snap.pdf");
const A4_HEIGHT = 595;

const canvas = (page: Page) => page.getByTestId("drawing-canvas");
const markups = (page: Page) => page.getByTestId("markups-canvas");

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

async function press(page: Page, key: string) {
  await expect(async () => {
    await canvas(page).focus();
    await expect(canvas(page)).toBeFocused({ timeout: 200 });
  }).toPass();
  await page.keyboard.press(key);
}

async function expectUndo(page: Page, label: string) {
  await page.getByRole("menubar").getByRole("menuitem", { name: "Edit" }).click();
  await expect(page.getByRole("menuitem", { name: label })).toBeEnabled();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menuitem", { name: label })).toBeHidden();
}

/** Drags a rectangle from (x0, y0) to (x1, y1) with R. */
async function rectangle(page: Page, x0: number, y0: number, x1: number, y1: number) {
  await press(page, "r");
  await expect(page.getByText(/^Rectangle: drag from one corner/)).toBeVisible();
  await stable(page);
  const a = await screenOf(page, x0, y0);
  const b = await screenOf(page, x1, y1);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 6 });
  await page.mouse.up();
}

/** The markups canvas's colour (r, g, b, a) under user space point (x, y). */
async function pixel(page: Page, x: number, y: number) {
  const at = await screenOf(page, x, y);
  const box = (await markups(page).boundingBox())!;
  return markups(page).evaluate(
    (el, p) => {
      const c = el as HTMLCanvasElement;
      const k = c.width / c.getBoundingClientRect().width;
      return Array.from(c.getContext("2d")!.getImageData(Math.round(p.x * k), Math.round(p.y * k), 1, 1).data);
    },
    { x: at.x - box.x, y: at.y - box.y },
  );
}

const isBlue = ([r, g, b, a]: number[]) => a > 200 && b > 200 && r < 60 && g < 60;

test("properties: Alt+P edits the selected rectangle at once (undoable); Copy format paints a second one", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const page = await context.newPage();
  await page.goto("/sign-in");
  await signIn(page, "admin@plan-markup.test");
  await expect(page).toHaveURL("/workspace");
  await open(page);

  // Two rectangles, the second away from the drawing's.
  await rectangle(page, 100, 100, 300, 250);
  await rectangle(page, 450, 100, 600, 250);
  await expect(markups(page)).toHaveAttribute("data-captions", "Rectangle | Rectangle");

  // Select the first, Alt+P: its properties.
  await press(page, "v");
  await stable(page);
  const inside = await screenOf(page, 150, 200);
  await page.mouse.click(inside.x, inside.y);
  await press(page, "Alt+p");
  const panel = page.getByTestId("properties-panel");
  await expect(panel).toBeVisible();
  await expect(panel.getByLabel("Subject")).toHaveValue("Rectangle");
  await stable(page);

  // Line width and Colour apply at once, each one undo step.
  const width = panel.getByLabel("Line width");
  await width.fill("6");
  await width.press("Enter");
  await expectUndo(page, "Undo Change line width");
  await panel.getByRole("radiogroup", { name: "Colour" }).getByRole("radio", { name: "Blue" }).click();
  await expectUndo(page, "Undo Change colour");
  await expect.poll(async () => isBlue(await pixel(page, 100, 175))).toBe(true);
  expect(isBlue(await pixel(page, 450, 175))).toBe(false);

  // Copy format, then a click inside the second rectangle: it is painted too.
  await panel.getByRole("button", { name: "Copy format" }).click();
  await expect(panel.getByText("Click a markup to apply the format. Esc cancels.")).toBeVisible();
  await stable(page);
  const second = await screenOf(page, 500, 200);
  await page.mouse.click(second.x, second.y);
  await expect.poll(async () => isBlue(await pixel(page, 450, 175))).toBe(true);
  await expectUndo(page, "Undo Apply format");

  // One step: Ctrl+Z takes it back.
  await press(page, "Control+z");
  await expect.poll(async () => isBlue(await pixel(page, 450, 175))).toBe(false);
  expect(isBlue(await pixel(page, 100, 175))).toBe(true);
  await context.close();
});
