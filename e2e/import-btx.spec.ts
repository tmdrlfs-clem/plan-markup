// Story 7.4: Import .btx (production build in CI).
//   fixtures/btx/synthetic.btx (Story 2.1): "Synthetic Tools", five items (a
//   stamp with a form, font and image; a circle; a group of two circles; a
//   polyline; a line).
// Covers: all five import as tiles of a new set "Synthetic Tools" with the
// toast "Synthetic Tools — 5 tools"; every tile draws; the set survives a
// reload. Story 7.5: the four drawn-by-Revu items convert to our markups, so
// the arrow placed on a drawing is an editable Arrow. A file that is not a tool set: "Not a Revu tool set file" and
// nothing changes; a file with XML entities is refused. Locally (never in CI), the founder's private sets import
// with a report of the items that cannot be drawn.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./helpers";

const SYNTHETIC = path.join(__dirname, "..", "fixtures", "btx", "synthetic.btx");
const PRIVATE = path.join(__dirname, "..", "fixtures", "private", "btx", "sprinkler-tools.btx");
const PDF = path.join(__dirname, "..", "fixtures", "pdf", "snap.pdf");
const OUT = path.join(__dirname, "..", "fixtures", "private", "btx", "out");

const chest = (page: Page) => page.getByRole("complementary", { name: "Tool Chest" });
const setNames = (page: Page) => chest(page).getByTestId("tool-set").locator("button[aria-expanded]");

async function showChest(page: Page) {
  await expect(async () => {
    const radio = page.getByRole("radio", { name: "Tool Chest" });
    if ((await radio.getAttribute("aria-checked")) !== "true") await radio.click();
    await expect(chest(page)).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 15_000 });
}

async function start(page: Page) {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto("/sign-in");
  await signIn(page, "admin@plan-markup.test");
  await expect(page).toHaveURL("/workspace");
  await showChest(page);
  await expect(chest(page).getByText("No tool sets yet")).toBeVisible();
}

async function importFile(page: Page, name: string, buffer: Buffer) {
  await chest(page).getByTestId("import-btx-input").setInputFiles({ name, mimeType: "application/octet-stream", buffer });
}

test("Import .btx: every item of the synthetic set becomes a tool; a file that is not a set changes nothing", async ({ page }) => {
  await start(page);

  // Not a tool set: refused, nothing added.
  await importFile(page, "notes.btx", Buffer.from("<?xml version=\"1.0\"?><Notes/>"));
  await expect(page.getByText("Not a Revu tool set file", { exact: true })).toBeVisible();
  await expect(chest(page).getByText("No tool sets yet")).toBeVisible();
  // Entities (billion laughs / external entities) are refused, never expanded (NFR31).
  const laughs = `<?xml version="1.0"?><!DOCTYPE t [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;"><!ENTITY x SYSTEM "file:///etc/passwd">]><BluebeamRevuToolSet><Title>&b;&x;</Title></BluebeamRevuToolSet>`;
  await importFile(page, "laughs.btx", Buffer.from(laughs));
  await expect(page.getByText("The file contains content that is not allowed in a tool set.", { exact: true })).toBeVisible();
  await expect(chest(page).getByText("No tool sets yet")).toBeVisible();

  await importFile(page, "synthetic.btx", readFileSync(SYNTHETIC));
  await expect(page.getByText("Synthetic Tools — 5 tools", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(setNames(page)).toHaveText(["Synthetic Tools (5)"]);
  const tiles = chest(page).getByTestId("tool");
  await expect(tiles).toHaveCount(5);

  // Every tile draws (its image comes back by signed URL).
  await expect
    .poll(async () =>
      chest(page)
        .getByTestId("tool-preview")
        .evaluateAll((els) =>
          els.map((el) => {
            const c = el as HTMLCanvasElement;
            const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
            let ink = 0;
            for (let i = 0; i < d.length; i += 4) if (d[i] < 200 || d[i + 1] < 200 || d[i + 2] < 200) ink++;
            return ink > 0;
          }),
        ),
    )
    .toEqual([true, true, true, true, true]);

  await page.reload();
  await expect(setNames(page)).toHaveText(["Synthetic Tools (5)"], { timeout: 15_000 });

  // Story 7.5: the arrow item is our own Arrow once placed (editable, not an image).
  await showChest(page);
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("toolbar", { name: "Document" }).getByRole("button", { name: "Open…" }).click();
  await (await chooser).setFiles({ name: "snap.pdf", mimeType: "application/pdf", buffer: readFileSync(PDF) });
  const canvas = page.getByTestId("drawing-canvas");
  await expect(canvas).toHaveAttribute("data-state", "ready");
  const arrow = chest(page).getByRole("button", { name: "Synthetic arrow" });
  await arrow.click();
  await expect(arrow).toHaveAttribute("aria-pressed", "true");
  const box = (await canvas.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.getByTestId("markups-canvas")).toHaveAttribute("data-captions", "Arrow");
});

test("Import .btx: a real Revu set imports with a report of the items that cannot be drawn (local only)", async ({ page }) => {
  test.skip(!existsSync(PRIVATE) || !!process.env.CI, "the founder's private files are not in the repository");
  test.setTimeout(240_000);
  await start(page);
  await importFile(page, "sprinkler-tools.btx", readFileSync(PRIVATE));
  // 66 items, 1 without an appearance in the file (Story 2.1 report): a partial import.
  const report = page.getByRole("dialog", { name: /imported$/ });
  await expect(report).toBeVisible({ timeout: 180_000 });
  await expect(report.getByTestId("import-report").getByRole("listitem")).toHaveCount(1);
  await expect(report).toContainText("draws nothing");
  await report.getByRole("button", { name: "Done" }).click();
  await expect(chest(page).getByTestId("tool")).toHaveCount(65);
  // The founder's review sheet (gitignored with the private files).
  await chest(page).screenshot({ path: path.join(OUT, "import-sprinkler-tools.png") });
});
