import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  checkSignUpRateLimit: vi.fn(),
  verifyTurnstile: vi.fn(),
  isPwnedPassword: vi.fn(),
  signUpWithPassword: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-real-ip": "203.0.113.7" }),
}));
vi.mock("@/lib/auth/rate-limit", () => ({ checkSignUpRateLimit: m.checkSignUpRateLimit }));
vi.mock("@/lib/auth/turnstile", () => ({ verifyTurnstile: m.verifyTurnstile }));
vi.mock("@/lib/auth/pwned", () => ({ isPwnedPassword: m.isPwnedPassword }));
vi.mock("@/lib/auth/sign-up", () => ({ signUpWithPassword: m.signUpWithPassword }));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));

import { signUp, type SignUpState } from "./sign-up-actions";
import { PASSWORD_MESSAGES } from "./sign-up-schema";

const IDLE: SignUpState = { status: "idle" };

function form(values: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(values)) fd.set(k, v);
  return fd;
}

const VALID = { email: " New@Plan-Markup.test ", password: "correct horse battery", "cf-turnstile-response": "tok" };

beforeEach(() => {
  vi.clearAllMocks();
  m.checkSignUpRateLimit.mockResolvedValue({ allowed: true });
  m.verifyTurnstile.mockResolvedValue("passed");
  m.isPwnedPassword.mockResolvedValue(false);
  m.signUpWithPassword.mockResolvedValue({ ok: true });
});

describe("signUp", () => {
  it("signs up with the normalised email and answers 'sent'", async () => {
    const state = await signUp(IDLE, form(VALID));
    expect(state).toEqual({ status: "sent", email: "new@plan-markup.test" });
    expect(m.checkSignUpRateLimit).toHaveBeenCalledWith({ ip: "203.0.113.7", email: "new@plan-markup.test" });
    expect(m.verifyTurnstile).toHaveBeenCalledWith("tok", "203.0.113.7");
    expect(m.signUpWithPassword).toHaveBeenCalledWith("new@plan-markup.test", "correct horse battery");
  });

  it("rejects a short password before anything else is called", async () => {
    const state = await signUp(IDLE, form({ ...VALID, password: "short-pass1" }));
    expect(state).toMatchObject({ status: "error", code: "INVALID_INPUT", fieldErrors: { password: PASSWORD_MESSAGES.short } });
    expect(m.checkSignUpRateLimit).not.toHaveBeenCalled();
    expect(m.signUpWithPassword).not.toHaveBeenCalled();
  });

  it("accepts 72 bytes and rejects 73", async () => {
    expect(await signUp(IDLE, form({ ...VALID, password: "a".repeat(72) }))).toMatchObject({ status: "sent" });
    expect(await signUp(IDLE, form({ ...VALID, password: "a".repeat(73) }))).toMatchObject({
      fieldErrors: { password: PASSWORD_MESSAGES.long },
    });
  });

  it("is rate limited, and fails closed when the limiter is down", async () => {
    m.checkSignUpRateLimit.mockResolvedValueOnce({ allowed: false, retryAfterSeconds: 120 });
    expect(await signUp(IDLE, form(VALID))).toMatchObject({ code: "RATE_LIMITED", message: expect.stringContaining("2 minutes") });
    m.checkSignUpRateLimit.mockRejectedValueOnce(new Error("down"));
    expect(await signUp(IDLE, form(VALID))).toMatchObject({ code: "INTERNAL" });
    expect(m.signUpWithPassword).not.toHaveBeenCalled();
  });

  it("stops on a failed or unavailable Turnstile check", async () => {
    m.verifyTurnstile.mockResolvedValueOnce("failed");
    expect(await signUp(IDLE, form(VALID))).toMatchObject({ code: "FORBIDDEN" });
    m.verifyTurnstile.mockResolvedValueOnce("unavailable");
    expect(await signUp(IDLE, form(VALID))).toMatchObject({ code: "INTERNAL" });
    m.verifyTurnstile.mockResolvedValueOnce("skipped");
    expect(await signUp(IDLE, form(VALID))).toMatchObject({ status: "sent" });
    expect(m.signUpWithPassword).toHaveBeenCalledTimes(1);
  });

  it("refuses a breached password", async () => {
    m.isPwnedPassword.mockResolvedValueOnce(true);
    expect(await signUp(IDLE, form(VALID))).toMatchObject({ fieldErrors: { password: PASSWORD_MESSAGES.pwned } });
    expect(m.signUpWithPassword).not.toHaveBeenCalled();
  });

  it("maps Auth failures without revealing whether the email exists", async () => {
    m.signUpWithPassword.mockResolvedValueOnce({ ok: false, reason: "weak_password" });
    expect(await signUp(IDLE, form(VALID))).toMatchObject({ fieldErrors: { password: PASSWORD_MESSAGES.pwned } });
    m.signUpWithPassword.mockResolvedValueOnce({ ok: false, reason: "invalid_email" });
    expect(await signUp(IDLE, form(VALID))).toMatchObject({ fieldErrors: { email: "Enter a valid email address." } });
    m.signUpWithPassword.mockResolvedValueOnce({ ok: false, reason: "rate_limited" });
    expect(await signUp(IDLE, form(VALID))).toMatchObject({ code: "RATE_LIMITED" });
    m.signUpWithPassword.mockResolvedValueOnce({ ok: false, reason: "unavailable" });
    expect(await signUp(IDLE, form(VALID))).toMatchObject({ code: "INTERNAL" });
  });
});
