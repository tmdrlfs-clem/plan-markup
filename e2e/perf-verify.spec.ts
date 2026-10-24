// Story 4.4, optional local-only check (never in CI: the drawings are private
// and git-ignored). Run: PERF_L17=1 E2E_PROD=1 npx playwright test perf-verify
// (after `npm run build`).
//
// L17 (no printed scale): calibrated by ratio 1:75, verified on its "1905"
// dimension (user space (-169.01, 98.57) to (-97.01, 98.57)): Matches.
// L21: calibrated from its detected "1:75 @ A1", verified on its "1491"
// dimension (text at user (158.93, -92.78); the line ends are found by snapping
// near the text): Matches. Saves fixtures/private/traces/4-4-verify.png.
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
const scale = (page: Page) => page.getByTestId("status-bar").getByTestId("status-scale");
const calibrate = (page: Page) => page.getByRole("dialog", { name: "Calibrate" });
const verify = (page: Page) => page.getByRole("dialog", { name: "Verify calibration" });

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

async function verifyOn(page: Page, ends: [number, number][], known: string) {
  await page.getByRole("menubar").getByRole("menuitem", { name: "Tools" }).click();
  await page.getByRole("menuitem", { name: "Verify calibration…" }).click();
  await verify(page).getByTestId("verify-known").fill(known);
  await verify(page).getByRole("button", { name: "Pick two points" }).click();
  const snaps: string[] = [];
  for (const [x, y] of ends) {
    const at = await screenOf(page, x, y);
    await page.mouse.move(at.x, at.y);
    await expect(canvas(page)).toHaveAttribute("data-snap", /^(endpoint|intersection) /);
    snaps.push((await canvas(page).getAttribute("data-snap")) ?? "");
    await page.mouse.click(at.x, at.y);
  }
  const measured = await verify(page).getByTestId("verify-row-measured").textContent();
  const verdict = await verify(page).getByTestId("verify-verdict").textContent();
  process.stdout.write(`${JSON.stringify({ snaps, measured, verdict })}\n`);
  return verdict ?? "";
}

test("verify L17 at 1:75 and L21 from its detected 1:75 @ A1 on printed dimensions", async ({ browser }) => {
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
  expect(
    await verifyOn(
      page,
      [
        [-169.01, 98.57],
        [-97.01, 98.57],
      ],
      "1905",
    ),
  ).toContain("Matches");
  await verify(page).getByRole("button", { name: "Keep" }).click();

  await open(page, L21);
  await expect(scale(page)).toHaveText("Scales disagree — Verify", { timeout: 30_000 });
  await scale(page).click();
  await calibrate(page).getByRole("button", { name: "Use 1:75 @ A1 (1:75 on this page)" }).click();
  await expect(scale(page)).toHaveText("Scale 1:75");
  // "1491" at 1:75 is 56.4 pt of paper, centred under its text.
  const centre = 158.93 + 17.02 / 2;
  const half = (1491 / 75) * (72 / 25.4) / 2;
  const verdict = await verifyOn(
    page,
    [
      [centre - half, -94.9],
      [centre + half, -94.9],
    ],
    "1491",
  );
  await page.screenshot({ path: path.join(PRIVATE, "traces", "4-4-verify.png") });
  expect(verdict).toContain("Matches");
  await context.close();
});
