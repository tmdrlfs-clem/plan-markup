// Story 4.10: Dynamic fill on the committed fixture (production build in CI).
//   snap.pdf (Story 4.1): page 1 A4 landscape, a rectangle (100, 100)-(300, 250).
// Covers: J arms Dynamic fill (the scale prompt; calibrated 1:100); a hold
// inside the rectangle spreads frame by frame and stops at its edges (timed,
// NFR5); Enter adds it as an area of 37.34 m² ± 1 %; undo; a hold outside the
// rectangle leaks and says so; Esc discards, Esc again returns to Select.
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

async function expectUndo(page: Page, label: string) {
  await page.getByRole("menubar").getByRole("menuitem", { name: "Edit" }).click();
  await expect(page.getByRole("menuitem", { name: label })).toBeEnabled();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menuitem", { name: label })).toBeHidden();
}

test("dynamic fill: hold inside the rectangle, Enter adds its area; a hold outside leaks; Esc", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const page = await context.newPage();
  await page.goto("/sign-in");
  await signIn(page, "admin@plan-markup.test");
  await expect(page).toHaveURL("/workspace");
  await open(page);

  // J arms it (canvas focus); it needs a scale.
  await canvas(page).focus();
  await page.keyboard.press("j");
  await expect(tool(page, "Dynamic fill")).toBeChecked();
  await expect(page.getByText(/Dynamic fill: press and hold inside a room/)).toBeVisible();
  await expect(prompt(page)).toBeVisible();
  await scale(page).click();
  await calibrate(page).getByTestId("calibrate-ratio").fill("1:100");
  await calibrate(page).getByRole("button", { name: "Apply" }).click();
  await expect(calibrate(page)).toBeHidden();
  await expect(prompt(page)).toBeHidden();
  await stable(page);

  // Hold inside the rectangle: the live area grows, then stops at the edges.
  const inside = await moveTo(page, 200, 175);
  const t0 = Date.now();
  await page.mouse.down();
  const live = async () => Number.parseFloat((await canvas(page).getAttribute("data-measure")) ?? "0");
  let last = -1;
  let done = 0;
  await expect
    .poll(
      async () => {
        const now = await live();
        if (now !== last) {
          last = now;
          done = Date.now() - t0;
          return false;
        }
        return now > 0;
      },
      { intervals: [100], timeout: 10_000 },
    )
    .toBe(true);
  await page.mouse.up();
  test.info().annotations.push({ type: "NFR5", description: `the rectangle completed in about ${done} ms of holding` });
  expect(done).toBeLessThan(2000);
  await page.mouse.move(inside.x + 1, inside.y);
  await page.keyboard.press("Enter");
  await expect(markups(page)).toHaveAttribute("data-markup-count", "1");
  const caption = (await markups(page).getAttribute("data-captions")) ?? "";
  const m2 = Number.parseFloat(caption);
  expect(Math.abs(m2 - 37.34) / 37.34).toBeLessThan(0.01);
  expect(caption).toMatch(/^\d+\.\d\d m², P \d+ mm$/);
  await expect(tool(page, "Dynamic fill")).toBeChecked();
  await expectUndo(page, "Undo Add area");
  await page.keyboard.press("Control+z");
  await expect(markups(page)).not.toHaveAttribute("data-captions", /.+/);

  // A hold outside the rectangle reaches the edge of the view: it leaks and says so.
  await moveTo(page, 600, 120);
  await page.mouse.down();
  await expect(page.getByRole("region", { name: /Notifications/ }).getByText(/The fill leaked out of the room/)).toBeVisible({ timeout: 10_000 });
  await page.mouse.up();
  await page.keyboard.press("Enter");
  await expect(markups(page)).not.toHaveAttribute("data-captions", /.+/);
  await page.keyboard.press("Escape");
  await expect(canvas(page)).not.toHaveAttribute("data-measure", /.+/);
  await page.keyboard.press("Escape");
  await expect(tool(page, "Select")).toBeChecked();
  await context.close();
});
