// Story 7.1: personal tool sets (production build in CI).
// Covers: the empty state (Import… and Create set); creating two sets,
// renaming one, moving it up; instant search; the sets survive a reload in
// their order; deleting asks with the tool count.
import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./helpers";

const panel = (page: Page) => page.getByRole("complementary", { name: "Tool Chest" });
const setNames = (page: Page) => panel(page).getByTestId("tool-set").locator("button[aria-expanded]");

async function createSet(page: Page, name: string) {
  await panel(page).getByRole("button", { name: "Create set" }).click();
  const field = panel(page).getByRole("textbox", { name: "New tool set name" });
  await field.fill(name);
  await field.press("Enter");
}

test("tool sets: create, rename, reorder, search, persist and delete", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto("/sign-in");
  await signIn(page, "admin@plan-markup.test");
  await expect(page).toHaveURL("/workspace");
  if (!(await panel(page).isVisible())) {
    await page.getByRole("radio", { name: "Tool Chest" }).click();
  }
  await expect(panel(page).getByText("No tool sets yet")).toBeVisible();
  await expect(panel(page).getByRole("button", { name: "Import…" })).toBeEnabled();

  await createSet(page, "Sprinkler");
  await expect(setNames(page)).toHaveText(["Sprinkler (0)"]);
  await createSet(page, "Alarm");
  await expect(setNames(page)).toHaveText(["Sprinkler (0)", "Alarm (0)"]);

  // Rename and move up.
  await panel(page).getByRole("button", { name: "Rename Alarm" }).click();
  const field = panel(page).getByRole("textbox", { name: "Tool set name" });
  await field.fill("Fire alarm");
  await field.press("Enter");
  await expect(setNames(page)).toHaveText(["Sprinkler (0)", "Fire alarm (0)"]);
  await panel(page).getByRole("button", { name: "Move Fire alarm up" }).click();
  await expect(setNames(page)).toHaveText(["Fire alarm (0)", "Sprinkler (0)"]);

  // Instant search.
  const search = panel(page).getByRole("searchbox", { name: "Search tools" });
  await search.fill("spr");
  await expect(setNames(page)).toHaveText(["Sprinkler (0)"]);
  await search.fill("");

  // The sets are saved, in their order.
  await page.reload();
  await expect(setNames(page)).toHaveText(["Fire alarm (0)", "Sprinkler (0)"], { timeout: 15_000 });

  // Delete asks first.
  await panel(page).getByRole("button", { name: "Delete Sprinkler" }).click();
  const dialog = page.getByRole("alertdialog", { name: "Delete tool set?" });
  await expect(dialog).toContainText("“Sprinkler” has no tools.");
  await dialog.getByRole("button", { name: "Delete set" }).click();
  await expect(setNames(page)).toHaveText(["Fire alarm (0)"]);
  await page.reload();
  await expect(setNames(page)).toHaveText(["Fire alarm (0)"], { timeout: 15_000 });
});
