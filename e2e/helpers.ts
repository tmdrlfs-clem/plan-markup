import type { Page } from "@playwright/test";
import pg from "pg";
import { rateLimitKeyHash } from "../src/lib/auth/rate-limit-key";
import { DB_URL } from "./global-setup";

// Seed accounts (supabase/seed.sql), all with password123.
export const PASSWORD = "password123";
export const ACTIVE = "user@plan-markup.test";

/** The form-level alert (Next's route announcer is also role="alert"). */
export function formAlert(page: Page) {
  return page.getByRole("alert").and(page.locator(":not(#__next-route-announcer__)"));
}

/**
 * Clears the sign-in counters that a whole e2e run would otherwise exhaust:
 * every spec signs in from the same address (30 per 15 min) and most as the
 * same few accounts (10 per 15 min each), so the later specs of a long run
 * were throttled (Story 4.2: CI failed once there were more specs). The
 * limiter itself is covered by auth.spec.ts, which keeps its counters.
 */
async function clearSignInLimits(email: string): Promise<void> {
  const client = new pg.Client({ connectionString: DB_URL });
  await client.connect();
  try {
    await client.query("delete from app.rate_limits where bucket = 'sign_in_ip' or (bucket = 'sign_in_email' and key_hash = $1)", [
      rateLimitKeyHash("sign_in_email", email),
    ]);
  } finally {
    await client.end();
  }
}

export async function signIn(page: Page, email: string, password = PASSWORD, options: { keepRateLimits?: boolean } = {}) {
  if (!options.keepRateLimits) await clearSignInLimits(email);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

/** Arms a measuring tool from the ToolRail's measure menu (the rail shows one measuring tool at a time). */
export async function armMeasureTool(page: Page, name: string) {
  await page.getByRole("toolbar", { name: "Drawing tools" }).getByRole("button", { name: "More measure tools" }).click();
  await page.getByRole("menuitemradio", { name, exact: true }).click();
}
