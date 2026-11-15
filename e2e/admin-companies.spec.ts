import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { deleteUser, makeActiveUser, sql } from "./auth-mail";
import { signIn } from "./helpers";

// Story 10.5: the platform admin creates a company with its first admin.

const PASSWORD = "admin companies e2e password";

async function makeAccounts(tag: string) {
  const admin = `coadm-${tag}@plan-markup.test`;
  const first = `cofirst-${tag}@plan-markup.test`;
  const waiting = `cowait-${tag}@plan-markup.test`;
  await makeActiveUser(admin, PASSWORD);
  await makeActiveUser(first, PASSWORD);
  await makeActiveUser(waiting, PASSWORD);
  await sql("update public.profiles set is_platform_admin = true, name = 'Ada Admin' where email = $1", [admin]);
  await sql("update public.profiles set name = 'Finn First' where email = $1", [first]);
  await sql("update public.profiles set status = 'pending' where email = $1", [waiting]);
  return { admin, first, waiting };
}

async function cleanUp(tag: string, ...emails: string[]) {
  await sql("delete from public.companies where name like $1", [`%${tag}%`]);
  await deleteUser(...emails);
}

async function create(page: Page, name: string, email: string) {
  await page.getByLabel("Company name").fill(name);
  await page.getByLabel("First admin's email").fill(email);
  await page.getByRole("button", { name: "Create company" }).click();
}

test("the admin creates a company with its first admin; the rules are enforced and the creation is recorded", async ({ page }) => {
  const tag = crypto.randomUUID().slice(0, 12);
  const { admin, first, waiting } = await makeAccounts(tag);
  const name = `Acme Fire ${tag}`;
  try {
    await page.goto("/sign-in?next=%2Fadmin%2Fcompanies");
    await signIn(page, admin, PASSWORD);
    await expect(page).toHaveURL("/admin/companies");
    await expect(page.getByRole("heading", { name: "Companies", level: 1 })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Admin" }).getByRole("link", { name: "Companies" })).toHaveAttribute("aria-current", "page");

    // Refusals land on their field.
    const email = page.getByLabel("First admin's email");
    await create(page, name, `nobody-${tag}@plan-markup.test`);
    await expect(email).toHaveAccessibleDescription("No account has this email. Ask them to sign up first.");
    await create(page, name, waiting);
    await expect(email).toHaveAccessibleDescription("This account is not active. Activate it under Accounts first.");
    await create(page, "", first);
    await expect(page.getByLabel("Company name")).toHaveAccessibleDescription("Enter the company's name.");

    // Created: in the list with its admin and one member; the form is cleared.
    await create(page, name, first.toUpperCase());
    await expect(page.getByText(`${name} is created.`, { exact: true })).toBeVisible();
    const row = page.getByRole("row", { name: new RegExp(name) });
    await expect(row).toContainText("Finn First");
    await expect(row).toContainText(first);
    await expect(row.getByRole("cell").nth(1)).toHaveText("1");
    await expect(page.getByLabel("Company name")).toHaveValue("");

    // One company per name (whatever its case) and per person.
    await create(page, name.toUpperCase(), admin);
    await expect(page.getByLabel("Company name")).toHaveAccessibleDescription("A company with this name already exists.");
    await create(page, `Other ${tag}`, first);
    await expect(email).toHaveAccessibleDescription("This person already belongs to a company.");

    expect(
      await sql(
        `select m.role, a.action, pa.email as actor, a.detail ->> 'name' as name, a.detail ->> 'admin_user_id' = m.user_id::text as admin_recorded
           from public.companies c
           join public.company_members m on m.company_id = c.id
           join public.audit_log a on a.target_id = c.id and a.target_type = 'company'
           join public.profiles pa on pa.id = a.actor_id
          where c.name = $1`,
        [name],
      ),
    ).toEqual([{ role: "admin", action: "company.created", actor: admin, name, admin_recorded: true }]);
    expect(await sql("select count(*)::int as n from public.companies where name like $1", [`%${tag}%`])).toEqual([{ n: 1 }]);
  } finally {
    await cleanUp(tag, admin, first, waiting);
  }
});

test("the companies screen is a 404 for a company's own admin", async ({ page }) => {
  const tag = crypto.randomUUID().slice(0, 12);
  const { admin, first, waiting } = await makeAccounts(tag);
  try {
    await sql(`select * from public.admin_create_company((select id from public.profiles where email = $1), $2, $3)`, [admin, `Mine ${tag}`, first]);
    await page.goto("/sign-in");
    await signIn(page, first, PASSWORD);
    await expect(page).toHaveURL("/workspace");
    const response = await page.goto("/admin/companies");
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: "Companies" })).toHaveCount(0);
  } finally {
    await cleanUp(tag, admin, first, waiting);
  }
});

test("the companies screen passes axe and fits a 768 px window", async ({ page }) => {
  const tag = crypto.randomUUID().slice(0, 12);
  const { admin, first, waiting } = await makeAccounts(tag);
  try {
    await sql(`select * from public.admin_create_company((select id from public.profiles where email = $1), $2, $3)`, [admin, `Axe Co ${tag}`, first]);
    await page.setViewportSize({ width: 768, height: 900 });
    await page.goto("/sign-in?next=%2Fadmin%2Fcompanies");
    await signIn(page, admin, PASSWORD);
    await expect(page).toHaveURL("/admin/companies");
    await expect(page.getByRole("row", { name: new RegExp(`Axe Co ${tag}`) })).toBeVisible();

    // With an error showing, too.
    await create(page, `Axe Co ${tag}`, admin);
    await expect(page.getByLabel("Company name")).toHaveAccessibleDescription("A company with this name already exists.");
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.html).join(" | ")}`)).toEqual([]);

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  } finally {
    await cleanUp(tag, admin, first, waiting);
  }
});
