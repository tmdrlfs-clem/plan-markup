// Story 4.11: the Measurements panel on the committed fixture (production build in CI).
//   snap.pdf (Story 4.1): page 1 A4 landscape, a rectangle (100, 100)-(300, 250).
// Covers: Alt+U with no measurements (the empty state names the tools); at
// 1:100 two lengths along the rectangle's sides (7056 + 5292 mm) and an area
// around it (37.34 m²) → Length (2) 12347 mm and Area (1) 37.34 m²; the units
// select converts to m; a row click selects the measurement; Esc on the canvas
// clears it; undo removes the area's group.
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./helpers";

const PDF = path.join(__dirname, "..", "fixtures", "pdf", "snap.pdf");
const A4_HEIGHT = 595;

const canvas = (page: Page) => page.getByTestId("drawing-canvas");
const markups = (page: Page) => page.getByTestId("markups-canvas");
const scale = (page: Page) => page.getByTestId("status-bar").getByTestId("status-scale");
const calibrate = (page: Page) => page.getByRole("dialog", { name: "Calibrate" });
const group = (page: Page, type: string) => page.getByTestId(`measurements-group-${type}`);

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

test("measurements panel: empty state, groups with totals, units, row selects, Esc, undo", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const page = await context.newPage();
  await page.goto("/sign-in");
  await signIn(page, "admin@plan-markup.test");
  await expect(page).toHaveURL("/workspace");
  await open(page);

  // Alt+U: no measurements yet; the hint names the tools.
  await canvas(page).focus();
  await page.keyboard.press("Alt+u");
  await expect(page.getByTestId("measurements-empty")).toContainText("Measure with Length, Polylength, Area");

  // 1:100, then two lengths and an area around the rectangle.
  await scale(page).click();
  await calibrate(page).getByTestId("calibrate-ratio").fill("1:100");
  await calibrate(page).getByRole("button", { name: "Apply" }).click();
  await expect(calibrate(page)).toBeHidden();
  await canvas(page).focus();
  await page.keyboard.press("Shift+Alt+L");
  await stable(page);
  await clickCorner(page, 100, 100);
  await clickCorner(page, 300, 100);
  await clickCorner(page, 100, 100);
  await clickCorner(page, 100, 250);
  await page.keyboard.press("Shift+Alt+A");
  await clickCorner(page, 100, 100);
  await clickCorner(page, 300, 100);
  await clickCorner(page, 300, 250);
  await clickCorner(page, 100, 250);
  await page.keyboard.press("Enter");
  await expect(markups(page)).toHaveAttribute("data-captions", "7056 mm | 5292 mm | 37.34 m², P 24694 mm");

  // Groups with totals (the active page's mm).
  await expect(group(page, "length")).toContainText("Length (2)");
  await expect(group(page, "length").getByTestId("measurements-total")).toHaveText("12347 mm");
  await expect(group(page, "area").getByTestId("measurements-total")).toHaveText("37.34 m²");
  await expect(group(page, "length").getByTestId("measurements-row")).toHaveText(["Page 17056 mm", "Page 15292 mm"]);

  // The units select converts every row and total.
  await page.getByRole("combobox", { name: "Units" }).click();
  await page.getByRole("option", { name: "m", exact: true }).click();
  await expect(group(page, "length").getByTestId("measurements-total")).toHaveText("12.35 m");
  await expect(group(page, "length").getByTestId("measurements-row").first()).toContainText("7.06 m");

  // A row click selects its measurement (and keeps it in view); Esc on the canvas with Select clears it.
  // Esc on the canvas: the Area tool → Select.
  await canvas(page).focus();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("toolbar", { name: "Drawing tools" }).getByRole("radio", { name: "Select", exact: true })).toBeChecked();
  const area = group(page, "area").getByTestId("measurements-row");
  await area.click();
  await expect(area).toHaveAttribute("aria-selected", "true");
  await stable(page);
  const view = (await canvas(page).getAttribute("data-view")) ?? "";
  const corner = await screenOf(page, 300, 250);
  const box = (await canvas(page).boundingBox())!;
  expect(corner.x).toBeLessThan(box.x + box.width);
  expect(corner.y).toBeGreaterThan(box.y);
  await canvas(page).hover();
  await page.keyboard.press("Escape");
  await expect(area).toHaveAttribute("aria-selected", "false");
  expect(await canvas(page).getAttribute("data-view")).toBe(view);

  // Undo removes the area's group.
  await canvas(page).focus();
  await page.keyboard.press("Control+z");
  await expect(group(page, "area")).toHaveCount(0);
  await expect(group(page, "length").getByTestId("measurements-total")).toHaveText("12.35 m");
  await context.close();
});
