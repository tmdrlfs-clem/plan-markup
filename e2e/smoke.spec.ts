import { expect, test } from "@playwright/test";

test("home page responds 200 with the app title", async ({ page }) => {
  const response = await page.goto("/");
  expect(response?.status()).toBe(200);
  await expect(page).toHaveTitle("Plan Markup");
});

test("Story 8.5: /api/health answers without a session, never cached", async ({ request }) => {
  const res = await request.get("/api/health", { maxRedirects: 0 });
  expect(res.status()).toBe(200);
  expect(res.headers()["cache-control"]).toBe("no-store");
  expect(await res.json()).toEqual({ status: "ok", checks: { app: "ok", supabase: "ok" } });
});
