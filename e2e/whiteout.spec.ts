// Story 5.11: White-out and the Eraser on the committed fixture fixtures/pdf/snap.pdf
// (page 1 A4 landscape, a rectangle drawn (100, 100)-(300, 250)).
// Covers: Shift+W drags a white cover over the drawn rectangle's left side: the
// markups canvas is opaque white there while the PDF's own tiles still have
// the line (the original is intact); one undo step; Select a click inside it,
// Delete removes it, Ctrl+Z puts it back; the Eraser from the slot's menu
// brushes the top side out (one undo step).
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { signIn } from "./helpers";

const PDF = path.join(__dirname, "..", "fixtures", "pdf", "snap.pdf");
const A4_HEIGHT = 595;

const canvas = (page: Page) => page.getByTestId("drawing-canvas");
const markups = (page: Page) => page.getByTestId("markups-canvas");
const tiles = (page: Page) => page.getByTestId("tiles-canvas");
const rail = (page: Page) => page.getByRole("toolbar", { name: "Drawing tools" });

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

/** A layer canvas's colour (r, g, b, a) under user space point (x, y). */
async function pixel(page: Page, layer: Locator, x: number, y: number) {
  const at = await screenOf(page, x, y);
  const box = (await layer.boundingBox())!;
  return layer.evaluate(
    (el, p) => {
      const c = el as HTMLCanvasElement;
      const k = c.width / c.getBoundingClientRect().width;
      return Array.from(c.getContext("2d")!.getImageData(Math.round(p.x * k), Math.round(p.y * k), 1, 1).data);
    },
    { x: at.x - box.x, y: at.y - box.y },
  );
}

/** The darkest of the tiles canvas's pixels on a short horizontal run around user space point (x, y) (a thin line, wherever it rounds to). */
async function darkest(page: Page, x: number, y: number) {
  const at = await screenOf(page, x, y);
  const box = (await tiles(page).boundingBox())!;
  return tiles(page).evaluate(
    (el, p) => {
      const c = el as HTMLCanvasElement;
      const k = c.width / c.getBoundingClientRect().width;
      const d = c.getContext("2d")!.getImageData(Math.round(p.x * k) - 4, Math.round(p.y * k), 9, 1).data;
      let least = 765;
      for (let i = 0; i < d.length; i += 4) least = Math.min(least, d[i] + d[i + 1] + d[i + 2]);
      return least;
    },
    { x: at.x - box.x, y: at.y - box.y },
  );
}

const white = ([r, g, b, a]: number[]) => a === 255 && r > 250 && g > 250 && b > 250;
const clear = ([, , , a]: number[]) => a === 0;

test("white-out: Shift+W covers the drawing (the PDF is intact), select, delete, undo; the Eraser brushes it out", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const page = await context.newPage();
  await page.goto("/sign-in");
  await signIn(page, "admin@plan-markup.test");
  await expect(page).toHaveURL("/workspace");
  await open(page);
  await stable(page);
  // The drawn rectangle's left side, in the PDF's tiles; nothing over it yet.
  await expect.poll(async () => (await darkest(page, 100, 175)) < 3 * 160).toBe(true);
  expect(clear(await pixel(page, markups(page), 100, 175))).toBe(true);

  // Shift+W: a drag over the left side.
  await press(page, "Shift+W");
  await expect(page.getByText(/^White-out: drag from one corner/)).toBeVisible();
  await stable(page);
  const a = await screenOf(page, 80, 130);
  const b = await screenOf(page, 130, 220);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 6 });
  await page.mouse.up();
  await expect(markups(page)).toHaveAttribute("data-captions", "White-out");
  await expectUndo(page, "Undo Add white-out");
  await expect.poll(async () => white(await pixel(page, markups(page), 100, 175))).toBe(true);
  // The original is intact: the tiles still have the line.
  expect(await darkest(page, 100, 175)).toBeLessThan(3 * 160);

  // Select: a click inside it; Delete removes it, Ctrl+Z puts it back.
  await press(page, "v");
  await stable(page);
  const inside = await screenOf(page, 110, 175);
  await page.mouse.click(inside.x, inside.y);
  await press(page, "Delete");
  await expect(markups(page)).not.toHaveAttribute("data-captions", /.+/);
  await press(page, "Control+z");
  await expect(markups(page)).toHaveAttribute("data-captions", "White-out");

  // The Eraser from the slot's menu: a stroke along the top side.
  await rail(page).getByRole("button", { name: "More white-out tools" }).click();
  await page.getByRole("menuitemradio", { name: "Eraser" }).click();
  await expect(page.getByText(/^Eraser: drag over the drawing/)).toBeVisible();
  await stable(page);
  expect(clear(await pixel(page, markups(page), 200, 250))).toBe(true);
  const from = await screenOf(page, 160, 250);
  const to = await screenOf(page, 260, 250);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 10 });
  await page.mouse.up();
  await expect(markups(page)).toHaveAttribute("data-captions", "White-out | Eraser");
  await expectUndo(page, "Undo Add eraser stroke");
  await expect.poll(async () => white(await pixel(page, markups(page), 200, 250))).toBe(true);
  await context.close();
});
