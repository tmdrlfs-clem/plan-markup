// Story 5.2: resize, rotate, vertices, copy and paste on the committed fixture (production build in CI).
//   snap.pdf (Story 4.1): page 1 A4 landscape, a rectangle (100, 100)-(300, 250).
// Covers, at 1:100 with an area around the rectangle (37.34 m²): the top-right
// handle with Shift doubles it (149.34 m²), undo; the rotate handle turns it
// 90° (the area stays), undo; a vertex drag changes it, undo; Ctrl+C / Ctrl+V
// at the pointer and Ctrl+Shift+V in place add areas; Ctrl+drag copies; each
// step one undo.
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./helpers";

const PDF = path.join(__dirname, "..", "fixtures", "pdf", "snap.pdf");
const A4_HEIGHT = 595;
const AREA = "37.34 m², P 24694 mm";
/** The resize handles sit 8 CSS px outside the box; the rotate handle 24 px above it. */
const HANDLE_GAP = 8;
const ROTATE_GAP = 24;

const canvas = (page: Page) => page.getByTestId("drawing-canvas");
const markups = (page: Page) => page.getByTestId("markups-canvas");
const scale = (page: Page) => page.getByTestId("status-bar").getByTestId("status-scale");
const calibrate = (page: Page) => page.getByRole("dialog", { name: "Calibrate" });

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

async function drag(page: Page, a: { x: number; y: number }, b: { x: number; y: number }, keys: string[] = []) {
  await page.mouse.move(a.x, a.y);
  for (const k of keys) await page.keyboard.down(k);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 4 });
  await page.mouse.move(b.x, b.y, { steps: 4 });
  await page.mouse.up();
  for (const k of keys) await page.keyboard.up(k);
}

async function expectUndo(page: Page, label: string) {
  await page.getByRole("menubar").getByRole("menuitem", { name: "Edit" }).click();
  await expect(page.getByRole("menuitem", { name: label })).toBeEnabled();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menuitem", { name: label })).toBeHidden();
}

/** Focuses the canvas once the closed Edit menu has given focus back to its trigger. */
async function focusCanvas(page: Page) {
  await expect(async () => {
    await canvas(page).focus();
    await expect(canvas(page)).toBeFocused({ timeout: 200 });
  }).toPass();
}

async function undo(page: Page) {
  await focusCanvas(page);
  await page.keyboard.press("Control+z");
}

test("resize, rotate, vertex, copy and paste: handles, Ctrl+C / V / Shift+V, Ctrl+drag, undo", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const page = await context.newPage();
  await page.goto("/sign-in");
  await signIn(page, "admin@plan-markup.test");
  await expect(page).toHaveURL("/workspace");
  await open(page);

  // 1:100; an area around the rectangle; Select; click inside selects it.
  await scale(page).click();
  await calibrate(page).getByTestId("calibrate-ratio").fill("1:100");
  await calibrate(page).getByRole("button", { name: "Apply" }).click();
  await expect(calibrate(page)).toBeHidden();
  await canvas(page).focus();
  await page.keyboard.press("Shift+Alt+A");
  await stable(page);
  for (const [x, y] of [[100, 100], [300, 100], [300, 250], [100, 250]]) await clickCorner(page, x, y);
  await page.keyboard.press("Enter");
  await expect(markups(page)).toHaveAttribute("data-captions", AREA);
  await page.keyboard.press("Escape");
  await stable(page);
  const inside = await screenOf(page, 200, 175);
  await page.mouse.click(inside.x, inside.y);

  // The top-right handle with Shift to twice the size: the area ×4.
  const corner = await screenOf(page, 300, 250);
  const far = await screenOf(page, 500, 400);
  await drag(page, { x: corner.x + HANDLE_GAP, y: corner.y - HANDLE_GAP }, { x: far.x + HANDLE_GAP, y: far.y - HANDLE_GAP }, ["Shift"]);
  await expect(markups(page)).toHaveAttribute("data-captions", /^149\.3\d m²/);
  await expectUndo(page, "Undo Resize markup");
  await undo(page);
  await expect(markups(page)).toHaveAttribute("data-captions", AREA);

  // The rotate handle a quarter turn (to the left of the centre): the same area, turned.
  const top = await screenOf(page, 200, 250);
  const centre = await screenOf(page, 200, 175);
  const handle = { x: top.x, y: top.y - ROTATE_GAP };
  await drag(page, handle, { x: centre.x - (centre.y - handle.y), y: centre.y });
  await expectUndo(page, "Undo Rotate markup");
  await expect(markups(page)).toHaveAttribute("data-captions", /^37\.34 m²/);
  await undo(page);
  await expect(markups(page)).toHaveAttribute("data-captions", AREA);

  // A vertex: (300, 100) to (350, 100) makes a trapezoid (42.00 m²).
  const vertex = await screenOf(page, 300, 100);
  const moved = await screenOf(page, 350, 100);
  await drag(page, vertex, moved);
  await expect(markups(page)).toHaveAttribute("data-captions", /^4[12]\.\d\d m²/);
  await expectUndo(page, "Undo Move vertex");
  await undo(page);
  await expect(markups(page)).toHaveAttribute("data-captions", AREA);

  // Ctrl+C, Ctrl+V at the pointer, Ctrl+Shift+V in place.
  await focusCanvas(page);
  const target = await screenOf(page, 550, 300);
  await page.mouse.move(target.x, target.y);
  await page.keyboard.press("Control+c");
  await page.keyboard.press("Control+v");
  await expect(markups(page)).toHaveAttribute("data-captions", `${AREA} | ${AREA}`);
  await expectUndo(page, "Undo Paste markup");
  await focusCanvas(page);
  await page.keyboard.press("Control+Shift+v");
  await expect(markups(page)).toHaveAttribute("data-captions", `${AREA} | ${AREA} | ${AREA}`);

  // Ctrl+drag copies the one under the pointer (the copy in place, on top).
  const from = await screenOf(page, 150, 175);
  const to = await screenOf(page, 150, 60);
  await drag(page, from, to, ["Control"]);
  await expect(markups(page)).toHaveAttribute("data-captions", `${AREA} | ${AREA} | ${AREA} | ${AREA}`);
  await expectUndo(page, "Undo Copy markup");
  await undo(page);
  await expect(markups(page)).toHaveAttribute("data-captions", `${AREA} | ${AREA} | ${AREA}`);
  await context.close();
});
