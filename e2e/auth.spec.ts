import { expect, test, type Page } from "@playwright/test";
import pg from "pg";
import { rateLimitKeyHash } from "../src/lib/auth/rate-limit-key";
import { DB_URL } from "./global-setup";

// Seed accounts (supabase/seed.sql), all with password123.
const PASSWORD = "password123";
const ACTIVE = "user@plan-markup.test";
const PENDING = "pending@plan-markup.test";
const DEACTIVATED = "deactivated@plan-markup.test";
const AUTH_COOKIE = /^sb-.+-auth-token(\.\d+)?$/;

/** The form-level alert (Next's route announcer is also role="alert"). */
function formAlert(page: Page) {
  return page.getByRole("alert").and(page.locator(":not(#__next-route-announcer__)"));
}

async function signIn(page: Page, email: string, password = PASSWORD) {
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

test("unauthenticated /workspace redirects to sign-in with next", async ({ page }) => {
  await page.goto("/workspace");
  await expect(page).toHaveURL("/sign-in?next=%2Fworkspace");
  await expect(page.getByRole("heading", { name: "Sign in to Plan Markup" })).toBeVisible();
});

test("sign-in succeeds and sets HttpOnly, Secure, SameSite=Lax session cookies", async ({
  page,
  context,
}) => {
  await page.goto("/sign-in");
  await signIn(page, ACTIVE);
  await expect(page).toHaveURL("/workspace");
  await expect(page.getByRole("heading", { name: "Workspace" })).toBeVisible();

  const authCookies = (await context.cookies()).filter((c) => AUTH_COOKIE.test(c.name));
  expect(authCookies.length).toBeGreaterThan(0);
  for (const cookie of authCookies) {
    expect(cookie).toMatchObject({ httpOnly: true, secure: true, sameSite: "Lax", path: "/" });
    // Lifetime capped at 30 days (the library default would be 400 days).
    expect(cookie.expires * 1000 - Date.now()).toBeLessThanOrEqual(2_592_000 * 1000 + 60_000);
  }
});

test("wrong password and unknown email show the same generic message", async ({ page }) => {
  await page.goto("/sign-in");
  await signIn(page, ACTIVE, "wrong-password");
  const alert = formAlert(page);
  await expect(alert).toHaveText("Email or password is incorrect.");
  const wrongPassword = await alert.textContent();
  await expect(page).toHaveURL("/sign-in");

  await signIn(page, "nobody@plan-markup.test", "whatever-password");
  await expect(alert).toHaveText("Email or password is incorrect.");
  expect(await alert.textContent()).toBe(wrongPassword);
  await expect(page).toHaveURL("/sign-in");
});

test("a pending user lands on PendingActivation and cannot reach /workspace", async ({ page }) => {
  await page.goto("/sign-in");
  await signIn(page, PENDING);
  await expect(page).toHaveURL("/pending-activation");
  await expect(
    page.getByRole("heading", { name: "Your account is waiting for approval" }),
  ).toBeVisible();
  await expect(page.getByText(PENDING)).toBeVisible();

  await page.goto("/workspace");
  await expect(page).toHaveURL("/pending-activation");
});

test("a deactivated user lands on PendingActivation", async ({ page }) => {
  await page.goto("/sign-in");
  await signIn(page, DEACTIVATED);
  await expect(page).toHaveURL("/pending-activation");
  await expect(page.getByRole("heading", { name: "Your account is not active" })).toBeVisible();
});

test("a pending user can sign out from PendingActivation", async ({ page, context }) => {
  await page.goto("/sign-in");
  await signIn(page, PENDING);
  await expect(page).toHaveURL("/pending-activation");
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL("/sign-in");
  expect((await context.cookies()).filter((c) => AUTH_COOKIE.test(c.name))).toEqual([]);
});

test("sign out ends the session", async ({ page, context }) => {
  await page.goto("/sign-in");
  await signIn(page, ACTIVE);
  await expect(page).toHaveURL("/workspace");
  const before = (await context.cookies()).filter((c) => AUTH_COOKIE.test(c.name));

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL("/sign-in");

  await page.goto("/workspace");
  await expect(page).toHaveURL("/sign-in?next=%2Fworkspace");
  expect((await context.cookies()).filter((c) => AUTH_COOKIE.test(c.name))).toEqual([]);

  // Replaying the old cookies does not restore the session: it ended server-side.
  await context.addCookies(before);
  await page.goto("/workspace");
  await expect(page).toHaveURL("/sign-in?next=%2Fworkspace");
});

for (const next of ["%2F%2Fevil.com", "https%3A%2F%2Fevil.com", "%2F%5Cevil.com"]) {
  test(`open redirect next=${next} falls back to /workspace`, async ({ page }) => {
    await page.goto(`/sign-in?next=${next}`);
    await signIn(page, ACTIVE);
    await expect(page).toHaveURL("/workspace");
    const url = new URL(page.url());
    expect(url.origin).toBe("http://localhost:3020");
    expect(url.pathname).toBe("/workspace");
  });
}

test("an over-limit email shows the rate-limited message without calling Auth", async ({ page }) => {
  const email = "ratelimit@plan-markup.test";
  const client = new pg.Client({ connectionString: DB_URL });
  await client.connect();
  try {
    await client.query(
      `insert into app.rate_limits (bucket, key_hash, hits, window_started_at, updated_at)
       values ('sign_in_email', $1, 10, now(), now())
       on conflict (bucket, key_hash)
       do update set hits = 10, window_started_at = now(), updated_at = now()`,
      [rateLimitKeyHash("sign_in_email", email)],
    );
  } finally {
    await client.end();
  }

  await page.goto("/sign-in");
  await signIn(page, email, "whatever-password");
  // An Auth call would have produced the generic message instead.
  await expect(formAlert(page)).toHaveText(
    "Too many sign-in attempts. Try again in 15 minutes.",
  );
});
