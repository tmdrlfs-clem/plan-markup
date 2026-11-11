import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { clearLimits, deleteUser, emailLink, makeActiveUser, openEmailLink, sql } from "./auth-mail";
import { formAlert, signIn } from "./helpers";

// Story 10.2: reset a forgotten password by email.

const OLD = "old password for reset e2e";
const resetLink = (email: string) => emailLink(email, "Reset your Plan Markup password");
const clearResetLimits = () => clearLimits("reset_ip", "reset_email");

async function requestLink(page: Page, email: string) {
  await page.goto("/sign-in");
  await page.getByRole("link", { name: "Forgot password?" }).click();
  await expect(page).toHaveURL("/forgot-password");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
}

test("reset by email: single-use link, new password, other sessions signed out", async ({ browser }) => {
  const email = `reset-${Date.now()}-${test.info().retry}@plan-markup.test`;
  const fresh = `new password ${crypto.randomUUID()}`;
  await clearResetLimits();
  await makeActiveUser(email, OLD);
  const other = await browser.newContext();
  const ctx = await browser.newContext();
  try {
    // Another device, signed in with the old password.
    const otherPage = await other.newPage();
    await otherPage.goto("/sign-in");
    await signIn(otherPage, email, OLD);
    await expect(otherPage).toHaveURL("/workspace");

    // An unknown email gets the same answer.
    const page = await ctx.newPage();
    await requestLink(page, `nobody-${Date.now()}@plan-markup.test`);
    await requestLink(page, email);

    // /reset-password without the link is refused.
    await page.goto("/sign-in");
    await signIn(page, email, OLD);
    await expect(page).toHaveURL("/workspace");
    await page.goto("/reset-password");
    await expect(page.getByRole("heading", { name: "Open the link from your email" })).toBeVisible();
    await ctx.clearCookies();

    // The link signs in and asks for a new password.
    const link = await resetLink(email);
    expect(link).toMatch(/^\/auth\/confirm\?token_hash=[\w-]+&type=recovery$/);
    await openEmailLink(page, link);
    await expect(page).toHaveURL("/reset-password");
    await expect(page.getByText(email)).toBeVisible();
    await page.getByLabel("New password").fill("too-short");
    await page.getByRole("button", { name: "Set new password" }).click();
    await expect(page.getByText("Use at least 12 characters.")).toBeVisible();
    await page.getByLabel("New password").fill(fresh);
    await page.getByRole("button", { name: "Set new password" }).click();
    await expect(page).toHaveURL("/workspace");

    // The link works once.
    await ctx.clearCookies();
    await openEmailLink(page, link);
    await expect(page).toHaveURL("/sign-in?link=invalid");

    // The other device is signed out; the old password no longer works, the new one does.
    await otherPage.goto("/workspace");
    await expect(otherPage).toHaveURL(/\/sign-in/);
    await page.goto("/sign-in");
    await signIn(page, email, OLD);
    await expect(formAlert(page)).toContainText("Email or password is incorrect.");
    await signIn(page, email, fresh);
    await expect(page).toHaveURL("/workspace");
  } finally {
    await other.close();
    await ctx.close();
    await deleteUser(email);
    await clearResetLimits();
  }
});

// Security review 2026-11-12: Auth itself (not only our pages) refuses a password
// change from a session that is not recent, so a session left open for days
// cannot take the account over by calling the Auth API directly.
test("Auth refuses a password change from a session older than a day", async () => {
  // CI exports the local keys as environment variables; a local run has them in .env.local.
  const fromFile = (): Record<string, string> => {
    try {
      return Object.fromEntries(
        readFileSync(path.join(__dirname, "..", ".env.local"), "utf8")
          .split(/?
/)
          .filter((l) => l.includes("=") && !l.startsWith("#"))
          .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
      );
    } catch {
      return {};
    }
  };
  const env = { ...fromFile(), ...process.env };
  expect(env.NEXT_PUBLIC_SUPABASE_URL && env.NEXT_PUBLIC_SUPABASE_ANON_KEY).toBeTruthy();
  const auth = `${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1`;
  const headers = { apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "", "Content-Type": "application/json" };
  const email = `stale-${Date.now()}-${test.info().retry}@plan-markup.test`;
  await makeActiveUser(email, OLD);
  try {
    const signIn = (password: string) =>
      fetch(`${auth}/token?grant_type=password`, { method: "POST", headers, body: JSON.stringify({ email, password }) });
    const session = (await (await signIn(OLD)).json()) as { access_token: string };
    expect(session.access_token).toBeTruthy();
    // The session and sign-in are now two days old.
    await sql(
      `update auth.users set last_sign_in_at = now() - interval '2 days' where email = $1`,
      [email],
    );
    await sql(
      `update auth.sessions set created_at = now() - interval '2 days'
        where user_id = (select id from auth.users where email = $1)`,
      [email],
    );
    const res = await fetch(`${auth}/user`, {
      method: "PUT",
      headers: { ...headers, Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ password: "someone else chose this one" }),
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect((await signIn("someone else chose this one")).status).toBe(400);
    expect((await signIn(OLD)).status).toBe(200);
  } finally {
    await deleteUser(email);
  }
});
