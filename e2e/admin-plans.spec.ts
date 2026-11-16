import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { deleteUser, makeActiveUser, sql } from "./auth-mail";
import { signIn } from "./helpers";

// Story 10.8: the platform admin sets the plan of an account and of a company.

const PASSWORD = "admin plans e2e password";

test("the admin sets a plan on an account and on a company; both are saved, recorded and shown to their users", async ({ page }) => {
  const tag = crypto.randomUUID().slice(0, 12);
  const admin = `pladm-${tag}@plan-markup.test`;
  const solo = `plsolo-${tag}@plan-markup.test`;
  const company = `Plan Co ${tag}`;
  try {
    await makeActiveUser(admin, PASSWORD);
    await makeActiveUser(solo, PASSWORD);
    await sql("update public.profiles set is_platform_admin = true, name = 'Ada Admin' where email = $1", [admin]);
    await sql("update public.profiles set name = 'Sol Solo' where email = $1", [solo]);
    await sql("select * from public.admin_create_company((select id from public.profiles where email = $1), $2, $1)", [admin, company]);

    await page.setViewportSize({ width: 768, height: 900 });
    await page.goto(`/sign-in?next=${encodeURIComponent(`/admin/users?status=active&q=${tag}`)}`);
    await signIn(page, admin, PASSWORD);
    await expect(page).toHaveURL(`/admin/users?status=active&q=${tag}`);

    // An account: Trial by default, set to Pilot, still Pilot after a reload.
    const userPlan = page.getByRole("combobox", { name: "Plan of Sol Solo" });
    await expect(userPlan).toHaveValue("trial");
    await userPlan.selectOption("pilot");
    await expect(page.getByText("Sol Solo is on the Pilot plan.", { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("combobox", { name: "Plan of Sol Solo" })).toHaveValue("pilot");

    const usersAxe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(usersAxe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.html).join(" | ")}`)).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);

    // A company: set to Standard.
    await page.getByRole("navigation", { name: "Admin" }).getByRole("link", { name: "Companies" }).click();
    await expect(page).toHaveURL("/admin/companies");
    const companyPlan = page.getByRole("combobox", { name: `Plan of ${company}` });
    await expect(companyPlan).toHaveValue("trial");
    await companyPlan.selectOption("standard");
    await expect(page.getByText(`${company} is on the Standard plan.`, { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("combobox", { name: `Plan of ${company}` })).toHaveValue("standard");

    const companiesAxe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(companiesAxe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.html).join(" | ")}`)).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);

    expect(
      await sql(
        `select a.action, pa.email as actor, a.detail from public.audit_log a join public.profiles pa on pa.id = a.actor_id
          where a.action like '%.plan_changed'
            and a.target_id in ((select id from public.profiles where email = $1), (select id from public.companies where name = $2))
          order by a.occurred_at`,
        [solo, company],
      ),
    ).toEqual([
      { action: "user.plan_changed", actor: admin, detail: { from: "trial", to: "pilot" } },
      { action: "company.plan_changed", actor: admin, detail: { from: "trial", to: "standard" } },
    ]);
    // Each user is shown the plan they work under: the admin, a member of the company, its plan.
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/workspace");
    await page.getByRole("button", { name: "Account: Ada Admin" }).click();
    await expect(page.getByTestId("account-plan")).toHaveText(`Standard plan, through ${company}`);
    await page.keyboard.press("Escape");
    // And someone in no company, their own: in the account menu and under Settings.
    await page.context().clearCookies();
    await page.goto("/sign-in");
    await signIn(page, solo, PASSWORD);
    await expect(page).toHaveURL("/workspace");
    await page.getByRole("button", { name: "Account: Sol Solo" }).click();
    await expect(page.getByTestId("account-plan")).toHaveText("Pilot plan");
    await page.keyboard.press("Escape");
    await page.getByRole("menubar", { name: "Main menu" }).getByRole("menuitem", { name: "Settings" }).click();
    await page.getByRole("menuitem", { name: "Account & signature…" }).click();
    await expect(page.getByTestId("profile-plan")).toHaveText("Pilot");

    expect(
      await sql("select (select plan from public.profiles where email = $1) as u, (select plan from public.companies where name = $2) as c", [solo, company]),
    ).toEqual([{ u: "pilot", c: "standard" }]);
  } finally {
    await sql("delete from public.companies where name = $1", [company]);
    await deleteUser(admin, solo);
  }
});
