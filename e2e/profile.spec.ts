import { expect, test, type Page } from "@playwright/test";
import { clearLimits, deleteUser, emailLink, makeActiveUser, sql } from "./auth-mail";
import { signIn } from "./helpers";

// Story 10.3: Settings → Account: name saved at once, email changed after both addresses confirm.

const PASSWORD = "profile e2e passphrase";
const SUBJECT = "Confirm your new Plan Markup email";

async function openAccount(page: Page) {
  await page.getByRole("menubar").getByRole("menuitem", { name: "Settings" }).click();
  await page.getByRole("menuitem", { name: "Account & signature…" }).click();
  const dialog = page.getByRole("dialog", { name: "Account & signature" });
  await expect(dialog).toBeVisible();
  return dialog;
}

test("profile: change the name, then the email through both confirmation links", async ({ page }) => {
  const stamp = `${Date.now()}-${test.info().retry}`;
  const oldEmail = `profile-${stamp}@plan-markup.test`;
  const newEmail = `profile-new-${stamp}@plan-markup.test`;
  await clearLimits("email_change_user");
  await makeActiveUser(oldEmail, PASSWORD);
  try {
    await page.goto("/sign-in");
    await signIn(page, oldEmail, PASSWORD);
    await expect(page).toHaveURL("/workspace");

    // Name: saved at once; the dialog's subtitle (from the profile) follows.
    let dialog = await openAccount(page);
    const profile = dialog.getByRole("region", { name: "Profile" });
    await profile.getByLabel("Name").fill("Pat Designer");
    await profile.getByRole("button", { name: "Save name" }).click();
    await expect(profile.getByRole("status")).toHaveText("Name saved.");
    await expect(dialog.getByText(`Pat Designer · ${oldEmail}`)).toBeVisible();
    const [row] = await sql<{ name: string }>("select name from public.profiles where email = $1", [oldEmail]);
    expect(row.name).toBe("Pat Designer");

    // Email: links go to both addresses; nothing changes until both are opened.
    await profile.getByRole("button", { name: "Change email…" }).click();
    await profile.getByLabel("Email").fill(newEmail);
    await profile.getByRole("button", { name: "Send links" }).click();
    await expect(profile.getByRole("status")).toContainText(`to ${newEmail}`);
    await page.keyboard.press("Escape");

    const toOld = await emailLink(oldEmail, SUBJECT);
    const toNew = await emailLink(newEmail, SUBJECT);
    await page.goto(toOld);
    await expect(page).toHaveURL("/email-change?step=other");
    await expect(page.getByRole("heading", { name: "One more link to open" })).toBeVisible();
    expect((await sql("select 1 from public.profiles where email = $1", [oldEmail])).length).toBe(1);

    await page.goto(toNew);
    await expect(page).toHaveURL("/email-change?step=done");
    await expect(page.getByRole("heading", { name: "Your email has changed" })).toBeVisible();
    expect((await sql("select 1 from public.profiles where email = $1", [newEmail])).length).toBe(1);

    // The new email signs in; the workspace shows it.
    await page.context().clearCookies();
    await page.goto("/sign-in");
    await signIn(page, newEmail, PASSWORD);
    await expect(page).toHaveURL("/workspace");
    dialog = await openAccount(page);
    await expect(dialog.getByTestId("profile-email")).toHaveText(newEmail);
  } finally {
    await deleteUser(oldEmail, newEmail);
    await clearLimits("email_change_user");
  }
});
