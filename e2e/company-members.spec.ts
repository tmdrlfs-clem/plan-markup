import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { deleteUser, makeActiveUser, sql } from "./auth-mail";
import { signIn } from "./helpers";

// Story 10.7: a company admin changes roles and removes members.

const PASSWORD = "company members e2e password";

async function makeCompany(tag: string) {
  const platform = `mbp-${tag}@plan-markup.test`;
  const boss = `mbboss-${tag}@plan-markup.test`;
  const member = `mbmember-${tag}@plan-markup.test`;
  const company = `Members Co ${tag}`;
  for (const email of [platform, boss, member]) await makeActiveUser(email, PASSWORD);
  await sql("update public.profiles set is_platform_admin = true where email = $1", [platform]);
  await sql("update public.profiles set name = 'Bo Boss' where email = $1", [boss]);
  await sql("update public.profiles set name = 'Mel Member' where email = $1", [member]);
  await sql("select * from public.admin_create_company((select id from public.profiles where email = $1), $2, $3)", [platform, company, boss]);
  await sql(
    `insert into public.company_members (user_id, company_id, role)
     select (select id from public.profiles where email = $1), (select id from public.companies where name = $2), 'viewer'`,
    [member, company],
  );
  return { platform, boss, member, company };
}

async function cleanUp(tag: string, ...emails: string[]) {
  await sql("delete from public.companies where name like $1", [`%${tag}%`]);
  await deleteUser(...emails);
}

async function openMembers(page: Page, email: string) {
  await page.goto("/sign-in?next=%2Fcompany%2Fmembers");
  await signIn(page, email, PASSWORD);
  await expect(page).toHaveURL("/company/members");
  await expect(page.getByRole("heading", { name: "Members", level: 1 })).toBeVisible();
}

const roles = (company: string) =>
  sql<{ email: string; role: string }>(
    `select p.email, m.role from public.company_members m join public.profiles p on p.id = m.user_id
       join public.companies c on c.id = m.company_id where c.name = $1 order by p.email`,
    [company],
  );

const audit = (company: string) =>
  sql<{ action: string; actor: string; detail: Record<string, string> }>(
    `select a.action, pa.email as actor, a.detail - 'user_id' as detail from public.audit_log a join public.profiles pa on pa.id = a.actor_id
      where a.target_id = (select id from public.companies where name = $1) and a.action like 'company.member_r%' order by a.occurred_at`,
    [company],
  );

test("change roles: applied at once, the member is signed out, the last admin is protected, an admin can step down", async ({ browser }) => {
  const tag = crypto.randomUUID().slice(0, 12);
  const { platform, boss, member, company } = await makeCompany(tag);
  const bossCtx = await browser.newContext();
  const memberCtx = await browser.newContext();
  try {
    const memberPage = await memberCtx.newPage();
    await memberPage.goto("/sign-in");
    await signIn(memberPage, member, PASSWORD);
    await expect(memberPage).toHaveURL("/workspace");

    const page = await bossCtx.newPage();
    await openMembers(page, boss);
    // The only admin: role and membership are locked.
    await expect(page.getByRole("combobox", { name: "Role of Bo Boss" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Leave the company" })).toBeDisabled();
    await expect(page.getByText("The only admin. Make someone else an admin to change this.").last()).toBeVisible();

    // Viewer to admin: at once, and the member's session ends.
    await page.getByRole("combobox", { name: "Role of Mel Member" }).selectOption("admin");
    await expect(page.getByText("Mel Member is now Admin and was signed out.", { exact: true })).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Role of Mel Member" })).toHaveValue("admin");
    expect(await roles(company)).toEqual([
      { email: boss, role: "admin" },
      { email: member, role: "admin" },
    ]);
    await memberPage.goto("/workspace");
    await expect(memberPage).toHaveURL(/\/sign-in/);

    // With a second admin, the first may step down: asked first, then signed out.
    await expect(page.getByRole("combobox", { name: "Role of Bo Boss" })).toBeEnabled();
    await page.getByRole("combobox", { name: "Role of Bo Boss" }).selectOption("member");
    const dialog = page.getByRole("alertdialog", { name: "Change your own role?" });
    await expect(dialog).toContainText("You will be Member instead of Admin");
    await dialog.getByRole("button", { name: "Change my role" }).click();
    await expect(page).toHaveURL(/\/sign-in/);
    await signIn(page, boss, PASSWORD);
    await expect(page).toHaveURL("/workspace");
    const response = await page.goto("/company/members");
    expect(response?.status()).toBe(404);

    // The new admin has the Company area now.
    await signIn(memberPage, member, PASSWORD);
    await expect(memberPage).toHaveURL("/workspace");
    await memberPage.getByRole("button", { name: "Account: Mel Member" }).click();
    await memberPage.getByRole("menuitem", { name: "Company: members" }).click();
    await expect(memberPage).toHaveURL("/company/members");
    await expect(memberPage.getByRole("combobox", { name: "Role of Mel Member" })).toBeDisabled();

    expect(await audit(company)).toEqual([
      { action: "company.member_role_changed", actor: boss, detail: { from: "viewer", to: "admin" } },
      { action: "company.member_role_changed", actor: boss, detail: { from: "admin", to: "member" } },
    ]);
  } finally {
    await bossCtx.close();
    await memberCtx.close();
    await cleanUp(tag, platform, boss, member);
  }
});

test("remove a member: signed out at once, out of the company, still an individual user with their own markup sets", async ({ browser }) => {
  const tag = crypto.randomUUID().slice(0, 12);
  const { platform, boss, member, company } = await makeCompany(tag);
  const bossCtx = await browser.newContext({ viewport: { width: 768, height: 900 } });
  const memberCtx = await browser.newContext();
  try {
    await sql("insert into public.drawings (owner_id, title) select id, $2 from public.profiles where email = $1", [member, `Mine ${tag}`]);
    const memberPage = await memberCtx.newPage();
    await memberPage.goto("/sign-in");
    await signIn(memberPage, member, PASSWORD);
    await expect(memberPage).toHaveURL("/workspace");

    const page = await bossCtx.newPage();
    await openMembers(page, boss);
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.html).join(" | ")}`)).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);

    await page.getByRole("button", { name: "Remove Mel Member" }).click();
    const dialog = page.getByRole("alertdialog", { name: "Remove this member?" });
    await expect(dialog).toContainText("Their own markup sets stay with them");
    const dialogAxe = await new AxeBuilder({ page }).include("[role='alertdialog']").withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(dialogAxe.violations.map((v) => v.id)).toEqual([]);
    await dialog.getByRole("button", { name: "Remove member" }).click();
    await expect(page.getByText("Mel Member is removed from the company and was signed out.", { exact: true })).toBeVisible();
    await expect(page.getByRole("table", { name: /Members of/ }).getByRole("row", { name: /Mel Member/ })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Members (1)" })).toBeVisible();

    // Signed out at once; signing in again opens the workspace as an individual.
    await memberPage.goto("/workspace");
    await expect(memberPage).toHaveURL(/\/sign-in/);
    await signIn(memberPage, member, PASSWORD);
    await expect(memberPage).toHaveURL("/workspace");
    await memberPage.getByRole("button", { name: "Account: Mel Member" }).click();
    await expect(memberPage.getByRole("menuitem", { name: "Sign out" })).toBeVisible();
    await expect(memberPage.getByRole("menuitem", { name: "Company: members" })).toHaveCount(0);

    expect(await roles(company)).toEqual([{ email: boss, role: "admin" }]);
    expect(
      await sql("select p.status, (select count(*)::int from public.drawings d where d.owner_id = p.id and d.title = $2) as sets from public.profiles p where p.email = $1", [
        member,
        `Mine ${tag}`,
      ]),
    ).toEqual([{ status: "active", sets: 1 }]);
    expect(await audit(company)).toEqual([{ action: "company.member_removed", actor: boss, detail: { role: "viewer" } }]);
  } finally {
    await bossCtx.close();
    await memberCtx.close();
    await cleanUp(tag, platform, boss, member);
  }
});
