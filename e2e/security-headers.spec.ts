// Security headers and CSP (Story 1.6, NFR28) against `next dev` on 3020.
// In dev, script-src contains 'unsafe-eval' by design (React dev error stacks):
// this spec does not assert its absence. csp.test.ts and the production proof
// (next build + next start, Story 1.6 Task 13) do.
import { expect, test, type APIResponse, type Page, type Response } from "@playwright/test";
import { parseCsp } from "../src/lib/security/csp";
import { ACTIVE, signIn } from "./helpers";

const SUPABASE_ORIGIN = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:56321").origin;

const STATIC_HEADERS: Record<string, string> = {
  "strict-transport-security": "max-age=63072000; includeSubDomains",
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy":
    "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=(), fullscreen=(self)",
  "x-frame-options": "DENY",
  "cross-origin-opener-policy": "same-origin",
};

const CSP_VIOLATION = /Content Security Policy|Refused to (load|execute|apply)/;

function expectStaticHeaders(headers: Record<string, string>) {
  for (const [key, value] of Object.entries(STATIC_HEADERS)) expect(headers[key], key).toBe(value);
  expect(headers["x-powered-by"]).toBeUndefined();
}

/** Checks the CSP and returns its nonce. */
function expectNonceCsp(header: string | undefined): string {
  const csp = parseCsp(header);
  const scriptSrc = csp.get("script-src") ?? [];
  expect(scriptSrc).toContain("'strict-dynamic'");
  expect(scriptSrc).not.toContain("'unsafe-inline'");
  const nonces = scriptSrc.filter((s) => s.startsWith("'nonce-"));
  expect(nonces).toHaveLength(1);
  expect(csp.get("worker-src")).toEqual(["'self'", "blob:"]);
  expect(csp.get("frame-ancestors")).toEqual(["'none'"]);
  expect(csp.get("object-src")).toEqual(["'none'"]);
  const connect = csp.get("connect-src") ?? [];
  expect(connect).toContain(SUPABASE_ORIGIN);
  expect(connect.join(" ")).not.toContain("sentry.io");
  return nonces[0].slice("'nonce-".length, -1);
}

function expectScriptsCarryNonce(html: string, nonce: string) {
  const tags = html.match(/<script\b[^>]*>/g) ?? [];
  expect(tags.length).toBeGreaterThan(0);
  for (const tag of tags) expect(tag, tag).toContain(`nonce="${nonce}"`);
  expect(tags.some((tag) => !/\ssrc=/.test(tag))).toBe(true);
}

function collectCspErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && CSP_VIOLATION.test(message.text())) errors.push(message.text());
  });
  page.on("pageerror", (error) => {
    if (CSP_VIOLATION.test(error.message)) errors.push(error.message);
  });
  return errors;
}

async function checkPage(res: Response | APIResponse | null) {
  expect(res).not.toBeNull();
  expect(res!.status()).toBe(200);
  const headers = res!.headers();
  expectStaticHeaders(headers);
  const nonce = expectNonceCsp(headers["content-security-policy"]);
  expectScriptsCarryNonce(await res!.text(), nonce);
}

test("/ has the nonce CSP, static headers and nonce'd scripts", async ({ page }) => {
  const errors = collectCspErrors(page);
  await checkPage(await page.goto("/"));
  await page.waitForLoadState("networkidle");
  expect(errors).toEqual([]);
});

test("/sign-in has the nonce CSP and hydrates under it", async ({ page }) => {
  const errors = collectCspErrors(page);
  await checkPage(await page.goto("/sign-in"));
  // Hydration proof: the show/hide toggle changes the input type.
  const password = page.getByLabel("Password", { exact: true });
  await expect(password).toHaveAttribute("type", "password");
  await page.getByRole("button", { name: "Show password" }).click();
  await expect(password).toHaveAttribute("type", "text");
  await page.waitForLoadState("networkidle");
  expect(errors).toEqual([]);
});

test("/workspace (signed in) has the nonce CSP and static headers", async ({ page }) => {
  const errors = collectCspErrors(page);
  await page.goto("/sign-in");
  await signIn(page, ACTIVE);
  await expect(page).toHaveURL("/workspace");
  await checkPage(await page.goto("/workspace"));
  await expect(page.getByRole("heading", { name: "Workspace" })).toBeVisible();
  await page.waitForLoadState("networkidle");
  expect(errors).toEqual([]);
});

test("nonces differ per request", async ({ request }) => {
  const a = expectNonceCsp((await request.get("/sign-in")).headers()["content-security-policy"]);
  const b = expectNonceCsp((await request.get("/sign-in")).headers()["content-security-policy"]);
  expect(a).not.toBe(b);
});

test("the anonymous /workspace redirect carries the CSP and static headers", async ({ request }) => {
  const res = await request.get("/workspace", { maxRedirects: 0 });
  expect(res.status()).toBe(307);
  expect(res.headers()["location"]).toContain("/sign-in?next=%2Fworkspace");
  expectStaticHeaders(res.headers());
  expectNonceCsp(res.headers()["content-security-policy"]);
});

test("a _next/static asset carries the static headers", async ({ request }) => {
  const html = await (await request.get("/sign-in")).text();
  const src = html.match(/<script\b[^>]*\ssrc="(\/_next\/static\/[^"]+)"/)?.[1];
  expect(src).toBeDefined();
  const res = await request.get(src!);
  expect(res.status()).toBe(200);
  expect(res.headers()["strict-transport-security"]).toBe(STATIC_HEADERS["strict-transport-security"]);
  expect(res.headers()["x-content-type-options"]).toBe("nosniff");
});
