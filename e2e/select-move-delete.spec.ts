// Story 5.1: select, move and delete markups on the committed fixture (production build in CI).
//   snap.pdf (Story 4.1): page 1 A4 landscape, a rectangle (100, 100)-(300, 250).
// Covers, at 1:100 with two lengths on the rectangle's bottom and top edges
// (the Measurements panel shows the selection): a click selects one, empty
// space clears; a drag moves it (one undo step, undo puts it back); Shift +
// click adds the other; Shift + arrow nudges both (one step); Delete removes
// both with a toast whose Undo restores them; a marquee selects both; Ctrl+A
// selects the page's markups.
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./helpers";

const PDF = path.join(__dirname, "..", "fixtures", "pdf", "snap.pdf");
const A4_HEIGHT = 595;
const BOTH = "7056 mm | 7056 mm";

const canvas = (page: Page) => page.getByTestId("drawing-canvas");
const markups = (page: Page) => page.getByTestId("markups-canvas");
const scale = (page: Page) => page.getByTestId("status-bar").getByTestId("status-scale");
const calibrate = (page: Page) => page.getByRole("dialog", { name: "Calibrate" });
const rows = (page: Page) => page.getByTestId("measurements-row");

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

async function clickAt(page: Page, x: number, y: number, modifiers: ("Shift" | "Alt")[] = []) {
  const at = await screenOf(page, x, y);
  for (const m of modifiers) await page.keyboard.down(m);
  await page.mouse.click(at.x, at.y);
  for (const m of modifiers) await page.keyboard.up(m);
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

async function selected(page: Page): Promise<string[]> {
  return rows(page).evaluateAll((els) => els.map((el) => el.getAttribute("aria-selected") ?? ""));
}

async function expectUndo(page: Page, label: string) {
  await page.getByRole("menubar").getByRole("menuitem", { name: "Edit" }).click();
  await expect(page.getByRole("menuitem", { name: label })).toBeEnabled();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menuitem", { name: label })).toBeHidden();
}

test("select, move and delete: click, drag, Shift+click, nudge, Delete with Undo toast, marquee, Ctrl+A", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const page = await context.newPage();
  await page.goto("/sign-in");
  await signIn(page, "admin@plan-markup.test");
  await expect(page).toHaveURL("/workspace");
  await open(page);

  // The Measurements panel shows the selection; 1:100; lengths on the bottom and top edges.
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
  await clickCorner(page, 300, 250);
  await expect(markups(page)).toHaveAttribute("data-captions", BOTH);
  await canvas(page).focus();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("toolbar", { name: "Drawing tools" }).getByRole("radio", { name: "Select", exact: true })).toBeChecked();
  await stable(page);

  // Click selects; empty space clears.
  await clickAt(page, 200, 101);
  await expect.poll(() => selected(page)).toEqual(["true", "false"]);
  await clickAt(page, 200, 175);
  await expect.poll(() => selected(page)).toEqual(["false", "false"]);

  // A drag moves the bottom length 30 pt up: one undo step; it is no longer at its old place.
  await dragFromTo(page, [200, 100], [200, 130]);
  await expect.poll(() => selected(page)).toEqual(["true", "false"]);
  await expectUndo(page, "Undo Move markup");
  await clickAt(page, 200, 100);
  await expect.poll(() => selected(page)).toEqual(["false", "false"]);
  await clickAt(page, 200, 130);
  await expect.poll(() => selected(page)).toEqual(["true", "false"]);
  await canvas(page).focus();
  await page.keyboard.press("Control+z");
  await clickAt(page, 200, 100);
  await expect.poll(() => selected(page)).toEqual(["true", "false"]);

  // Shift + click adds the top one; Shift + ArrowUp nudges both (one step).
  await clickAt(page, 200, 250, ["Shift"]);
  await expect.poll(() => selected(page)).toEqual(["true", "true"]);
  await page.keyboard.press("Shift+ArrowUp");
  await expectUndo(page, "Undo Move markups");

  // Delete: both go, a toast offers Undo, which brings them back.
  await canvas(page).hover();
  await canvas(page).focus();
  await page.keyboard.press("Delete");
  await expect(markups(page)).not.toHaveAttribute("data-captions", /.+/);
  const notifications = page.getByRole("region", { name: /Notifications/ });
  await expect(notifications.getByText("Deleted 2 markups")).toBeVisible();
  await notifications.getByRole("button", { name: "Undo" }).click();
  await expect(markups(page)).toHaveAttribute("data-captions", BOTH);

  // A marquee around the rectangle selects both; Ctrl+A too.
  await clickAt(page, 200, 175);
  await expect.poll(() => selected(page)).toEqual(["false", "false"]);
  await dragFromTo(page, [60, 60], [340, 300]);
  await expect.poll(() => selected(page)).toEqual(["true", "true"]);
  await clickAt(page, 200, 175);
  await expect.poll(() => selected(page)).toEqual(["false", "false"]);
  await canvas(page).focus();
  await page.keyboard.press("Control+a");
  await expect.poll(() => selected(page)).toEqual(["true", "true"]);
  await context.close();
});
