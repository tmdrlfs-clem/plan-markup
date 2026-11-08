// Story 9.2: zones in the 4541 panel on the committed fixture.
//   snap.pdf (Story 4.1): page 1 A4 landscape, a rectangle (100, 100)-(300, 250).
// Covers: Alt+4 on an uncalibrated page asks for a calibration (its button
// opens Calibrate); at 1:100 the tip, the checklist and Polygon zone; a zone
// around the rectangle is listed (Zone 1, Office, ELH, 37.3 m²) and ticks the
// checklist; undo / redo; the canvas and the list share the selection; zones
// stay out of the Markups List. Story 9.3: the selected zone's figures and
// mapping; a use change sets the hazard and figures at once; undo.
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./helpers";

const PDF = path.join(__dirname, "..", "fixtures", "pdf", "snap.pdf");
const A4_HEIGHT = 595;

const canvas = (page: Page) => page.getByTestId("drawing-canvas");
const markups = (page: Page) => page.getByTestId("markups-canvas");
const calibrate = (page: Page) => page.getByRole("dialog", { name: "Calibrate" });
const panel = (page: Page) => page.getByTestId("sprinkler-panel");
const tool = (page: Page, name: string) => page.getByRole("toolbar", { name: "Drawing tools" }).getByRole("radio", { name, exact: true });

async function open(page: Page) {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("toolbar", { name: "Document" }).getByRole("button", { name: "Open…" }).click();
  await (
    await chooser
  ).setFiles({
    name: "snap.pdf",
    mimeType: "application/pdf",
    buffer: readFileSync(PDF),
  });
  await expect(canvas(page)).toHaveAttribute("data-state", "ready");
  await expect(canvas(page)).toHaveAttribute("data-snap-index", /^\d+$/, {
    timeout: 20_000,
  });
}

/** Screen position of user space point (x, y) on the unrotated A4 page. */
async function screenOf(page: Page, x: number, y: number) {
  const box = (await canvas(page).boundingBox())!;
  const [zoom, cx, cy] = ((await canvas(page).getAttribute("data-view")) ?? "").split(" ").map(Number);
  return {
    x: box.x + box.width / 2 + (x - cx) * zoom,
    y: box.y + box.height / 2 + (A4_HEIGHT - y - cy) * zoom,
  };
}

async function stable(page: Page) {
  let last = "";
  await expect
    .poll(
      async () => {
        const now = `${JSON.stringify(await canvas(page).boundingBox())} ${await canvas(page).getAttribute("data-view")}`;
        const same = now === last;
        last = now;
        return same;
      },
      { intervals: [100, 100, 200, 200, 400] },
    )
    .toBe(true);
}

async function clickCorner(page: Page, x: number, y: number) {
  const at = await screenOf(page, x, y);
  await page.mouse.move(at.x, at.y);
  await expect(canvas(page)).toHaveAttribute("data-snap", /^endpoint /);
  await page.mouse.click(at.x, at.y);
}

async function clickAt(page: Page, x: number, y: number) {
  const at = await screenOf(page, x, y);
  await page.mouse.click(at.x, at.y);
}

test("4541 panel: calibrate first, polygon zone listed with use, hazard and area, selection shared", async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 1600, height: 900 },
  });
  const page = await context.newPage();
  await page.goto("/sign-in");
  await signIn(page, "admin@plan-markup.test");
  await expect(page).toHaveURL("/workspace");
  await open(page);

  // Alt+4 on an uncalibrated page: only the calibration call.
  await canvas(page).focus();
  await page.keyboard.press("Alt+4");
  const first = page.getByTestId("sprinkler-calibrate-first");
  await expect(first).toContainText("Calibrate this page first");
  await first.getByRole("button", { name: "Calibrate" }).click();
  await calibrate(page).getByTestId("calibrate-ratio").fill("1:100");
  await calibrate(page).getByRole("button", { name: "Apply" }).click();
  await expect(calibrate(page)).toBeHidden();

  // The tip, the empty checklist, Polygon zone.
  await expect(panel(page).getByTestId("tip-sprinkler-zones")).toBeVisible();
  await expect(panel(page).getByTestId("sprinkler-checklist").getByRole("listitem").first()).toHaveAttribute("data-done", "false");
  await expect(panel(page).getByTestId("zones-empty")).toBeVisible();
  await panel(page).getByRole("button", { name: "Polygon zone" }).click();
  await expect(tool(page, "Area")).toBeChecked();
  await stable(page);
  for (const [x, y] of [
    [102, 103],
    [298, 102],
    [298, 248],
    [102, 248],
  ] as const)
    await clickCorner(page, x, y);
  await page.keyboard.press("Enter");

  // Listed and ticked; on the canvas by its name (no measurement caption).
  await expect(markups(page)).toHaveAttribute("data-captions", "Zone 1");
  const row = panel(page).getByTestId("zone-row");
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("Zone 1");
  await expect(row).toContainText("Office");
  await expect(row.getByTestId("hazard-chip")).toHaveText("ELH");
  await expect(row).toContainText(/37\.\d m²/);
  await expect(row).toHaveAttribute("data-selected", "true");
  await expect(panel(page).getByTestId("sprinkler-checklist").getByRole("listitem").nth(0)).toHaveAttribute("data-done", "true");
  await expect(panel(page).getByTestId("sprinkler-checklist").getByRole("listitem").nth(1)).toHaveAttribute("data-done", "true");

  // Undo and redo through the same op path.
  await canvas(page).focus();
  await page.keyboard.press("Control+z");
  await expect(panel(page).getByTestId("zones-empty")).toBeVisible();
  await page.keyboard.press("Control+y");
  await expect(row).toHaveCount(1);

  // The canvas and the list share the selection.
  await tool(page, "Select").click();
  await clickAt(page, 50, 50);
  await expect(row).toHaveAttribute("data-selected", "false");
  await clickAt(page, 200, 175);
  await expect(row).toHaveAttribute("data-selected", "true");
  await page.keyboard.press("Escape");
  await expect(row).toHaveAttribute("data-selected", "false");
  await row.getByRole("button", { name: /Zone 1/ }).click();
  await expect(row).toHaveAttribute("data-selected", "true");

  // Story 9.3: the figures of the selected zone, from the platform mapping read from the database.
  const figures = panel(page).getByTestId("zone-figures");
  await expect(figures).toContainText("ELH · NZS 4541 v1");
  await expect(figures.getByTestId("figure-Amax")).toContainText("21 m²");
  await expect(figures.getByTestId("mapping-source")).toHaveText("Platform default mapping v1 (draft, not yet verified)");
  // A use change updates the hazard and the figures at once; undo restores them.
  await row.getByRole("combobox", { name: "Use of Zone 1" }).click();
  await page.getByRole("option", { name: "Storage (OH2)" }).click();
  await expect(row.getByTestId("hazard-chip")).toHaveText("OH2");
  await expect(figures).toContainText("OH2 · NZS 4541 v1");
  await expect(figures.getByTestId("figure-Amax")).toContainText("12 m²");
  await expect(figures.getByTestId("figure-Smax")).toContainText("4 m");
  await canvas(page).focus();
  await page.keyboard.press("Control+z");
  await expect(row.getByTestId("hazard-chip")).toHaveText("ELH");

  // Zones are not markups to list.
  await page.keyboard.press("Shift+Alt+L");
  await expect(page.getByTestId("markups-list-empty")).toBeVisible();

  // The tip is dismissed (the Markups List is the bottom panel; the 4541 panel stays open).
  await panel(page).getByRole("button", { name: "Dismiss tip" }).click();
  await expect(panel(page).getByTestId("tip-sprinkler-zones")).toBeHidden();
  await context.close();
});
