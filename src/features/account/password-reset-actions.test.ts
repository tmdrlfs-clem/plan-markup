import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  checkResetRateLimit: vi.fn(),
  verifyTurnstile: vi.fn(),
  isPwnedPassword: vi.fn(),
  requestPasswordReset: vi.fn(),
  sessionCameFromRecovery: vi.fn(),
  setNewPassword: vi.fn(),
  readAuthState: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: m.redirect }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-real-ip": "203.0.113.7" }) }));
vi.mock("@/lib/auth", () => ({ readAuthState: m.readAuthState }));
vi.mock("@/lib/auth/rate-limit", () => ({ checkResetRateLimit: m.checkResetRateLimit }));
vi.mock("@/lib/auth/turnstile", () => ({ verifyTurnstile: m.verifyTurnstile }));
vi.mock("@/lib/auth/pwned", () => ({ isPwnedPassword: m.isPwnedPassword }));
vi.mock("@/lib/auth/password-reset", () => ({
  requestPasswordReset: m.requestPasswordReset,
  sessionCameFromRecovery: m.sessionCameFromRecovery,
  setNewPassword: m.setNewPassword,
}));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));

import { requestReset, resetPassword } from "./password-reset-actions";
import { PASSWORD_MESSAGES } from "./sign-up-schema";

function form(values: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(values)) fd.set(k, v);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  m.checkResetRateLimit.mockResolvedValue({ allowed: true });
  m.verifyTurnstile.mockResolvedValue("passed");
  m.isPwnedPassword.mockResolvedValue(false);
  m.requestPasswordReset.mockResolvedValue("ok");
  m.sessionCameFromRecovery.mockResolvedValue(true);
  m.setNewPassword.mockResolvedValue({ ok: true });
  m.readAuthState.mockResolvedValue({ kind: "active", user: { id: "u" } });
});

describe("requestReset", () => {
  it("answers 'sent' for any valid email, after the limiter and Turnstile", async () => {
    expect(await requestReset({ status: "idle" }, form({ email: " Who@Plan-Markup.test ", "cf-turnstile-response": "t" }))).toEqual({
      status: "sent",
      email: "who@plan-markup.test",
    });
    expect(m.checkResetRateLimit).toHaveBeenCalledWith({ ip: "203.0.113.7", email: "who@plan-markup.test" });
    expect(m.verifyTurnstile).toHaveBeenCalledWith("t", "203.0.113.7");
    expect(m.requestPasswordReset).toHaveBeenCalledWith("who@plan-markup.test");
  });

  it("rejects a bad email, rate limits, and stops on Turnstile", async () => {
    expect(await requestReset({ status: "idle" }, form({ email: "nope" }))).toMatchObject({ code: "INVALID_INPUT" });
    m.checkResetRateLimit.mockResolvedValueOnce({ allowed: false, retryAfterSeconds: 3000 });
    expect(await requestReset({ status: "idle" }, form({ email: "a@b.co" }))).toMatchObject({ code: "RATE_LIMITED" });
    m.checkResetRateLimit.mockRejectedValueOnce(new Error("down"));
    expect(await requestReset({ status: "idle" }, form({ email: "a@b.co" }))).toMatchObject({ code: "INTERNAL" });
    m.verifyTurnstile.mockResolvedValueOnce("failed");
    expect(await requestReset({ status: "idle" }, form({ email: "a@b.co" }))).toMatchObject({ code: "FORBIDDEN" });
    expect(m.requestPasswordReset).not.toHaveBeenCalled();
  });

  it("reports Auth trouble without saying anything about the email", async () => {
    m.requestPasswordReset.mockResolvedValueOnce("rate_limited");
    expect(await requestReset({ status: "idle" }, form({ email: "a@b.co" }))).toMatchObject({ code: "RATE_LIMITED" });
    m.requestPasswordReset.mockResolvedValueOnce("unavailable");
    expect(await requestReset({ status: "idle" }, form({ email: "a@b.co" }))).toMatchObject({ code: "INTERNAL" });
  });
});

describe("resetPassword", () => {
  const NEW = { password: "a brand new passphrase" };

  it("sets the password and redirects through the allowlist", async () => {
    await expect(resetPassword({ status: "idle" }, form({ ...NEW, next: "https://evil.example" }))).rejects.toThrow("REDIRECT:/workspace");
    expect(m.setNewPassword).toHaveBeenCalledWith("a brand new passphrase");
  });

  it("sends a pending user to PendingActivation", async () => {
    m.readAuthState.mockResolvedValueOnce({ kind: "inactive", status: "pending" });
    await expect(resetPassword({ status: "idle" }, form(NEW))).rejects.toThrow("REDIRECT:/pending-activation");
  });

  it("refuses a session that did not come from the reset link", async () => {
    m.sessionCameFromRecovery.mockResolvedValueOnce(false);
    expect(await resetPassword({ status: "idle" }, form(NEW))).toMatchObject({ code: "UNAUTHENTICATED" });
    expect(m.setNewPassword).not.toHaveBeenCalled();
  });

  it("checks length, breaches and reuse", async () => {
    expect(await resetPassword({ status: "idle" }, form({ password: "short" }))).toMatchObject({
      fieldErrors: { password: PASSWORD_MESSAGES.short },
    });
    m.isPwnedPassword.mockResolvedValueOnce(true);
    expect(await resetPassword({ status: "idle" }, form(NEW))).toMatchObject({ fieldErrors: { password: PASSWORD_MESSAGES.pwned } });
    m.setNewPassword.mockResolvedValueOnce({ ok: false, reason: "same_password" });
    expect(await resetPassword({ status: "idle" }, form(NEW))).toMatchObject({
      fieldErrors: { password: "Choose a password different from your current one." },
    });
    m.setNewPassword.mockResolvedValueOnce({ ok: false, reason: "unavailable" });
    expect(await resetPassword({ status: "idle" }, form(NEW))).toMatchObject({ code: "INTERNAL" });
  });
});
