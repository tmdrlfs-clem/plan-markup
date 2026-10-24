// Story 4.3, optional local-only check (never in CI: the drawings are private
// and git-ignored). Run: PERF_L17=1 E2E_PROD=1 npx playwright test perf-calibrate
// (after `npm run build`).
//
// L21: the Calibrate dialog shows the disagreeing printed scales (1:75 @ A1,
// 1:200 @ A3); "Use 1:75 @ A1" calibrates the page. Saves
// fixtures/private/traces/4-3-calibrate-dialog.png.
// L17: two points snapped to the ends of the "1905" dimension (user space
// (-169.01, 98.57) to (-97.01, 98.57), 72 pt of paper: 1:75), distance 1905 mm:
// the bar shows Scale 1:75 and the cursor readout differs by 1905 mm between
// the two ends. Saves fixtures/private/traces/4-3-calibrated.png.
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./helpers";

const PRIVATE = path.join(__dirname, "..", "fixtures", "private");
const L17 = path.join(PRIVATE, "pdf", "A1721-LEVEL-17-REFLECTED-CEILING-PLAN-Rev.2.pdf");
const L21 = path.join(PRIVATE, "pdf", "A2121-LEVEL-21-REFLECTED-CEILING-PLAN-Rev.2.pdf");
/** L17's page box (user space, centred on 0, 0). */
const L17_VIEW = [-1191.97, -841.89, 1191.97, 841.89] as const;

test.skip(process.env.PERF_L17 !== "1" || !existsSync(L17) || !existsSync(L21), "local check: set PERF_L17=1 (needs the private drawings)");

const canvas = (page: Page) => page.getByTestId("drawing-canvas");
const scale = (page: Page) => page.getByTestId("status-bar").getByTestId("status-scale");
const readout = (page: Page) => page.getByTestId("status-bar").getByTestId("status-cursor-value");
const dialog = (page: Page) => page.getByRole("dialog", { name: "Calibrate" });

async function open(page: Page, file: string) {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("toolbar", { name: "Document" }).getByRole("button", { name: "Open…" }).click();
  await (await chooser).setFiles(file);
  await expect(canvas(page)).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
}

/** Screen position of L17 user space point (x, y) (no /Rotate, view rotation 0). */
async function screenOf(page: Page, x: number, y: number) {
  const box = (await canvas(page).boundingBox())!;
  const [zoom, cx, cy] = ((await canvas(page).getAttribute("data-view")) ?? "").split(" ").map(Number);
  const px = x - L17_VIEW[0];
  const py = L17_VIEW[3] - y;
  return { x: box.x + box.width / 2 + (px - cx) * zoom, y: box.y + box.height / 2 + (py - cy) * zoom };
}

/** The readout's X in mm. */
async function readX(page: Page): Promise<number> {
  const text = (await readout(page).textContent()) ?? "";
  return Number(/^X (-?[\d.]+)/.exec(text)?.[1]);
}

test("L21 conflict in the dialog, L17 two points on the 1905 dimension", async ({ browser }) => {
  test.setTimeout(240_000);
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();
  await page.goto("/sign-in");
  await signIn(page, "admin@plan-markup.test");
  await expect(page).toHaveURL("/workspace");
  mkdirSync(path.join(PRIVATE, "traces"), { recursive: true });

  await open(page, L21);
  await expect(scale(page)).toHaveText("Scales disagree — Verify", { timeout: 30_000 });
  await scale(page).click();
  await expect(dialog(page).getByTestId("calibrate-conflict")).toContainText("Printed scales disagree: 1:75 @ A1 = 1:150 @ A3, but 1:200 @ A3 is printed");
  await page.screenshot({ path: path.join(PRIVATE, "traces", "4-3-calibrate-dialog.png") });
  await dialog(page).getByRole("button", { name: "Use 1:75 @ A1 (1:75 on this page)" }).click();
  await expect(scale(page)).toHaveText("Scale 1:75");

  await open(page, L17);
  await expect(canvas(page)).toHaveAttribute("data-snap-index", /^\d+/, { timeout: 60_000 });
  await page.getByRole("menubar").getByRole("menuitem", { name: "Document" }).click();
  await page.getByRole("menuitem", { name: "Calibrate…" }).click();
  await dialog(page).getByRole("tab", { name: "By two points" }).click();
  await dialog(page).getByRole("button", { name: "Pick two points" }).click();
  const ends: [number, number][] = [
    [-169.01, 98.57],
    [-97.01, 98.57],
  ];
  for (const [x, y] of ends) {
    const at = await screenOf(page, x, y);
    await page.mouse.move(at.x, at.y);
    await expect(canvas(page)).toHaveAttribute("data-snap", /^(endpoint|intersection) /);
    await page.mouse.click(at.x, at.y);
  }
  const picked = (await dialog(page).getByTestId("calibrate-picked").textContent()) ?? "";
  await dialog(page).getByTestId("calibrate-distance").fill("1905");
  await dialog(page).getByRole("button", { name: "Apply" }).click();
  await expect(scale(page)).toHaveText("Scale 1:75");
  const xs: number[] = [];
  for (const [x, y] of ends) {
    const at = await screenOf(page, x, y);
    await page.mouse.move(at.x, at.y);
    await expect(canvas(page)).toHaveAttribute("data-snap", /.+/).catch(() => undefined);
    xs.push(await readX(page));
  }
  // The pointer on the dimension's second end: the readout in mm and Scale 1:75 in the bar.
  await page.screenshot({ path: path.join(PRIVATE, "traces", "4-3-calibrated.png") });
  process.stdout.write(`${JSON.stringify({ picked, readoutX: xs, difference: xs[1] - xs[0] })}\n`);
  expect(Math.abs(xs[1] - xs[0] - 1905)).toBeLessThanOrEqual(1);
  await context.close();
});
