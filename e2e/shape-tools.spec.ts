// Story 5.5: Rectangle, Ellipse and Cloud on the committed fixture (production build in CI).
//   snap.pdf (Story 4.1): page 1 A4 landscape, a rectangle (100, 100)-(300, 250).
// Covers: R drags a rectangle over the drawn one (snapped corners), one undo
// step; with Select a click inside it selects it (Delete removes it, Ctrl+Z
// puts it back); E an ellipse by two clicks; C a cloud closed on its first
// corner; Esc cancels a box after its first corner, Esc again returns to Select.
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

async function snapTo(page: Page, x: number, y: number) {
  const at = await screenOf(page, x, y);
  await page.mouse.move(at.x, at.y);
  await expect(canvas(page)).toHaveAttribute("data-snap", /^endpoint /);
  return at;
}

test("shape tools: R drags a rectangle, E an ellipse by two clicks, C a cloud closed on its first corner; select, undo, Esc", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const page = await context.newPage();
  await page.goto("/sign-in");
  await signIn(page, "admin@plan-markup.test");
  await expect(page).toHaveURL("/workspace");
  await open(page);

  // R: press on one corner, drag to the opposite one, release.
  await arm(page, "r", /^Rectangle: drag from one corner/);
  await snapTo(page, 100, 100);
  await page.mouse.down();
  await snapTo(page, 300, 250);
  await page.mouse.up();
  await expect(markups(page)).toHaveAttribute("data-captions", "Rectangle");
  await expectUndo(page, "Undo Add rectangle");

  // With Select a click inside it selects it: Delete removes it, Ctrl+Z puts it back.
  await press(page, "v");
  await stable(page);
  const inside = await screenOf(page, 150, 200);
  await page.mouse.click(inside.x, inside.y);
  await press(page, "Delete");
  await expect(markups(page)).not.toHaveAttribute("data-captions", /.+/);
  await press(page, "Control+z");
  await expect(markups(page)).toHaveAttribute("data-captions", "Rectangle");

  // E: two clicks on opposite corners.
  await arm(page, "e", /^Ellipse: drag across its box/);
  await clickCorner(page, 100, 250);
  await clickCorner(page, 300, 100);
  await expect(markups(page)).toHaveAttribute("data-captions", "Rectangle | Ellipse");
  await expectUndo(page, "Undo Add ellipse");

  // C: a cloud, closed by a click on its first corner.
  await arm(page, "c", /^Cloud: click each corner/);
  await clickCorner(page, 100, 100);
  await clickCorner(page, 300, 100);
  await clickCorner(page, 300, 250);
  await clickCorner(page, 100, 100);
  await expect(markups(page)).toHaveAttribute("data-captions", "Rectangle | Ellipse | Cloud");
  await expectUndo(page, "Undo Add cloud");

  // Esc cancels a box after its first corner; Esc again: Select.
  await arm(page, "r", /^Rectangle: drag from one corner/);
  await clickCorner(page, 100, 100);
  await press(page, "Escape");
  await expect(markups(page)).toHaveAttribute("data-captions", "Rectangle | Ellipse | Cloud");
  await press(page, "Escape");
  await expect(selectTool(page)).toBeChecked();

  // Each was one step.
  await press(page, "Control+z");
  await expect(markups(page)).toHaveAttribute("data-captions", "Rectangle | Ellipse");
  await context.close();
});
