// Story 5.3: group, reorder, align and lock on the committed fixture (production build in CI).
//   snap.pdf (Story 4.1): page 1 A4 landscape, a rectangle (100, 100)-(300, 250).
// Covers, at 1:100 with two lengths, the rectangle's bottom edge (7056 mm) and
// left edge (5292 mm), the Measurements panel showing the selection: Ctrl+G
// groups them (a click on one selects both, a drag moves both), Ctrl+Shift+G
// ungroups; Ctrl+Shift+] brings the bottom one to the front (the drawing order
// of the captions flips); Align right from the context menu moves the left
// edge's length to the right edge; Lock from the context menu keeps a length
// from moving and from Delete (the cursor's tooltip and a note say so),
// Unlock frees it. Each step one undo.
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./helpers";

const PDF = path.join(__dirname, "..", "fixtures", "pdf", "snap.pdf");
const A4_HEIGHT = 595;
const BOTTOM = "7056 mm";
const LEFT = "5292 mm";
const BOTH = `${BOTTOM} | ${LEFT}`;

const canvas = (page: Page) => page.getByTestId("drawing-canvas");
const markups = (page: Page) => page.getByTestId("markups-canvas");
const scale = (page: Page) => page.getByTestId("status-bar").getByTestId("status-scale");
const calibrate = (page: Page) => page.getByRole("dialog", { name: "Calibrate" });
const rows = (page: Page) => page.getByTestId("measurements-row");
const menu = (page: Page) => page.getByRole("menu", { name: "Markup" });

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

async function clickAt(page: Page, x: number, y: number, button: "left" | "right" = "left") {
  const at = await screenOf(page, x, y);
  await page.mouse.click(at.x, at.y, { button });
}

async function dragFromTo(page: Page, from: [number, number], to: [number, number]) {
  const a = await screenOf(page, ...from);
  const b = await screenOf(page, ...to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 4 });
  await page.mouse.move(b.x, b.y, { steps: 4 });
  await page.mouse.up();
}

/** The Measurements panel's rows (in drawing order): selected or not. */
async function selected(page: Page): Promise<string[]> {
  return rows(page).evaluateAll((els) => els.map((el) => el.getAttribute("aria-selected") ?? ""));
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

test("group, reorder, align and lock: Ctrl+G / Ctrl+Shift+G, Ctrl+Shift+], the context menu's Align and Lock, undo", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const page = await context.newPage();
  await page.goto("/sign-in");
  await signIn(page, "admin@plan-markup.test");
  await expect(page).toHaveURL("/workspace");
  await open(page);

  // The Measurements panel; 1:100; lengths on the bottom and left edges; Select.
  await canvas(page).focus();
  await page.keyboard.press("Alt+u");
  await scale(page).click();
  await calibrate(page).getByTestId("calibrate-ratio").fill("1:100");
  await calibrate(page).getByRole("button", { name: "Apply" }).click();
  await expect(calibrate(page)).toBeHidden();
  await canvas(page).focus();
  await page.keyboard.press("Shift+Alt+L");
  await stable(page);
  await clickCorner(page, 100, 100);
  await clickCorner(page, 300, 100);
  await clickCorner(page, 100, 250);
  await clickCorner(page, 100, 100);
  await expect(markups(page)).toHaveAttribute("data-captions", BOTH);
  await press(page, "Escape");
  await stable(page);

  // Ctrl+A, Ctrl+G: a click on one selects both; a drag moves both.
  await press(page, "Control+a");
  await press(page, "Control+g");
  await expectUndo(page, "Undo Group markups");
  await clickAt(page, 200, 175);
  await expect.poll(() => selected(page)).toEqual(["false", "false"]);
  await clickAt(page, 200, 100);
  await expect.poll(() => selected(page)).toEqual(["true", "true"]);
  await dragFromTo(page, [200, 100], [200, 130]);
  await expectUndo(page, "Undo Move markups");
  await press(page, "Control+z");

  // Ctrl+Shift+G ungroups: a click selects one.
  await press(page, "Control+Shift+g");
  await expectUndo(page, "Undo Ungroup markups");
  await clickAt(page, 200, 175);
  await clickAt(page, 200, 100);
  await expect.poll(() => selected(page)).toEqual(["true", "false"]);

  // Ctrl+Shift+] brings the bottom one to the front: it paints last.
  await press(page, "Control+Shift+BracketRight");
  await expect(markups(page)).toHaveAttribute("data-captions", `${LEFT} | ${BOTTOM}`);
  await expectUndo(page, "Undo Bring to front");
  await press(page, "Control+z");
  await expect(markups(page)).toHaveAttribute("data-captions", BOTH);

  // Both selected; the context menu's Align right moves the left edge's length to x 300.
  await press(page, "Control+a");
  await clickAt(page, 200, 100, "right");
  await expect(menu(page)).toBeVisible();
  await expect.poll(() => selected(page)).toEqual(["true", "true"]);
  await menu(page).getByRole("menuitem", { name: "Align" }).click();
  await page.getByRole("menuitem", { name: "Align right" }).click();
  await expect(menu(page)).toBeHidden();
  await expectUndo(page, "Undo Align markups");
  await clickAt(page, 200, 175);
  await clickAt(page, 300, 175);
  await expect.poll(() => selected(page)).toEqual(["false", "true"]);
  await press(page, "Control+z");

  // A right-click on the left one selects it; Lock.
  await clickAt(page, 100, 175, "right");
  await expect.poll(() => selected(page)).toEqual(["false", "true"]);
  await menu(page).getByRole("menuitem", { name: "Lock" }).click();
  await expectUndo(page, "Undo Lock markup");

  // Locked: the tooltip; a drag moves nothing (a note says why); Delete keeps it.
  const over = await screenOf(page, 100, 175);
  await page.mouse.move(over.x, over.y);
  await expect(canvas(page)).toHaveAttribute("title", "Locked: right-click to unlock");
  await dragFromTo(page, [100, 175], [150, 175]);
  await expect(page.getByRole("region", { name: /Notifications/ }).getByText(/Locked markups can't be moved/)).toBeVisible();
  await clickAt(page, 200, 175);
  await clickAt(page, 100, 175);
  await expect.poll(() => selected(page)).toEqual(["false", "true"]);
  await press(page, "Delete");
  await expect(markups(page)).toHaveAttribute("data-captions", BOTH);

  // Unlock: Delete removes it.
  await clickAt(page, 100, 175, "right");
  await menu(page).getByRole("menuitem", { name: "Unlock" }).click();
  await expectUndo(page, "Undo Unlock markup");
  await clickAt(page, 100, 175);
  await press(page, "Delete");
  await expect(markups(page)).toHaveAttribute("data-captions", BOTTOM);
  await context.close();
});
