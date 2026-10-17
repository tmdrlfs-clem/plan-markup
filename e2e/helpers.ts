import type { Page } from "@playwright/test";

// Seed accounts (supabase/seed.sql), all with password123.
export const PASSWORD = "password123";
export const ACTIVE = "user@plan-markup.test";

/** The form-level alert (Next's route announcer is also role="alert"). */
export function formAlert(page: Page) {
  return page.getByRole("alert").and(page.locator(":not(#__next-route-announcer__)"));
}

export async function signIn(page: Page, email: string, password = PASSWORD) {
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}
