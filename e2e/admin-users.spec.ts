import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { deleteUser, emailMessage, makeActiveUser, sql } from "./auth-mail";
import { signIn } from "./helpers";

// Story 10.4: the platform admin lists accounts, activates and deactivates them.

const PASSWORD = "admin users e2e password";

async function makeAccounts(tag: string) {
  const admin = `adm-${tag}@plan-markup.test`;
  const pending = `wait-${tag}@plan-markup.test`;
  const member = `member-${tag}@plan-markup.test`;
  await deleteUser(admin, pending, member);
  await makeActiveUser(admin, PASSWORD);
  await makeActiveUser(pending, PASSWORD);
  await makeActiveUser(member, PASSWORD);
  await sql("update public.profiles set is_platform_admin = true, name = 'Ada Admin' where email = $1", [admin]);
  await sql("update public.profiles set status = 'pending', name = 'Wim Waiting' where email = $1", [pending]);
  await sql("update public.profiles set name = 'Mel Member' where email = $1", [member]);
  return { admin, pending, member };
}

async function signInTo(page: Page, email: string, path = "/sign-in") {
  await page.goto(path);
  await signIn(page, email, PASSWORD);
}

const auditRows = (email: string) =>
  sql<{ action: string; actor: string; detail: { from: string; to: string } }>(
    `select a.action, p.email as actor, a.detail from public.audit_log a join public.profiles p on p.id = a.actor_id
     where a.target_id = (select id from public.profiles where email = $1) order by a.occurred_at`,
    [email],
  );

test("the admin activates a waiting account: it gets in, the email goes out, the change is recorded", async ({ browser }) => {
  const tag = crypto.randomUUID().slice(0, 12);
  const { admin, pending, member } = await makeAccounts(tag);
  const adminCtx = await browser.newContext();
  const userCtx = await browser.newContext();
  try {
    // The waiting user is signed in and sees PendingActivation.
    const userPage = await userCtx.newPage();
    await signInTo(userPage, pending);
    await expect(userPage).toHaveURL("/pending-activation");

    // The admin opens /admin/users after signing in (the next path survives sign-in).
    const page = await adminCtx.newPage();
    await page.goto("/admin/users");
    await expect(page).toHaveURL(/\/sign-in\?next=%2Fadmin%2Fusers$/);
    await signIn(page, admin, PASSWORD);
    await expect(page).toHaveURL("/admin/users");
    await expect(page.getByRole("heading", { name: "Accounts" })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "daylight");

    // Waiting accounts come first; find ours by search.
    await page.getByLabel("Search name or email").fill(pending);
    await page.getByRole("button", { name: "Search" }).click();
    const row = page.getByRole("row", { name: /Wim Waiting/ });
    await expect(row).toContainText("Waiting");
    await row.getByRole("button", { name: "Activate Wim Waiting" }).click();
    await expect(page.getByText(`Wim Waiting is active. The "You're in" email is on its way.`, { exact: true })).toBeVisible();
    // It left the waiting list and is under Active.
    await expect(page.getByText(`No accounts here match "${pending}".`)).toBeVisible();
    await page.getByRole("navigation", { name: "Filter by status" }).getByRole("link", { name: /^Active/ }).click();
    await expect(page.getByRole("row", { name: /Wim Waiting/ })).toContainText("Active");

    // The email, with a link to sign-in.
    const mail = await emailMessage(pending, "You're in: your Plan Markup account is active");
    expect(mail.Text).toContain("Hello Wim Waiting,");
    expect(mail.HTML).toContain(`href="http://localhost:3020/sign-in"`);

    // The user's next request opens the workspace.
    await userPage.goto("/workspace");
    await expect(userPage).toHaveURL("/workspace");

    expect(await auditRows(pending)).toEqual([{ action: "user.activated", actor: admin, detail: { from: "pending", to: "active" } }]);
  } finally {
    await adminCtx.close();
    await userCtx.close();
    await deleteUser(admin, pending, member);
  }
});

test("the admin deactivates an account: it is signed out at once and blocked until activated again", async ({ browser }) => {
  const tag = crypto.randomUUID().slice(0, 12);
  const { admin, pending, member } = await makeAccounts(tag);
  const adminCtx = await browser.newContext();
  const userCtx = await browser.newContext();
  try {
    const userPage = await userCtx.newPage();
    await signInTo(userPage, member);
    await expect(userPage).toHaveURL("/workspace");

    const page = await adminCtx.newPage();
    await signInTo(page, admin);
    await expect(page).toHaveURL("/workspace");
    // The workspace's account menu leads to the admin area.
    await page.getByRole("button", { name: "Account: Ada Admin" }).click();
    await page.getByRole("menuitem", { name: "Admin: accounts" }).click();
    await expect(page).toHaveURL("/admin/users");

    await page.goto(`/admin/users?status=active&q=${encodeURIComponent(tag)}`);
    // The admin's own row has no action.
    await expect(page.getByRole("row", { name: /Ada Admin/ }).getByRole("button")).toHaveCount(0);
    await page.getByRole("button", { name: "Deactivate Mel Member" }).click();
    const dialog = page.getByRole("alertdialog", { name: "Deactivate this account?" });
    await expect(dialog).toContainText("Mel Member is signed out at once");
    await dialog.getByRole("button", { name: "Deactivate account" }).click();
    await expect(page.getByText("Mel Member is deactivated and signed out.", { exact: true })).toBeVisible();
    await expect(page.getByRole("row", { name: /Mel Member/ })).toHaveCount(0);

    // The user's session is gone: the next request goes to sign-in, and signing in again is refused entry.
    await userPage.goto("/workspace");
    await expect(userPage).toHaveURL(/\/sign-in/);
    await signIn(userPage, member, PASSWORD);
    await expect(userPage).toHaveURL("/pending-activation");
    await expect(userPage.getByRole("heading", { name: "Your account is not active" })).toBeVisible();

    // Activating again lets them back in.
    await page.goto(`/admin/users?status=deactivated&q=${encodeURIComponent(tag)}`);
    await page.getByRole("button", { name: "Activate Mel Member" }).click();
    await expect(page.getByText(/^Mel Member is active/).first()).toBeVisible();
    await userPage.goto("/workspace");
    await expect(userPage).toHaveURL("/workspace");

    expect((await auditRows(member)).map((r) => [r.action, r.actor])).toEqual([
      ["user.deactivated", admin],
      ["user.activated", admin],
    ]);
  } finally {
    await adminCtx.close();
    await userCtx.close();
    await deleteUser(admin, pending, member);
  }
});

test("the admin area is a 404 for other users", async ({ page }) => {
  const tag = crypto.randomUUID().slice(0, 12);
  const { admin, pending, member } = await makeAccounts(tag);
  try {
    await signInTo(page, member);
    await expect(page).toHaveURL("/workspace");
    await page.getByRole("button", { name: "Account: Mel Member" }).click();
    await expect(page.getByRole("menuitem", { name: "Sign out" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Admin: accounts" })).toHaveCount(0);
    await page.keyboard.press("Escape");

    for (const path of ["/admin", "/admin/users"]) {
      const response = await page.goto(path);
      expect(response?.status()).toBe(404);
      await expect(page.getByRole("heading", { name: "Accounts" })).toHaveCount(0);
    }
    expect(await sql("select status from public.profiles where email = $1", [pending])).toEqual([{ status: "pending" }]);
  } finally {
    await deleteUser(admin, pending, member);
  }
});

test("the account list passes axe and fits a 768 px window", async ({ page }) => {
  const tag = crypto.randomUUID().slice(0, 12);
  const { admin, pending, member } = await makeAccounts(tag);
  try {
    await page.setViewportSize({ width: 768, height: 900 });
    await signInTo(page, admin, "/sign-in?next=%2Fadmin%2Fusers%3Fstatus%3Dall");
    await expect(page).toHaveURL("/admin/users?status=all");
    await expect(page.getByRole("heading", { name: "Accounts" })).toBeVisible();

    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.html).join(" | ")}`)).toEqual([]);

    // No sideways scrolling of the page, and the row actions are inside the window.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    const box = await page.getByRole("button", { name: /^(Activate|Deactivate) / }).first().boundingBox();
    expect(box && box.x + box.width).toBeLessThanOrEqual(768);

    // The confirmation dialog is Daylight too (it renders outside the admin wrapper).
    await page.goto(`/admin/users?status=active&q=${encodeURIComponent(tag)}`);
    await page.getByRole("button", { name: "Deactivate Mel Member" }).click();
    await expect(page.getByRole("alertdialog")).toBeVisible();
    const dialogResults = await new AxeBuilder({ page }).include("[role='alertdialog']").withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(dialogResults.violations.map((v) => v.id)).toEqual([]);
  } finally {
    await deleteUser(admin, pending, member);
  }
});
