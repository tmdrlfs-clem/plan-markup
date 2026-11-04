// Story 5.12: markup layers on the committed fixture fixtures/pdf/snap.pdf.
// Covers: Alt+Y opens Layers; New layer is active and a rectangle drawn goes
// to it; hiding the layer hides the rectangle (Show brings it back), each one
// undo step; deleting the layer asks where its markup goes (with the scope)
// and moving it to "No layer" keeps it.
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

test("layers: Alt+Y, a new active layer takes a rectangle; hide and show it; delete it moving the markup to No layer", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const page = await context.newPage();
  await page.goto("/sign-in");
  await signIn(page, "admin@plan-markup.test");
  await expect(page).toHaveURL("/workspace");
  await open(page);

  await press(page, "Alt+y");
  const panel = page.getByTestId("layers-panel");
  await expect(panel).toBeVisible();
  await panel.getByRole("button", { name: "New layer" }).click();
  await expect(panel.getByRole("radio", { name: "Make Layer 1 the active layer" })).toBeChecked();
  await expectUndo(page, "Undo Add layer");

  // A rectangle goes to the active layer.
  await press(page, "r");
  await expect(page.getByText(/^Rectangle: drag from one corner/)).toBeVisible();
  await stable(page);
  const a = await screenOf(page, 450, 100);
  const b = await screenOf(page, 600, 250);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 6 });
  await page.mouse.up();
  await expect(markups(page)).toHaveAttribute("data-captions", "Rectangle");
  // The row counts its markup.
  await expect(panel.getByTestId("layer-row")).toHaveText(/Layer 1\s*1/);

  // Hide: the rectangle is not shown; Show: it is back.
  await panel.getByRole("button", { name: "Hide Layer 1" }).click();
  await expect(markups(page)).not.toHaveAttribute("data-captions", /.+/);
  await expectUndo(page, "Undo Hide layer");
  await panel.getByRole("button", { name: "Show Layer 1" }).click();
  await expect(markups(page)).toHaveAttribute("data-captions", "Rectangle");

  // Delete: the dialog shows the scope; moving the markup to No layer keeps it.
  await panel.getByRole("button", { name: "Delete Layer 1" }).click();
  const dialog = page.getByRole("dialog", { name: "Delete layer “Layer 1”?" });
  await expect(dialog.getByText("It has 1 markup on 1 page.")).toBeVisible();
  await dialog.getByRole("button", { name: "Delete layer", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(panel.getByTestId("layer-row")).toHaveCount(0);
  await expect(markups(page)).toHaveAttribute("data-captions", "Rectangle");
  await expectUndo(page, "Undo Delete layer");
  await context.close();
});
