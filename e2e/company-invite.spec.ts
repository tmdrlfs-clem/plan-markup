import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { clearLimits, deleteUser, emailMessage, makeActiveUser, sql } from "./auth-mail";
import { signIn } from "./helpers";

// Story 10.6: a company admin invites people by email; the link joins them.

const PASSWORD = "company invite e2e password";

async function makeCompany(tag: string) {
  const platform = `ivp-${tag}@plan-markup.test`;
  const boss = `ivboss-${tag}@plan-markup.test`;
  const company = `Invite Co ${tag}`;
  await makeActiveUser(platform, PASSWORD);
  await makeActiveUser(boss, PASSWORD);
  await sql("update public.profiles set is_platform_admin = true where email = $1", [platform]);
  await sql("update public.profiles set name = 'Bo Boss' where email = $1", [boss]);
  await sql("select * from public.admin_create_company((select id from public.profiles where email = $1), $2, $3)", [platform, company, boss]);
  return { platform, boss, company };
}

async function cleanUp(tag: string, ...emails: string[]) {
  await sql("delete from public.companies where name like $1", [`%${tag}%`]);
  await deleteUser(...emails);
}

async function openMembers(page: Page, boss: string) {
  await page.goto("/sign-in?next=%2Fcompany%2Fmembers");
  await signIn(page, boss, PASSWORD);
  await expect(page).toHaveURL("/company/members");
  await expect(page.getByRole("heading", { name: "Members", level: 1 })).toBeVisible();
}

async function invite(page: Page, email: string, role: "admin" | "member" | "viewer" = "member") {
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Role", { exact: true }).selectOption(role);
  await page.getByRole("button", { name: "Send invitation" }).click();
}

/** The /invite link (path and query) in the newest invitation email to `to`. */
async function inviteLink(to: string, company: string): Promise<string> {
  const mail = await emailMessage(to, `Join ${company} on Plan Markup`);
  const href = /href="([^"]*\/invite\?token=[A-Za-z0-9_-]{43})"/.exec(mail.HTML)?.[1];
  if (!href) throw new Error("no /invite link in the email");
  expect(mail.Text).toContain(href);
  const url = new URL(href);
  return url.pathname + url.search;
}

const memberRows = (company: string) =>
  sql<{ email: string; role: string; status: string }>(
    `select p.email, m.role, p.status from public.company_members m
       join public.profiles p on p.id = m.user_id join public.companies c on c.id = m.company_id
      where c.name = $1 order by m.created_at`,
    [company],
  );

test("invite someone new: they set a password from the link, are a member at once, and the link works only once", async ({ browser }) => {
  const tag = crypto.randomUUID().slice(0, 12);
  const { platform, boss, company } = await makeCompany(tag);
  const fresh = `ivnew-${tag}@plan-markup.test`;
  const bossCtx = await browser.newContext();
  const guestCtx = await browser.newContext();
  try {
    await clearLimits("invite_user", "sign_up_ip", "sign_up_email");
    const page = await bossCtx.newPage();
    await openMembers(page, boss);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "daylight");

    await invite(page, fresh.toUpperCase(), "viewer");
    await expect(page.getByText(`Invitation sent to ${fresh}.`, { exact: true })).toBeVisible();
    const invitations = page.getByRole("table", { name: /Invitations of/ });
    await expect(invitations.getByRole("row", { name: new RegExp(fresh) })).toContainText("Viewer");

    // Only the token's hash is stored.
    const link = await inviteLink(fresh, company);
    const token = new URLSearchParams(link.split("?")[1]).get("token") as string;
    expect(await sql("select count(*)::int as n from public.company_invitations where token_hash = $1", [token])).toEqual([{ n: 0 }]);

    // Opening the link uses nothing; it shows the company, the role and the address.
    const guest = await guestCtx.newPage();
    await guest.goto(link);
    await guest.reload();
    await expect(guest.getByRole("heading", { name: `Join ${company}` })).toBeVisible();
    await expect(guest.getByText(fresh)).toBeVisible();
    await expect(guest.getByLabel("Email")).toHaveValue(fresh);
    await expect(guest.getByLabel("Email")).not.toBeEditable();

    await guest.getByLabel("Choose a password").fill("too-short");
    await guest.getByRole("button", { name: /^Create account and join/ }).click();
    await expect(guest.getByText("Use at least 12 characters.")).toBeVisible();
    await guest.getByLabel("Choose a password").fill(PASSWORD);
    await guest.getByRole("button", { name: /^Create account and join/ }).click();
    await expect(guest).toHaveURL("/workspace");

    expect(await memberRows(company)).toEqual([
      { email: boss, role: "admin", status: "active" },
      { email: fresh, role: "viewer", status: "active" },
    ]);
    expect(
      await sql(
        `select a.action, pa.email as actor from public.audit_log a join public.profiles pa on pa.id = a.actor_id
          where a.target_id = (select id from public.companies where name = $1) and a.action like 'company.member%' order by a.occurred_at`,
        [company],
      ),
    ).toEqual([
      { action: "company.member_invited", actor: boss },
      { action: "company.member_joined", actor: fresh },
    ]);

    // The link is used up.
    const again = await browser.newContext();
    try {
      const other = await again.newPage();
      await other.goto(link);
      await expect(other.getByRole("heading", { name: "This invitation was already used" })).toBeVisible();
    } finally {
      await again.close();
    }

    // The admin sees the new member, and no waiting invitation.
    await page.reload();
    await expect(page.getByRole("combobox", { name: `Role of ${fresh}` })).toHaveValue("viewer");
    await expect(page.getByText("No invitations are waiting.")).toBeVisible();
    // A viewer has no Company area.
    const response = await guest.goto("/company/members");
    expect(response?.status()).toBe(404);
  } finally {
    await bossCtx.close();
    await guestCtx.close();
    await cleanUp(tag, platform, boss, fresh);
  }
});

test("invite an existing, still pending account: signing in from the link joins and activates it; the link is bound to its email", async ({ browser }) => {
  const tag = crypto.randomUUID().slice(0, 12);
  const { platform, boss, company } = await makeCompany(tag);
  const waiting = `ivwait-${tag}@plan-markup.test`;
  const stranger = `ivstranger-${tag}@plan-markup.test`;
  const bossCtx = await browser.newContext();
  const guestCtx = await browser.newContext();
  try {
    await clearLimits("invite_user");
    await makeActiveUser(waiting, PASSWORD);
    await makeActiveUser(stranger, PASSWORD);
    await sql("update public.profiles set status = 'pending' where email = $1", [waiting]);

    const page = await bossCtx.newPage();
    await openMembers(page, boss);
    await invite(page, waiting, "member");
    await expect(page.getByText(`Invitation sent to ${waiting}.`, { exact: true })).toBeVisible();
    const link = await inviteLink(waiting, company);

    // Someone else, signed in, cannot use it.
    const guest = await guestCtx.newPage();
    await guest.goto("/sign-in");
    await signIn(guest, stranger, PASSWORD);
    await expect(guest).toHaveURL("/workspace");
    await guest.goto(link);
    await expect(guest.getByTestId("invite-other-account")).toContainText(stranger);
    await expect(guest.getByRole("button", { name: /^Join / })).toHaveCount(0);
    await guest.getByRole("button", { name: "Sign out" }).click();
    await expect(guest).toHaveURL("/sign-in");

    // The invited account: sign in from the link, come back to it, join.
    await guest.goto(link);
    await guest.getByRole("link", { name: "Sign in to join" }).click();
    await expect(guest).toHaveURL(/\/sign-in\?next=%2Finvite%3Ftoken%3D/);
    await signIn(guest, waiting, PASSWORD);
    await expect(guest).toHaveURL(link);
    await guest.getByRole("button", { name: `Join ${company}` }).click();
    await expect(guest).toHaveURL("/workspace");
    expect(await memberRows(company)).toEqual([
      { email: boss, role: "admin", status: "active" },
      { email: waiting, role: "member", status: "active" },
    ]);
  } finally {
    await bossCtx.close();
    await guestCtx.close();
    await cleanUp(tag, platform, boss, waiting, stranger);
  }
});

test("refusals, resending and withdrawing; the screen passes axe at 768 px", async ({ browser }) => {
  const tag = crypto.randomUUID().slice(0, 12);
  const { platform, boss, company } = await makeCompany(tag);
  const elsewhere = `ivelse-${tag}@plan-markup.test`;
  const target = `ivtarget-${tag}@plan-markup.test`;
  const ctx = await browser.newContext({ viewport: { width: 768, height: 900 } });
  try {
    await clearLimits("invite_user");
    await makeActiveUser(elsewhere, PASSWORD);
    await sql("select * from public.admin_create_company((select id from public.profiles where email = $1), $2, $3)", [platform, `Elsewhere ${tag}`, elsewhere]);

    const page = await ctx.newPage();
    await openMembers(page, boss);
    const email = page.getByLabel("Email");

    await invite(page, "not-an-email");
    await expect(email).toHaveAccessibleDescription("Enter a valid email address.");
    await invite(page, boss);
    await expect(email).toHaveAccessibleDescription("This person is already a member of your company.");
    await invite(page, elsewhere);
    await expect(email).toHaveAccessibleDescription("This person already belongs to another company. They must leave it before they can join yours.");

    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.html).join(" | ")}`)).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);

    // Inviting the same address again replaces the first link.
    await invite(page, target, "member");
    await expect(page.getByText(`Invitation sent to ${target}.`, { exact: true })).toBeVisible();
    const first = await inviteLink(target, company);
    await invite(page, target, "admin");
    const row = page.getByRole("table", { name: /Invitations of/ }).getByRole("row", { name: new RegExp(target) });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText("Admin");
    let second = first;
    await expect(async () => {
      second = await inviteLink(target, company);
      expect(second).not.toBe(first);
    }).toPass();

    const guestCtx = await browser.newContext();
    try {
      const guest = await guestCtx.newPage();
      await guest.goto(first);
      await expect(guest.getByRole("heading", { name: "This invitation was withdrawn" })).toBeVisible();
      await guest.goto("/invite?token=not-a-token");
      await expect(guest.getByRole("heading", { name: "This invitation is not valid" })).toBeVisible();
      await guest.goto(second);
      await expect(guest.getByRole("heading", { name: `Join ${company}` })).toBeVisible();
      const inviteAxe = await new AxeBuilder({ page: guest }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
      expect(inviteAxe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.html).join(" | ")}`)).toEqual([]);

      // Withdrawn by the admin: the link stops working.
      await row.getByRole("button", { name: `Withdraw the invitation to ${target}` }).click();
      await expect(page.getByText(`The invitation to ${target} is withdrawn.`, { exact: true })).toBeVisible();
      await expect(page.getByText("No invitations are waiting.")).toBeVisible();
      await guest.reload();
      await expect(guest.getByRole("heading", { name: "This invitation was withdrawn" })).toBeVisible();
    } finally {
      await guestCtx.close();
    }
    expect(await memberRows(company)).toEqual([{ email: boss, role: "admin", status: "active" }]);
  } finally {
    await ctx.close();
    await cleanUp(tag, platform, boss, elsewhere, target);
  }
});
