// Story 4.1: snapping on the committed fixture fixtures/pdf/snap.pdf (page 1,
// A4 landscape, user space origin at the corner): a rectangle (100, 100)-(300,
// 250), two lines crossing at (500, 200), a circle centred (700, 200) r 50.
// With the Length tool (armed for its snapping preview) the cursor snaps:
// endpoint, intersection, midpoint, on line; the status bar shows the snapped
// point; the content toggle off and Alt disable it; Shift holds 45° steps
// from the clicked point; the Select tool never snaps.
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./helpers";

const PDF = path.join(__dirname, "..", "fixtures", "pdf", "snap.pdf");
const PAGE_HEIGHT = 595;

const canvas = (page: Page) => page.getByTestId("drawing-canvas");
const readout = (page: Page) => page.getByTestId("status-bar").getByTestId("status-cursor-value");

/** Screen position of user space point (x, y) on page 1 (no /Rotate, box at the origin, view rotation 0). */
async function screenOf(page: Page, x: number, y: number) {
  const box = (await canvas(page).boundingBox())!;
  const [zoom, cx, cy] = ((await canvas(page).getAttribute("data-view")) ?? "").split(" ").map(Number);
  return { x: box.x + box.width / 2 + (x - cx) * zoom, y: box.y + box.height / 2 + (PAGE_HEIGHT - y - cy) * zoom };
}

/** Waits until the canvas stops moving or resizing (the HintBar appearing shifts it) and its view is stable. */
async function stable(page: Page) {
  let last = "";
  await expect
    .poll(async () => {
      const box = await canvas(page).boundingBox();
      const now = `${JSON.stringify(box)} ${await canvas(page).getAttribute("data-view")}`;
      const same = now === last;
      last = now;
      return same;
    }, { intervals: [100, 100, 200, 200, 400] })
    .toBe(true);
}

async function moveTo(page: Page, x: number, y: number) {
  const p = await screenOf(page, x, y);
  await page.mouse.move(p.x, p.y);
}

test("snap: endpoint, intersection, midpoint, on line; toggle off, Alt, Shift 45°, Select never snaps", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const page = await context.newPage();
  await page.goto("/sign-in");
  await signIn(page, "admin@plan-markup.test");
  await expect(page).toHaveURL("/workspace");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("toolbar", { name: "Document" }).getByRole("button", { name: "Open…" }).click();
  await (await chooser).setFiles({ name: "snap.pdf", mimeType: "application/pdf", buffer: readFileSync(PDF) });
  await expect(canvas(page)).toHaveAttribute("data-state", "ready");
  // The index is built in the worker after the page settles.
  await expect(canvas(page)).toHaveAttribute("data-snap-index", /^\d+$/, { timeout: 20_000 });

  // Select: no snapping.
  await moveTo(page, 101, 102);
  await expect(canvas(page)).not.toHaveAttribute("data-snap", /.+/);

  // Length, armed for its snapping preview (the HintBar says so).
  await page.getByRole("toolbar", { name: "Drawing tools" }).getByRole("radio", { name: "Length" }).click();
  await expect(page.getByText(/Length: snapping preview/)).toBeVisible();
  await stable(page);
  await moveTo(page, 102, 103);
  await expect(canvas(page)).toHaveAttribute("data-snap", "endpoint 100.00 100.00");
  await expect(readout(page)).toHaveText("X 100.0  Y 100.0 pt");
  await moveTo(page, 503, 198);
  await expect(canvas(page)).toHaveAttribute("data-snap", "intersection 500.00 200.00");
  await moveTo(page, 201, 103);
  await expect(canvas(page)).toHaveAttribute("data-snap", "midpoint 200.00 100.00");
  await moveTo(page, 150, 103);
  await expect(canvas(page)).toHaveAttribute("data-snap", /^on-line 150\.\d\d 100\.00$/);

  // Alt held: no snapping while it is down.
  await page.keyboard.down("Alt");
  await moveTo(page, 102, 103);
  await expect(canvas(page)).not.toHaveAttribute("data-snap", /.+/);
  await page.keyboard.up("Alt");
  await moveTo(page, 102, 104);
  await expect(canvas(page)).toHaveAttribute("data-snap", "endpoint 100.00 100.00");

  // Shift: from the clicked corner, a nearly horizontal move is horizontal.
  await page.mouse.down();
  await page.mouse.up();
  await page.keyboard.down("Shift");
  await moveTo(page, 180, 108);
  await expect(readout(page)).toHaveText(/^X \d+\.\d {2}Y 100\.0 pt$/);
  await page.keyboard.up("Shift");
  await page.keyboard.press("Escape");

  // Content snapping off in the status bar: nothing snaps.
  const content = page.getByTestId("status-bar").getByRole("button", { name: "Snap to content" });
  await content.click();
  await moveTo(page, 102, 103);
  await expect(canvas(page)).not.toHaveAttribute("data-snap", /.+/);
  await content.click();
  await moveTo(page, 103, 102);
  await expect(canvas(page)).toHaveAttribute("data-snap", "endpoint 100.00 100.00");

  // Back to Select: no glyph, no snap.
  await page.getByRole("toolbar", { name: "Drawing tools" }).getByRole("radio", { name: "Select" }).click();
  await moveTo(page, 102, 103);
  await expect(canvas(page)).not.toHaveAttribute("data-snap", /.+/);
  await context.close();
});
