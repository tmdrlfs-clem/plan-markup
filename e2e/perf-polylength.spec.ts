// Story 4.6, optional local-only check (never in CI: the drawings are private
// and git-ignored). Run: PERF_L17=1 E2E_PROD=1 npx playwright test perf-polylength
// (after `npm run build`).
//
// A Polylength along each 4.5 dimension through its midpoint (three vertices,
// the middle one placed with Alt: not snapped) reads the printed value: L17 at
// 1:75 "1905", L21 from its detected "1:75 @ A1" "1491". Enter finishes each;
// the Enter is timed from its key event to layer 2's paint (NFR3: 50 ms).
// Saves fixtures/private/traces/4-6-polylength.png.
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./helpers";

const PRIVATE = path.join(__dirname, "..", "fixtures", "private");
const L17 = path.join(PRIVATE, "pdf", "A1721-LEVEL-17-REFLECTED-CEILING-PLAN-Rev.2.pdf");
const L21 = path.join(PRIVATE, "pdf", "A2121-LEVEL-21-REFLECTED-CEILING-PLAN-Rev.2.pdf");
/** The page box of both drawings (user space, centred on 0, 0). */
const VIEW = [-1191.97, -841.89, 1191.97, 841.89] as const;

test.skip(process.env.PERF_L17 !== "1" || !existsSync(L17) || !existsSync(L21), "local check: set PERF_L17=1 (needs the private drawings)");

const canvas = (page: Page) => page.getByTestId("drawing-canvas");
const markups = (page: Page) => page.getByTestId("markups-canvas");
const scale = (page: Page) => page.getByTestId("status-bar").getByTestId("status-scale");
const calibrate = (page: Page) => page.getByRole("dialog", { name: "Calibrate" });

async function open(page: Page, file: string) {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("toolbar", { name: "Document" }).getByRole("button", { name: "Open…" }).click();
  await (await chooser).setFiles(file);
  await expect(canvas(page)).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
  await expect(canvas(page)).toHaveAttribute("data-snap-index", /^\d+/, { timeout: 60_000 });
}

/** Screen position of user space point (x, y) (no /Rotate, view rotation 0). */
async function screenOf(page: Page, x: number, y: number) {
  const box = (await canvas(page).boundingBox())!;
  const [zoom, cx, cy] = ((await canvas(page).getAttribute("data-view")) ?? "").split(" ").map(Number);
  return { x: box.x + box.width / 2 + (x - VIEW[0] - cx) * zoom, y: box.y + box.height / 2 + (VIEW[3] - y - cy) * zoom };
}

/** A polylength from `a` through the midpoint (Alt: raw) to `b` (both snapped); returns its caption and Enter's paint time. */
async function measure(page: Page, a: [number, number], b: [number, number]) {
  await canvas(page).focus();
  await page.keyboard.press("Shift+Alt+Q");
  const snaps: string[] = [];
  const mid: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  for (const [x, y] of [a, mid, b]) {
    const at = await screenOf(page, x, y);
    const raw = x === mid[0] && y === mid[1];
    if (raw) await page.keyboard.down("Alt");
    await page.mouse.move(at.x, at.y);
    if (raw) {
      await expect(canvas(page)).not.toHaveAttribute("data-snap", /.+/);
    } else {
      await expect(canvas(page)).toHaveAttribute("data-snap", /^(endpoint|intersection) /);
      snaps.push((await canvas(page).getAttribute("data-snap")) ?? "");
    }
    await page.mouse.click(at.x, at.y);
    if (raw) await page.keyboard.up("Alt");
  }
  await expect(canvas(page)).toHaveAttribute("data-measure", /mm$/);
  const live = (await canvas(page).getAttribute("data-measure")) ?? "";
  await page.evaluate(() => {
    window.addEventListener("keydown", (e) => document.body.setAttribute("data-e2e-down", String(e.timeStamp)), { capture: true, once: true });
  });
  await page.keyboard.press("Enter");
  await expect(markups(page)).toHaveAttribute("data-markup-count", "1");
  const caption = (await markups(page).getAttribute("data-captions")) ?? "";
  const paintMs = Number(await markups(page).getAttribute("data-painted-at")) - Number(await page.locator("body").getAttribute("data-e2e-down"));
  process.stdout.write(`${JSON.stringify({ snaps, live, caption, paintMs })}\n`);
  return { caption, paintMs };
}

test("Polylength on L17 at 1:75 and L21 from its detected 1:75 @ A1 reads the printed dimensions", async ({ browser }) => {
  test.setTimeout(240_000);
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();
  await page.goto("/sign-in");
  await signIn(page, "admin@plan-markup.test");
  await expect(page).toHaveURL("/workspace");
  mkdirSync(path.join(PRIVATE, "traces"), { recursive: true });

  await open(page, L17);
  await scale(page).click();
  await calibrate(page).getByTestId("calibrate-ratio").fill("1:75");
  await calibrate(page).getByRole("button", { name: "Apply" }).click();
  await expect(scale(page)).toHaveText("Scale 1:75");
  const l17 = await measure(page, [-169.01, 98.57], [-97.01, 98.57]);
  expect(l17.caption).toBe("1905 mm");
  expect(l17.paintMs).toBeLessThan(50);

  await open(page, L21);
  await expect(scale(page)).toHaveText("Scales disagree — Verify", { timeout: 30_000 });
  await scale(page).click();
  await calibrate(page).getByRole("button", { name: "Use 1:75 @ A1 (1:75 on this page)" }).click();
  await expect(scale(page)).toHaveText("Scale 1:75");
  // "1491" at 1:75 is 56.4 pt of paper, centred under its text.
  const centre = 158.93 + 17.02 / 2;
  const half = (1491 / 75) * (72 / 25.4) / 2;
  const l21 = await measure(page, [centre - half, -94.9], [centre + half, -94.9]);
  // Zoomed in on the measurement for the screenshot.
  const at = await screenOf(page, centre, -94.9);
  await page.mouse.move(at.x, at.y);
  await page.keyboard.down("Control");
  for (let i = 0; i < 3; i++) await page.mouse.wheel(0, -240);
  await page.keyboard.up("Control");
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(PRIVATE, "traces", "4-6-polylength.png") });
  expect(l21.caption).toBe("1491 mm");
  expect(l21.paintMs).toBeLessThan(50);
  await context.close();
});
