import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabase: vi.fn() }));

import { isPwnedPassword, PWNED_RANGE_URL } from "./pwned";
import { classifySignUpError } from "./sign-up";
import { classifyAuthError } from "./sign-in";
import { TURNSTILE_VERIFY_URL, turnstileRequired, verifyTurnstile } from "./turnstile";

const sha1 = (s: string) => createHash("sha1").update(s).digest("hex").toUpperCase();

function textFetch(body: string, status = 200) {
  return vi.fn(async () => new Response(body, { status })) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

describe("isPwnedPassword", () => {
  const pw = "correct horse battery";
  const h = sha1(pw);

  it("sends only the 5-character prefix, with padding", async () => {
    const f = textFetch("");
    await isPwnedPassword(pw, f);
    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(PWNED_RANGE_URL + h.slice(0, 5));
    expect(url).not.toContain(h.slice(5));
    expect(init.headers).toEqual({ "Add-Padding": "true" });
  });

  it("finds the suffix with a count, and ignores padding lines (count 0)", async () => {
    expect(await isPwnedPassword(pw, textFetch(`AAAA:3\r\n${h.slice(5)}:12\r\n`))).toBe(true);
    expect(await isPwnedPassword(pw, textFetch(`${h.slice(5)}:0\r\n`))).toBe(false);
    expect(await isPwnedPassword(pw, textFetch("AAAA:3"))).toBe(false);
  });

  it("fails open when the service is down", async () => {
    expect(await isPwnedPassword(pw, textFetch("", 503))).toBe(false);
    const broken = vi.fn(async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    expect(await isPwnedPassword(pw, broken)).toBe(false);
  });
});

describe("Turnstile", () => {
  const ok = (success: boolean) => textFetch(JSON.stringify({ success }));

  it("is skipped without a secret outside production, and required in production", () => {
    expect(turnstileRequired({})).toEqual({ secret: null, required: false });
    expect(turnstileRequired({ VERCEL_ENV: "production" })).toEqual({ secret: null, required: true });
    expect(turnstileRequired({ TURNSTILE_SECRET_KEY: "s" })).toEqual({ secret: "s", required: true });
  });

  it("verifies the token with the secret and IP", async () => {
    const f = ok(true);
    expect(await verifyTurnstile("tok", "203.0.113.7", { env: { TURNSTILE_SECRET_KEY: "s" }, fetchImpl: f })).toBe("passed");
    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(TURNSTILE_VERIFY_URL);
    const body = init.body as URLSearchParams;
    expect(body.get("secret")).toBe("s");
    expect(body.get("response")).toBe("tok");
    expect(body.get("remoteip")).toBe("203.0.113.7");
  });

  let env: Record<string, string>;
  beforeEach(() => {
    env = { TURNSTILE_SECRET_KEY: "s" };
  });

  it("fails without a token or when Cloudflare says no", async () => {
    expect(await verifyTurnstile(undefined, "ip", { env, fetchImpl: ok(true) })).toBe("failed");
    expect(await verifyTurnstile("tok", "ip", { env, fetchImpl: ok(false) })).toBe("failed");
  });

  it("is unavailable (fails closed) on errors or a missing production secret", async () => {
    expect(await verifyTurnstile("tok", "ip", { env, fetchImpl: textFetch("", 500) })).toBe("unavailable");
    expect(await verifyTurnstile("tok", "ip", { env: { VERCEL_ENV: "production" }, fetchImpl: ok(true) })).toBe("unavailable");
    expect(await verifyTurnstile("tok", "ip", { env: {}, fetchImpl: ok(false) })).toBe("skipped");
  });
});

describe("Auth error classes", () => {
  it("sign-up: an existing email is success; others map to reasons", () => {
    expect(classifySignUpError({ code: "user_already_exists", status: 422 })).toBe("ok");
    expect(classifySignUpError({ code: "weak_password", status: 422 })).toBe("weak_password");
    expect(classifySignUpError({ code: "email_address_invalid", status: 400 })).toBe("invalid_email");
    expect(classifySignUpError({ code: "over_email_send_rate_limit", status: 429 })).toBe("rate_limited");
    expect(classifySignUpError({ status: 500 })).toBe("unavailable");
  });

  it("sign-in: an unconfirmed email has its own reason", () => {
    expect(classifyAuthError({ code: "email_not_confirmed", status: 400 })).toBe("unconfirmed");
    expect(classifyAuthError({ code: "invalid_credentials", status: 400 })).toBe("invalid");
  });
});

describe("password reset helpers (Story 10.2)", async () => {
  const { hasFreshRecovery, classifyUpdateError } = await import("./password-reset");
  const now = 1_800_000_000;

  it("accepts an emailed-link sign-in within the hour only", () => {
    expect(hasFreshRecovery([{ method: "otp", timestamp: now - 60 }], now)).toBe(true);
    expect(hasFreshRecovery([{ method: "recovery", timestamp: now - 3600 }], now)).toBe(true);
    expect(hasFreshRecovery([{ method: "otp", timestamp: now - 3601 }], now)).toBe(false);
    expect(hasFreshRecovery([{ method: "password", timestamp: now }], now)).toBe(false);
    expect(hasFreshRecovery([{ method: "otp", timestamp: now + 3600 }], now)).toBe(false);
    expect(hasFreshRecovery(undefined, now)).toBe(false);
  });

  it("maps password update errors", () => {
    expect(classifyUpdateError({ code: "same_password" })).toBe("same_password");
    expect(classifyUpdateError({ code: "weak_password" })).toBe("weak_password");
    expect(classifyUpdateError({ status: 500 })).toBe("unavailable");
  });
});
