// Story 4.8: Area and Count on the committed fixture (production build in CI).
//   snap.pdf (Story 4.1): page 1 A4 landscape, a rectangle (100, 100)-(300, 250).
// Covers: Count from Shift+Alt+C on the uncalibrated page (no scale prompt),
// four markers → "4", Backspace, Esc keeping the count, undo / redo; Area
// from Shift+Alt+A (the scale prompt) and the ToolRail around the rectangle at
// 1:100 (37.34 m², P 24694 mm), the live area, finishing by Enter, by a click
// on the first corner and by a double-click, a crossing polygon refused, undo
// / redo, Esc.
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { armMeasureTool, signIn } from "./helpers";

const PDF = path.join(__dirname, "..", "fixtures", "pdf", "snap.pdf");
const A4_HEIGHT = 595;
const AREA = "37.34 m², P 24694 mm";

const canvas = (page: Page) => page.getByTestId("drawing-canvas");
const markups = (page: Page) => page.getByTestId("markups-canvas");
const scale = (page: Page) => page.getByTestId("status-bar").getByTestId("status-scale");
const calibrate = (page: Page) => page.getByRole("dialog", { name: "Calibrate" });
const prompt = (page: Page) => page.getByRole("region", { name: "Scale not set" });
const tool = (page: Page, name: string) => page.getByRole("toolbar", { name: "Drawing tools" }).getByRole("radio", { name, exact: true });

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

async function snapCorner(page: Page, x: number, y: number) {
  const at = await moveTo(page, x, y);
  await expect(canvas(page)).toHaveAttribute("data-snap", /^endpoint /);
  return at;
}

async function clickCorner(page: Page, x: number, y: number) {
  const at = await snapCorner(page, x, y);
  await page.mouse.click(at.x, at.y);
}

async function expectUndo(page: Page, label: string) {
  await page.getByRole("menubar").getByRole("menuitem", { name: "Edit" }).click();
  await expect(page.getByRole("menuitem", { name: label })).toBeEnabled();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menuitem", { name: label })).toBeHidden();
}

test("area and count: count without a scale, Esc keeps it; area live, Enter / first corner / double-click, crossing refused, undo", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const page = await context.newPage();
  await page.goto("/sign-in");
  await signIn(page, "admin@plan-markup.test");
  await expect(page).toHaveURL("/workspace");
  await open(page);

  // Count on the uncalibrated page: no scale prompt; four markers (not snapped), the running count.
  await canvas(page).focus();
  await page.keyboard.press("Shift+Alt+C");
  await expect(tool(page, "Count")).toBeChecked();
  await expect(page.getByText(/Count: click each item/)).toBeVisible();
  await stable(page);
  await expect(prompt(page)).toBeHidden();
  for (const x of [140, 170, 200, 230]) {
    const at = await moveTo(page, x, 180);
    await page.mouse.click(at.x, at.y);
  }
  await moveTo(page, 260, 180);
  await expect(canvas(page)).toHaveAttribute("data-measure", "4");
  // Backspace removes the last marker; a fifth click; Esc keeps the count (D4) and the tool.
  await page.keyboard.press("Backspace");
  await moveTo(page, 262, 182);
  await expect(canvas(page)).toHaveAttribute("data-measure", "3");
  await page.mouse.click((await screenOf(page, 245, 180)).x, (await screenOf(page, 245, 180)).y);
  await page.keyboard.press("Escape");
  await expect(markups(page)).toHaveAttribute("data-captions", "4");
  await expect(tool(page, "Count")).toBeChecked();
  await expectUndo(page, "Undo Add count");
  await page.keyboard.press("Control+z");
  await expect(markups(page)).not.toHaveAttribute("data-captions", /.+/);
  await page.keyboard.press("Control+y");
  await expect(markups(page)).toHaveAttribute("data-captions", "4");

  // Area on the uncalibrated page: the scale prompt; calibrated 1:100.
  await canvas(page).focus();
  await page.keyboard.press("Shift+Alt+A");
  await expect(tool(page, "Area")).toBeChecked();
  await expect(prompt(page)).toBeVisible();
  await scale(page).click();
  await calibrate(page).getByTestId("calibrate-ratio").fill("1:100");
  await calibrate(page).getByRole("button", { name: "Apply" }).click();
  await expect(calibrate(page)).toBeHidden();
  await expect(prompt(page)).toBeHidden();
  await expect(tool(page, "Area")).toBeChecked();
  await stable(page);

  // Around the rectangle: the live area before the last corner, Enter closes it.
  await clickCorner(page, 102, 103);
  await clickCorner(page, 298, 102);
  await clickCorner(page, 298, 248);
  await snapCorner(page, 102, 248);
  await expect(canvas(page)).toHaveAttribute("data-measure", "37.34 m²");
  await page.mouse.click((await screenOf(page, 100, 250)).x, (await screenOf(page, 100, 250)).y);
  await page.keyboard.press("Enter");
  await expect(markups(page)).toHaveAttribute("data-captions", `4 | ${AREA}`);
  await expect(tool(page, "Area")).toBeChecked();
  await expectUndo(page, "Undo Add area");
  await page.keyboard.press("Control+z");
  await expect(markups(page)).toHaveAttribute("data-captions", "4");
  await page.keyboard.press("Control+y");
  await expect(markups(page)).toHaveAttribute("data-captions", `4 | ${AREA}`);

  // From the ToolRail; a click on the first corner closes it.
  await tool(page, "Select").click();
  await armMeasureTool(page, "Area");
  await stable(page);
  for (const [x, y] of [[102, 103], [298, 102], [298, 248], [102, 248], [102, 103]] as const) await clickCorner(page, x, y);
  await expect(markups(page)).toHaveAttribute("data-captions", `4 | ${AREA} | ${AREA}`);

  // A double-click on the last corner closes it too.
  for (const [x, y] of [[102, 103], [298, 102], [298, 248]] as const) await clickCorner(page, x, y);
  const last = await snapCorner(page, 102, 248);
  await page.mouse.dblclick(last.x, last.y);
  await expect(markups(page)).toHaveAttribute("data-markup-count", "4");

  // A polygon that crosses itself is not added; Esc cancels it, Esc again returns to Select.
  for (const [x, y] of [[102, 103], [298, 248], [298, 102]] as const) await clickCorner(page, x, y);
  await snapCorner(page, 102, 248);
  await expect(canvas(page)).toHaveAttribute("data-measure", "Crosses itself");
  await page.mouse.click((await screenOf(page, 100, 250)).x, (await screenOf(page, 100, 250)).y);
  await page.keyboard.press("Enter");
  await expect(markups(page)).toHaveAttribute("data-markup-count", "4");
  await expect(canvas(page)).toHaveAttribute("data-measure", /.+/);
  await page.keyboard.press("Escape");
  await expect(canvas(page)).not.toHaveAttribute("data-measure", /.+/);
  await page.keyboard.press("Escape");
  await expect(tool(page, "Select")).toBeChecked();
  await expect(markups(page)).toHaveAttribute("data-markup-count", "4");
  await context.close();
});
