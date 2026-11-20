import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { clearLimits, deleteUser, emailLink, sql, openEmailLink } from "./auth-mail";
import { formAlert, signIn } from "./helpers";

// Story 10.1: sign up, confirm the email, wait for activation.

const confirmationLink = (email: string) => emailLink(email, "Confirm your Plan Markup account");

/** With Turnstile keys set (a manual run), waits for the check's token; CI runs without them. */
async function waitForCheck(page: Page) {
  if ((await page.getByTestId("turnstile").count()) === 0) return;
  await expect(page.locator('input[name="cf-turnstile-response"]')).not.toHaveValue("", { timeout: 15_000 });
}

/** Sign-up counters; a rerun of this spec would otherwise hit them. */
const clearSignUpLimits = () => clearLimits("sign_up_ip", "sign_up_email");

test("sign up, confirm the email, then wait for approval", async ({ page }) => {
  const email = `signup-${Date.now()}-${test.info().retry}@plan-markup.test`;
  // Random, so the leaked-password check cannot flag it.
  const password = `plan markup ${crypto.randomUUID()}`;
  await clearSignUpLimits();

  try {
    await page.goto("/sign-in");
    await page.getByRole("link", { name: "Create an account" }).click();
    await expect(page).toHaveURL("/sign-up");

    // The length rule shows on the field.
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill("short-pass1");
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByText("Use at least 12 characters.")).toBeVisible();

    await page.getByLabel("Password", { exact: true }).fill(password);
    await waitForCheck(page);
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();

    // The profile is pending and the email unconfirmed.
    const [row] = await sql<{ status: string; confirmed: boolean }>(
      `select p.status, u.email_confirmed_at is not null as confirmed
         from auth.users u join public.profiles p on p.id = u.id where u.email = $1`,
      [email],
    );
    expect(row).toMatchObject({ status: "pending", confirmed: false });
    const link = await confirmationLink(email);
    expect(link).toMatch(/^\/auth\/confirm\?token_hash=[\w-]+&type=email$/);

    // Signing in before confirming is refused with a reason.
    await page.goto("/sign-in");
    await signIn(page, email, password);
    await expect(formAlert(page)).toContainText("Confirm your email first");

    // A mail scanner opening the link (GET) uses nothing: the link still works afterwards.
    expect((await page.request.get(link)).status()).toBe(200);
    expect((await sql<{ confirmed: boolean }>("select email_confirmed_at is not null as confirmed from auth.users where email = $1", [email]))[0].confirmed).toBe(false);

    // The emailed link (supabase/templates/confirmation.html) confirms and signs in.
    await openEmailLink(page, link);
    await expect(page).toHaveURL("/pending-activation");
    await expect(page.getByRole("heading", { name: "Your account is waiting for approval" })).toBeVisible();
    await page.goto("/workspace");
    await expect(page).toHaveURL("/pending-activation");

    // The link works once.
    await page.context().clearCookies();
    await openEmailLink(page, link);
    await expect(page).toHaveURL("/sign-in?link=invalid");
    await expect(formAlert(page)).toContainText("expired or was already used");

    // Signing up again with the same email gives the same answer (no account enumeration).
    await page.goto("/sign-up");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await waitForCheck(page);
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
  } finally {
    await deleteUser(email);
    await clearSignUpLimits();
  }
});

// Security review M3: Auth itself refuses a sign-up made around the app (the
// public key straight to /auth/v1/signup), which would skip our rate limit,
// Turnstile and leaked-password checks. Accounts are made only by the server.
test("Auth refuses a sign-up that does not come through the app", async () => {
  // CI exports the local keys as environment variables; a local run has them in .env.local.
  const fromFile = (): Record<string, string> => {
    try {
      return Object.fromEntries(
        readFileSync(path.join(__dirname, "..", ".env.local"), "utf8")
          .split(/\r?\n/)
          .filter((l) => l.includes("=") && !l.startsWith("#"))
          .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
      );
    } catch {
      return {};
    }
  };
  const env = { ...fromFile(), ...process.env };
  expect(env.NEXT_PUBLIC_SUPABASE_URL && env.NEXT_PUBLIC_SUPABASE_ANON_KEY).toBeTruthy();
  const email = `direct-${Date.now()}-${test.info().retry}@plan-markup.test`;
  try {
    const res = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/signup`, {
      method: "POST",
      headers: { apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "", "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: `plan markup ${crypto.randomUUID()}` }),
    });
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error_code?: string }).error_code).toBe("signup_disabled");
    expect(await sql("select 1 from auth.users where email = $1", [email])).toEqual([]);
  } finally {
    await deleteUser(email);
  }
});
