import { expect, test, type Page } from "@playwright/test";
import { clearLimits, deleteUser, emailLink, makeActiveUser } from "./auth-mail";
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
    await page.goto(link);
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
    await page.goto(link);
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
