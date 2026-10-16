import { expect, test } from "@playwright/test";

test("home page responds 200 with the app title", async ({ page }) => {
  const response = await page.goto("/");
  expect(response?.status()).toBe(200);
  await expect(page).toHaveTitle("Plan Markup");
});
