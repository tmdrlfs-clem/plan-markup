// Story 5.4: Line, Arrow, Polyline and Polygon on the committed fixture (production build in CI).
//   snap.pdf (Story 4.1): page 1 A4 landscape, a rectangle (100, 100)-(300, 250).
// Covers: L draws a line across the rectangle (snapped corners), one undo
// step; with Select a click on it selects it (Delete removes it, Ctrl+Z puts
// it back); A an arrow; Shift+N a polyline finished with Enter; Shift+P a
// polygon closed on its first corner; Backspace removes a point while drawing
// (Undo names it); Esc cancels, Esc again returns to Select.
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./helpers";

const PDF = path.join(__dirname, "..", "fixtures", "pdf", "snap.pdf");
const A4_HEIGHT = 595;

const canvas = (page: Page) => page.getByTestId("drawing-canvas");
const markups = (page: Page) => page.getByTestId("markups-canvas");
const selectTool = (page: Page) => page.getByRole("toolbar", { name: "Drawing tools" }).getByRole("radio", { name: "Select", exact: true });

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

async function expectUndo(page: Page, label: string) {
  await page.getByRole("menubar").getByRole("menuitem", { name: "Edit" }).click();
  await expect(page.getByRole("menuitem", { name: label })).toBeEnabled();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menuitem", { name: label })).toBeHidden();
}

/** Focuses the canvas once a closed menu has given focus back to its trigger. */
async function focusCanvas(page: Page) {
  await expect(async () => {
    await canvas(page).focus();
    await expect(canvas(page)).toBeFocused({ timeout: 200 });
  }).toPass();
}

async function press(page: Page, key: string) {
  await focusCanvas(page);
  await page.keyboard.press(key);
}

/** Arms a tool by its key; the HintBar names it (and may shift the canvas). */
async function arm(page: Page, key: string, hint: RegExp) {
  await press(page, key);
  await expect(page.getByText(hint)).toBeVisible();
  await stable(page);
}

test("line tools: L, A, Shift+N, Shift+P draw snapped markups; Enter, first-corner close, Backspace, Esc; select and undo", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const page = await context.newPage();
  await page.goto("/sign-in");
  await signIn(page, "admin@plan-markup.test");
  await expect(page).toHaveURL("/workspace");
  await open(page);

  // L: a line across the rectangle, corner to corner.
  await arm(page, "l", /^Line: click the start/);
  await clickCorner(page, 100, 100);
  await clickCorner(page, 300, 250);
  await expect(markups(page)).toHaveAttribute("data-captions", "Line");
  await expectUndo(page, "Undo Add line");

  // With Select a click on it selects it: Delete removes it, Ctrl+Z puts it back.
  await press(page, "v");
  await stable(page);
  const mid = await screenOf(page, 200, 175);
  await page.mouse.click(mid.x, mid.y);
  await press(page, "Delete");
  await expect(markups(page)).not.toHaveAttribute("data-captions", /.+/);
  await press(page, "Control+z");
  await expect(markups(page)).toHaveAttribute("data-captions", "Line");

  // A: an arrow along the top edge.
  await arm(page, "a", /^Arrow: click the start/);
  await clickCorner(page, 100, 250);
  await clickCorner(page, 300, 250);
  await expect(markups(page)).toHaveAttribute("data-captions", "Line | Arrow");
  await expectUndo(page, "Undo Add arrow");

  // Shift+N: a polyline of three vertices, Enter finishes it.
  await arm(page, "Shift+N", /^Polyline: click each vertex/);
  await clickCorner(page, 100, 100);
  await clickCorner(page, 300, 100);
  await clickCorner(page, 300, 250);
  await press(page, "Enter");
  await expect(markups(page)).toHaveAttribute("data-captions", "Line | Arrow | Polyline");
  await expectUndo(page, "Undo Add polyline");

  // Shift+P: a polygon, closed by a click on its first corner.
  await arm(page, "Shift+P", /^Polygon: click each corner/);
  await clickCorner(page, 100, 100);
  await clickCorner(page, 300, 100);
  await clickCorner(page, 300, 250);
  await clickCorner(page, 100, 100);
  await expect(markups(page)).toHaveAttribute("data-captions", "Line | Arrow | Polyline | Polygon");
  await expectUndo(page, "Undo Add polygon");

  // While drawing, Backspace removes the last point and Undo names the point; Esc cancels, Esc again: Select.
  await clickCorner(page, 100, 250);
  await clickCorner(page, 300, 250);
  await press(page, "Backspace");
  await expectUndo(page, "Undo Polygon point");
  await press(page, "Escape");
  await expect(markups(page)).toHaveAttribute("data-captions", "Line | Arrow | Polyline | Polygon");
  await press(page, "Escape");
  await expect(selectTool(page)).toBeChecked();

  // Each was one step.
  await press(page, "Control+z");
  await expect(markups(page)).toHaveAttribute("data-captions", "Line | Arrow | Polyline");
  await context.close();
});
