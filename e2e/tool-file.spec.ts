// Story 7.6: export a tool set to our own file and import it back (production build in CI).
//   fixtures/btx/synthetic.btx (Story 2.1): "Synthetic Tools", five items (one
//   image stamp, four converted markups, Story 7.5).
// Covers: Export saves "Synthetic Tools.tools.json" (versioned, the stamp's
// image embedded); after the set is deleted, Import… takes the file back as a
// new set with the same five tools, all drawn; a file that is not ours is
// refused with "Not a Plan Markup tool set file" and nothing changes.
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./helpers";

const SYNTHETIC = path.join(__dirname, "..", "fixtures", "btx", "synthetic.btx");

const chest = (page: Page) => page.getByRole("complementary", { name: "Tool Chest" });
const setNames = (page: Page) => chest(page).getByTestId("tool-set").locator("button[aria-expanded]");

async function showChest(page: Page) {
  await expect(async () => {
    const radio = page.getByRole("radio", { name: "Tool Chest" });
    if ((await radio.getAttribute("aria-checked")) !== "true") await radio.click();
    await expect(chest(page)).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 15_000 });
}

async function importFile(page: Page, name: string, buffer: Buffer) {
  await chest(page).getByTestId("import-btx-input").setInputFiles({ name, mimeType: "application/octet-stream", buffer });
}

test("tool set files: export, delete, import back; a file that is not ours changes nothing", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto("/sign-in");
  await signIn(page, "admin@plan-markup.test");
  await expect(page).toHaveURL("/workspace");
  await showChest(page);
  await expect(chest(page).getByText("No tool sets yet")).toBeVisible();

  await importFile(page, "synthetic.btx", readFileSync(SYNTHETIC));
  await expect(page.getByText("Synthetic Tools — 5 tools", { exact: true })).toBeVisible({ timeout: 30_000 });

  // Export: the file is ours, versioned, with the stamp's image inside.
  const download = page.waitForEvent("download");
  await chest(page).getByRole("button", { name: "Export Synthetic Tools" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("Synthetic Tools.tools.json");
  const saved = readFileSync((await file.path())!);
  const json = JSON.parse(saved.toString("utf8"));
  expect(json).toMatchObject({ format: "plan-markup.tool-set", version: 1, set: { name: "Synthetic Tools" } });
  expect(json.set.tools).toHaveLength(5);
  expect(json.set.tools.filter((t: { image: unknown }) => t.image !== null)).toHaveLength(1);
  await expect(page.getByText("Exported “Synthetic Tools” — 5 tools", { exact: true })).toBeVisible();

  // Delete the set, then take the file back.
  await chest(page).getByRole("button", { name: "Delete Synthetic Tools" }).click();
  await page.getByRole("alertdialog", { name: "Delete tool set?" }).getByRole("button", { name: "Delete set" }).click();
  await expect(chest(page).getByText("No tool sets yet")).toBeVisible();

  // Not ours: refused, nothing added.
  await importFile(page, "other.json", Buffer.from(JSON.stringify({ hello: "world" })));
  await expect(page.getByText("Not a Plan Markup tool set file", { exact: true })).toBeVisible();
  await expect(chest(page).getByText("No tool sets yet")).toBeVisible();

  await importFile(page, "Synthetic Tools.tools.json", saved);
  await expect(page.getByText("Synthetic Tools — 5 tools", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(setNames(page)).toHaveText(["Synthetic Tools (5)"]);
  await expect(chest(page).getByTestId("tool")).toHaveCount(5);
  // Every tile draws, the image one too (stored again in this account's bucket).
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
});
